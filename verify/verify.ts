import type { MiokiContext } from "mioki";
import type { AIService } from "mioku";
import { getPluginRuntimeState } from "mioku";
import type { AdminConfig, VerifyConfig, VerifyMode } from "../config";
import { getGroupVerifyConfig } from "../config";
import { resolveMemberName, triggerSingleWelcome } from "../notify/welcome";

export interface VerifyControllerOptions {
  ctx: MiokiContext;
  aiService?: AIService;
  getConfig: () => AdminConfig;
  getVerifyConfig: () => VerifyConfig;
  getWelcomeEnabled: () => boolean;
}

export interface MemberJoinInfo {
  selfId: number;
  groupId: number;
  userId: number;
  groupName: string;
}

interface PendingVerify {
  selfId: number;
  groupId: number;
  userId: number;
  memberName: string;
  groupName: string;
  mode: VerifyMode;
  promptMessageId?: number;
  reactionEmojiId?: string;
  numberAnswer?: number;
  invalidCount: number;
  startedAt: number;
  passed: boolean;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
  delayTimer: ReturnType<typeof setTimeout> | null;
}

const RUNTIME_KEY = "verifyPending";

const PASS_REACTION_EMOJI_ID = "144";

const VERIFY_PASS_PROMPT_INJECTION = {
  title: "新成员通过入群验证",
  content: "这位新成员刚刚通过了入群验证，请在欢迎语中点到验证通过类似话语",
};

function getPendingMap(): Map<string, PendingVerify> {
  const state = getPluginRuntimeState("admin");
  if (!state[RUNTIME_KEY]) {
    state[RUNTIME_KEY] = new Map<string, PendingVerify>();
  }
  return state[RUNTIME_KEY] as Map<string, PendingVerify>;
}

function pendingKey(selfId: number, groupId: number, userId: number): string {
  return `${selfId}:${groupId}:${userId}`;
}

function clearTimers(p: PendingVerify) {
  if (p.timeoutTimer) {
    clearTimeout(p.timeoutTimer);
    p.timeoutTimer = null;
  }
  if (p.delayTimer) {
    clearTimeout(p.delayTimer);
    p.delayTimer = null;
  }
}

function genNumberQuestion(): { question: string; answer: number } {
  const a = Math.floor(Math.random() * 99) + 1;
  const b = Math.floor(Math.random() * 99) + 1;
  if (Math.random() < 0.5 && a >= b) {
    return { question: `${a} - ${b} = ?`, answer: a - b };
  }
  return { question: `${a} + ${b} = ?`, answer: a + b };
}

function extractNumbers(text: string): number[] {
  const matches = String(text || "").match(/-?\d+/g);
  return matches ? matches.map(Number) : [];
}

export interface VerifyController {
  handleMemberJoin(info: MemberJoinInfo): Promise<boolean>;
  restartVerification(info: MemberJoinInfo): Promise<boolean>;
  bypassVerification(info: MemberJoinInfo): Promise<void>;
  dispose(): void;
}

export function createVerifyController(
  options: VerifyControllerOptions,
): VerifyController {
  const { ctx, aiService, getConfig, getVerifyConfig, getWelcomeEnabled } =
    options;
  const pending = getPendingMap();

  async function recallMessage(bot: any, messageId: number) {
    try {
      await bot.api("delete_msg", { message_id: messageId });
    } catch (err) {
      ctx.logger.warn(`admin verify 撤回消息失败: ${err}`);
    }
  }

  async function kickMember(bot: any, groupId: number, userId: number) {
    try {
      await bot.api("set_group_kick", {
        group_id: groupId,
        user_id: userId,
        reject_add_request: false,
      });
    } catch (err) {
      ctx.logger.warn(`admin verify 踢出成员失败: ${err}`);
    }
  }

  function removePending(key: string) {
    const p = pending.get(key);
    if (p) {
      clearTimers(p);
      pending.delete(key);
    }
  }

  async function passVerification(p: PendingVerify) {
    if (p.passed) return;
    p.passed = true;
    clearTimers(p);
    pending.delete(pendingKey(p.selfId, p.groupId, p.userId));

    if (p.mode === "reaction" && p.promptMessageId) {
      const bot = ctx.pickBot(p.selfId);
      if (bot) {
        try {
          await bot.addReaction(p.promptMessageId, PASS_REACTION_EMOJI_ID);
        } catch (err) {
          ctx.logger.warn(`admin verify 通过表态失败: ${err}`);
        }
      }
    }

    if (!getWelcomeEnabled()) return;
    try {
      await triggerSingleWelcome({
        ctx,
        aiService,
        getConfig,
        selfId: p.selfId,
        groupId: p.groupId,
        groupName: p.groupName,
        userId: p.userId,
        memberName: p.memberName,
        promptInjections: [VERIFY_PASS_PROMPT_INJECTION],
      });
    } catch (err) {
      ctx.logger.error(`admin verify 通过后欢迎失败: ${err}`);
    }
  }

  async function failKick(p: PendingVerify, reason: string) {
    clearTimers(p);
    pending.delete(pendingKey(p.selfId, p.groupId, p.userId));
    const cfg = getVerifyConfig();
    if (!cfg.kickOnFail) return;
    const bot = ctx.pickBot(p.selfId);
    if (!bot) return;
    ctx.logger.info(
      `admin verify 踢出群 ${p.groupId} 用户 ${p.userId}（${reason}）`,
    );
    await kickMember(bot, p.groupId, p.userId);
  }

  async function timeoutExpire(p: PendingVerify) {
    p.timeoutTimer = null;
    const cfg = getVerifyConfig();
    if (!cfg.kickOnTimeout) {
      pending.delete(pendingKey(p.selfId, p.groupId, p.userId));
      return;
    }
    const bot = ctx.pickBot(p.selfId);
    if (!bot) {
      pending.delete(pendingKey(p.selfId, p.groupId, p.userId));
      return;
    }
    try {
      await bot.sendGroupMsg(p.groupId, [
        ctx.segment.at(String(p.userId)),
        ctx.segment.text(" 验证超时啦，下次再来哦～"),
      ]);
    } catch (err) {
      ctx.logger.warn(`admin verify 超时提示发送失败: ${err}`);
    }
    ctx.logger.info(`admin verify 超时踢出群 ${p.groupId} 用户 ${p.userId}`);
    await kickMember(bot, p.groupId, p.userId);
    pending.delete(pendingKey(p.selfId, p.groupId, p.userId));
  }

  async function sendReactionPrompt(p: PendingVerify) {
    const cfg = getVerifyConfig();
    const bot = ctx.pickBot(p.selfId);
    if (!bot) return;
    let messageId: number | undefined;
    try {
      const res = await bot.sendGroupMsg(p.groupId, [
        ctx.segment.at(String(p.userId)),
        ctx.segment.text(` ${cfg.reactionPrompt}`),
      ]);
      messageId = Number(res?.message_id || 0) || undefined;
    } catch (err) {
      ctx.logger.warn(`admin verify 发送回应提示失败: ${err}`);
      return;
    }
    if (!messageId) return;
    p.promptMessageId = messageId;
    try {
      await bot.addReaction(messageId, cfg.reactionEmojiId);
    } catch (err) {
      ctx.logger.warn(`admin verify 添加表态失败: ${err}`);
    }
  }

  async function sendNumberPrompt(p: PendingVerify) {
    const cfg = getVerifyConfig();
    const bot = ctx.pickBot(p.selfId);
    if (!bot) return;
    const { question, answer } = genNumberQuestion();
    p.numberAnswer = answer;
    const prompt = cfg.numberPrompt.replace("{question}", question);
    try {
      await bot.sendGroupMsg(p.groupId, [
        ctx.segment.at(String(p.userId)),
        ctx.segment.text(` ${prompt}`),
      ]);
    } catch (err) {
      ctx.logger.warn(`admin verify 发送数字提示失败: ${err}`);
    }
  }

  async function startVerification(
    info: MemberJoinInfo,
    skipDelay = false,
  ): Promise<boolean> {
    const cfg = getVerifyConfig();
    const groupCfg = getGroupVerifyConfig(cfg, info.groupId);
    if (!groupCfg.enabled) return false;

    const mode = groupCfg.mode;
    if (mode === "chiral") {
      // TODO: 手性碳验证模式尚未实现
      ctx.logger.warn(
        `admin verify 手性碳模式暂未实现，群 ${info.groupId} 跳过验证`,
      );
      return false;
    }

    const memberName = await resolveMemberName(
      ctx,
      info.groupId,
      info.userId,
      info.selfId,
    );

    const entry: PendingVerify = {
      selfId: info.selfId,
      groupId: info.groupId,
      userId: info.userId,
      memberName,
      groupName: info.groupName,
      mode,
      invalidCount: 0,
      startedAt: Date.now(),
      passed: false,
      timeoutTimer: null,
      delayTimer: null,
    };

    if (mode === "reaction") {
      entry.reactionEmojiId = cfg.reactionEmojiId;
    }

    pending.set(pendingKey(info.selfId, info.groupId, info.userId), entry);

    if (mode === "reaction") {
      const delay = skipDelay ? 0 : Math.max(0, cfg.reactionDelayMs);
      entry.delayTimer = setTimeout(
        () => {
          entry.delayTimer = null;
          void sendReactionPrompt(entry);
        },
        delay,
      );
    } else if (mode === "number") {
      void sendNumberPrompt(entry);
    }

    entry.timeoutTimer = setTimeout(
      () => {
        void timeoutExpire(entry);
      },
      Math.max(1000, cfg.verifyTimeoutMs),
    );

    return true;
  }

  async function onGroupMessage(event: any) {
    if (event?.message_type !== "group") return;
    const selfId = Number(event?.self_id || 0);
    const groupId = Number(event?.group_id || 0);
    const userId = Number(event?.user_id || 0);
    if (!selfId || !groupId || !userId) return;
    if (userId === selfId) return;

    const key = pendingKey(selfId, groupId, userId);
    const p = pending.get(key);
    if (!p || p.passed) return;

    const cfg = getVerifyConfig();
    const messageId = Number(event?.message_id || 0);
    const bot = ctx.pickBot(selfId);

    if (p.mode === "number" && p.numberAnswer != null) {
      const text = ctx.text(event) || "";
      if (extractNumbers(text).includes(p.numberAnswer)) {
        await passVerification(p);
        return;
      }
    }

    if (messageId && bot) {
      await recallMessage(bot, messageId);
    }

    p.invalidCount += 1;
    if (p.invalidCount >= cfg.maxInvalidMessages) {
      await failKick(p, `连续 ${cfg.maxInvalidMessages} 次无关消息`);
    }
  }

  async function onGroupReaction(event: any) {
    const selfId = Number(event?.self_id || 0);
    const groupId = Number(event?.group_id || 0);
    const userId = Number(event?.user_id || 0);
    if (!selfId || !groupId || !userId) return;
    if (userId === selfId) return;
    if (event?.is_add === false) return;

    const key = pendingKey(selfId, groupId, userId);
    const p = pending.get(key);
    if (!p || p.passed || p.mode !== "reaction") return;

    const emojiId = String(p.reactionEmojiId || "");
    const likes: any[] = Array.isArray(event?.likes) ? event.likes : [];
    const matched = likes.some((l) => String(l?.emoji_id || "") === emojiId);
    if (!matched) return;

    if (!p.promptMessageId) return;
    if (Number(event?.message_id || 0) !== p.promptMessageId) return;

    await passVerification(p);
  }

  const messageDispose = ctx.handle(
    "message.group" as any,
    async (event: any) => {
      try {
        await onGroupMessage(event);
      } catch (err) {
        ctx.logger.error(`admin verify message 处理失败: ${err}`);
      }
    },
  );

  const reactionDispose = ctx.handle(
    "notice.group.reaction" as any,
    async (event: any) => {
      try {
        await onGroupReaction(event);
      } catch (err) {
        ctx.logger.error(`admin verify reaction 处理失败: ${err}`);
      }
    },
  );

  async function restartVerification(info: MemberJoinInfo): Promise<boolean> {
    removePending(pendingKey(info.selfId, info.groupId, info.userId));
    return startVerification(info, true);
  }

  const decreaseDispose = ctx.handle(
    "notice.group.decrease" as any,
    async (event: any) => {
      const selfId = Number(event?.self_id || 0);
      const groupId = Number(event?.group_id || 0);
      const userId = Number(event?.user_id || 0);
      if (!selfId || !groupId || !userId) return;
      const key = pendingKey(selfId, groupId, userId);
      const p = pending.get(key);
      if (!p) return;
      clearTimers(p);
      pending.delete(key);
      ctx.logger.info(
        `admin verify 成员 ${userId} 退出群 ${groupId}，清除验证队列`,
      );
    },
  );

  async function bypassVerification(info: MemberJoinInfo): Promise<void> {
    removePending(pendingKey(info.selfId, info.groupId, info.userId));
  }

  return {
    handleMemberJoin: startVerification,
    restartVerification,
    bypassVerification,
    dispose() {
      for (const p of pending.values()) clearTimers(p);
      pending.clear();
      messageDispose();
      reactionDispose();
      decreaseDispose();
    },
  };
}
