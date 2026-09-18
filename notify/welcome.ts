import { type MiokuContext, wait } from "mioku";
import { getPluginRuntimeState, type AIService } from "mioku";
import type { AdminConfig } from "../config";

export async function resolveMemberName(
  ctx: MiokuContext,
  bot: import("mioku").Bot | undefined,
  groupId: number,
  userId: number,
): Promise<string> {
  try {
    if (!bot) return String(userId);
    const member = await bot.getMemberInfo(groupId, userId);
    return (
      String(member?.card || "").trim() ||
      String(member?.nickname || "").trim() ||
      String(userId)
    );
  } catch {
    return String(userId);
  }
}

interface PendingMember {
  userId: number;
  memberName: string;
}

interface BatchState {
  members: PendingMember[];
  timer: ReturnType<typeof setTimeout> | null;
  groupName: string;
}

const RUNTIME_KEY = "welcomeBatch";

function getBatchMap(): Map<string, BatchState> {
  const state = getPluginRuntimeState("admin");
  if (!state[RUNTIME_KEY]) {
    state[RUNTIME_KEY] = new Map<string, BatchState>();
  }
  return state[RUNTIME_KEY] as Map<string, BatchState>;
}

function batchKey(selfId: string | number, groupId: number): string {
  return `${selfId}:${groupId}`;
}

function renderTemplate(
  template: string,
  values: Record<string, string>,
): string {
  let output = String(template || "");
  for (const [key, value] of Object.entries(values)) {
    output = output.split(`{${key}}`).join(value);
  }
  return output;
}

function normalizeGeneratedText(value: string): string {
  return String(value || "")
    .replace(/[`"'“”‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function flushBatch(options: {
  ctx: MiokuContext;
  aiService?: AIService;
  config: AdminConfig;
  selfId: string | number;
  groupId: number;
  groupName: string;
  members: PendingMember[];
  promptInjections?: { content: string; title?: string }[];
  bot?: import("mioku").Bot;
  tryCustomPrompt?: (info: {
    selfId: string | number;
    groupId: number;
    userId: number;
    groupName: string;
  }, bot?: import("mioku").Bot) => Promise<boolean>;
}): Promise<string> {
  const {
    ctx,
    aiService,
    config,
    selfId,
    groupId,
    groupName,
    members,
    promptInjections,
    bot,
    tryCustomPrompt,
  } = options;
  if (!members.length) return "";

  if (tryCustomPrompt) {
    let anyCustom = false;
    for (const m of members) {
      const handled = await tryCustomPrompt(
        {
          selfId,
          groupId,
          userId: m.userId,
          groupName,
        },
        bot,
      );
      if (handled) anyCustom = true;
    }
    if (anyCustom) return "";
  }

  const names = members.map((m) => m.memberName || String(m.userId));
  const userList = names.join("、");
  const userIdList = members.map((m) => String(m.userId)).join(", ");

  const fallbackText =
    normalizeGeneratedText(
      renderTemplate(config.welcome.text, {
        user: userList,
        group: groupName,
      }),
    ) || `欢迎新人～`;

  if (config.welcome.mode !== "ai") {
    return fallbackText;
  }

  const chatRuntime = aiService?.getChatRuntime();
  if (!chatRuntime) {
    return fallbackText;
  }

  try {
    await chatRuntime.generateNotice({
      selfId: Number(selfId),
      groupId,
      send: true,
      instruction: [
        `当前有 ${members.length} 位新成员同时入群，请一次性发送一段统一的欢迎语（不要逐个 @ 欢迎、不要重复点名）不要长篇大论，精简即可。`,
        `新成员昵称：${userList}`,
        `新成员 QQ：${userIdList}`,
        `所在群：${groupName}`,
        `${config.welcome.aiPrompt || ""}`,
      ].join("\n"),
      promptInjections,
    });

    return "";
  } catch (error) {
    ctx.logger.error(`admin welcome chat-runtime 生成失败: ${error}`);
    return fallbackText;
  }
}

async function sendSingleWelcome(options: {
  ctx: MiokuContext;
  aiService?: AIService;
  config: AdminConfig;
  selfId: string | number;
  groupId: number;
  groupName: string;
  userId: number;
  memberName: string;
  promptInjections?: { content: string; title?: string }[];
  bot?: import("mioku").Bot;
  tryCustomPrompt?: (info: {
    selfId: string | number;
    groupId: number;
    userId: number;
    groupName: string;
  }, bot?: import("mioku").Bot) => Promise<boolean>;
}): Promise<void> {
  const {
    ctx,
    aiService,
    config,
    selfId,
    groupId,
    groupName,
    userId,
    memberName,
    promptInjections,
    bot,
    tryCustomPrompt,
  } = options;
  const welcomeMessage = await flushBatch({
    ctx,
    aiService,
    config,
    selfId,
    groupId,
    groupName,
    members: [{ userId, memberName }],
    promptInjections,
    bot,
    tryCustomPrompt,
  });
  if (!welcomeMessage) return;
  if (!bot) return;
  try {
    await bot.sendMessage({ type: "group", group_id: groupId}, [ctx.segment.text(welcomeMessage)]);
  } catch (error) {
    ctx.logger.warn(`发送入群欢迎失败: ${error}`);
  }
}

export async function triggerSingleWelcome(options: {
  ctx: MiokuContext;
  aiService?: AIService;
  getConfig: () => AdminConfig;
  selfId: string | number;
  groupId: number;
  groupName: string;
  userId: number;
  memberName?: string;
  promptInjections?: { content: string; title?: string }[];
  tryCustomPrompt?: (info: {
    selfId: string | number;
    groupId: number;
    userId: number;
    groupName: string;
  }, bot?: import("mioku").Bot) => Promise<boolean>;
}, bot?: import("mioku").Bot): Promise<void> {
  const memberName =
    options.memberName ||
    (await resolveMemberName(
      options.ctx,
      bot,
      options.groupId,
      options.userId,
    ));
  await sendSingleWelcome({
    ctx: options.ctx,
    aiService: options.aiService,
    config: options.getConfig(),
    selfId: options.selfId,
    groupId: options.groupId,
    groupName: options.groupName,
    userId: options.userId,
    memberName,
    promptInjections: options.promptInjections,
    bot,
    tryCustomPrompt: options.tryCustomPrompt,
  });
}

export function registerWelcomeHandler(
  ctx: MiokuContext,
  aiService: AIService | undefined,
  getConfig: () => AdminConfig,
  shouldSuppress?: (info: {
    selfId: string | number;
    groupId: number;
    userId: number;
    groupName: string;
  }, bot?: import("mioku").Bot) => Promise<boolean> | boolean,
  tryCustomPrompt?: (info: {
    selfId: string | number;
    groupId: number;
    userId: number;
    groupName: string;
  }, bot?: import("mioku").Bot) => Promise<boolean>,
): () => void {
  const batches = getBatchMap();

  const dispose = ctx.handle(
    "notice.group.increase",
    async (event) => {
      const cfg = getConfig();
      const bot = event.bot;
      const selfId = event?.self_id || ctx.self_id || "";
      const groupId = Number(event?.group_id || 0);
      const userId = Number(event?.user_id || 0);
      if (!groupId || !userId) return;
      if (selfId != null && String(userId) === String(selfId)) return;

      const groupName =
        String((event.raw as { group_name?: string } | undefined)?.group_name || "").trim() || String(groupId);

      if (
        shouldSuppress &&
        (await shouldSuppress({ selfId, groupId, userId, groupName }, bot))
      ) {
        return;
      }

      if (!cfg.welcome.enabled) return;

      const batchWindowMs = Math.max(0, Number(cfg.welcome.batchWindowMs) || 0);

      if (batchWindowMs === 0) {
        const memberName = await resolveMemberName(
          ctx,
          bot,
          groupId,
          userId,
        );
        const welcomeMessage = await flushBatch({
          ctx,
          aiService,
          config: cfg,
          selfId,
          groupId,
          groupName,
          members: [{ userId, memberName }],
          bot,
        });
        if (!welcomeMessage) return;
        if (!bot) return;
        try {
          await bot.sendMessage({ type: "group", group_id: groupId}, [ctx.segment.text(welcomeMessage)]);
        } catch (error) {
          ctx.logger.warn(`发送入群欢迎失败: ${error}`);
        }
        return;
      }

      const key = batchKey(selfId, groupId);
      let state = batches.get(key);
      if (!state) {
        state = { members: [], timer: null, groupName };
        batches.set(key, state);
      }
      if (groupName && groupName !== String(groupId)) {
        state.groupName = groupName;
      }

      const memberName = await resolveMemberName(ctx, bot, groupId, userId);
      if (!state.members.some((m) => m.userId === userId)) {
        state.members.push({ userId, memberName });
      }

      if (state.timer) {
        return;
      }

      state.timer = setTimeout(async () => {
        try {
          const pending = state;
          batches.delete(key);
          if (!pending || !pending.members.length) return;

          const currentConfig = getConfig();
          const welcomeMessage = await flushBatch({
            ctx,
            aiService,
            config: currentConfig,
            selfId,
            groupId,
            groupName: pending.groupName,
            members: pending.members,
            bot,
            tryCustomPrompt,
          });
          if (!welcomeMessage) return;

          if (!bot) return;
          try {
            await bot.sendMessage({ type: "group", group_id: groupId}, [ctx.segment.text(welcomeMessage)]);
          } catch (error) {
            ctx.logger.warn(`发送入群欢迎失败: ${error}`);
          }
        } catch (error) {
          ctx.logger.error(`admin welcome 批次处理失败: ${error}`);
        }
      }, batchWindowMs);
    },
  );

  return () => {
    for (const state of batches.values()) {
      if (state.timer) clearTimeout(state.timer);
    }
    batches.clear();
    dispose();
  };
}
