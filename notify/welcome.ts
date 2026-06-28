import { type MiokiContext, wait } from "mioki";
import { getPluginRuntimeState, type AIService } from "mioku";
import type { AdminConfig } from "../config";

export async function resolveMemberName(
  ctx: MiokiContext,
  groupId: number,
  userId: number,
  selfId: number,
): Promise<string> {
  try {
    const member = await ctx
      .pickBot(selfId)
      .getGroupMemberInfo(groupId, userId);
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

function batchKey(selfId: number, groupId: number): string {
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
  ctx: MiokiContext;
  aiService?: AIService;
  config: AdminConfig;
  selfId: number;
  groupId: number;
  groupName: string;
  members: PendingMember[];
  promptInjections?: { content: string; title?: string }[];
}): Promise<string> {
  const { ctx, aiService, config, selfId, groupId, groupName, members, promptInjections } =
    options;
  if (!members.length) return "";

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
      selfId,
      groupId,
      send: true,
      instruction: [
        `当前有 ${members.length} 位新成员同时入群，请一次性发送一段统一的欢迎语（不要逐个 @ 欢迎、不要重复点名）。`,
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
  ctx: MiokiContext;
  aiService?: AIService;
  config: AdminConfig;
  selfId: number;
  groupId: number;
  groupName: string;
  userId: number;
  memberName: string;
  promptInjections?: { content: string; title?: string }[];
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
  });
  if (!welcomeMessage) return;
  const bot = ctx.pickBot(selfId);
  if (!bot) return;
  try {
    await bot.sendGroupMsg(groupId, [ctx.segment.text(welcomeMessage)]);
  } catch (error) {
    ctx.logger.warn(`发送入群欢迎失败: ${error}`);
  }
}

export async function triggerSingleWelcome(options: {
  ctx: MiokiContext;
  aiService?: AIService;
  getConfig: () => AdminConfig;
  selfId: number;
  groupId: number;
  groupName: string;
  userId: number;
  memberName?: string;
  promptInjections?: { content: string; title?: string }[];
}): Promise<void> {
  const memberName =
    options.memberName ||
    (await resolveMemberName(
      options.ctx,
      options.groupId,
      options.userId,
      options.selfId,
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
  });
}

export function registerWelcomeHandler(
  ctx: MiokiContext,
  aiService: AIService | undefined,
  getConfig: () => AdminConfig,
  shouldSuppress?: (info: {
    selfId: number;
    groupId: number;
    userId: number;
    groupName: string;
  }) => Promise<boolean> | boolean,
): () => void {
  const batches = getBatchMap();

  const dispose = ctx.handle("notice.group.increase" as any, async (event: any) => {
    const cfg = getConfig();
    const selfId = Number(event?.self_id || ctx.self_id);
    const groupId = Number(event?.group_id || 0);
    const userId = Number(event?.user_id || 0);
    if (!groupId || !userId) return;
    if (userId === selfId) return;

    const groupName =
      String(event?.group?.group_name || "").trim() || String(groupId);

    if (
      shouldSuppress &&
      (await shouldSuppress({ selfId, groupId, userId, groupName }))
    ) {
      return;
    }

    if (!cfg.welcome.enabled) return;

    const batchWindowMs = Math.max(0, Number(cfg.welcome.batchWindowMs) || 0);

    if (batchWindowMs === 0) {
      const memberName = await resolveMemberName(ctx, groupId, userId, selfId);
      const welcomeMessage = await flushBatch({
        ctx,
        aiService,
        config: cfg,
        selfId,
        groupId,
        groupName,
        members: [{ userId, memberName }],
      });
      if (!welcomeMessage) return;
      const bot = ctx.pickBot(selfId);
      if (!bot) return;
      try {
        await bot.sendGroupMsg(groupId, [ctx.segment.text(welcomeMessage)]);
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

    const memberName = await resolveMemberName(ctx, groupId, userId, selfId);
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
        });
        if (!welcomeMessage) return;

        const bot = ctx.pickBot(selfId);
        if (!bot) return;
        try {
          await bot.sendGroupMsg(groupId, [ctx.segment.text(welcomeMessage)]);
        } catch (error) {
          ctx.logger.warn(`发送入群欢迎失败: ${error}`);
        }
      } catch (error) {
        ctx.logger.error(`admin welcome 批次处理失败: ${error}`);
      }
    }, batchWindowMs);
  });

  return () => {
    for (const state of batches.values()) {
      if (state.timer) clearTimeout(state.timer);
    }
    batches.clear();
    dispose();
  };
}