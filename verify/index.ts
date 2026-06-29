import type { MiokiContext } from "mioki";
import { getMemberRole } from "../config";
import { resolveMemberName, triggerSingleWelcome } from "../notify/welcome";
import { getGroupVerifyConfig, upsertGroupVerifyConfig } from "./config";
import type {
  MemberJoinInfo,
  PendingVerify,
  VerifyController,
  VerifyControllerOptions,
} from "./types";
import { clearTimers, getPendingMap, pendingKey } from "./state";
import { isReactionPass, sendReactionPrompt } from "./reaction";
import { isNumberAnswerCorrect, sendNumberPrompt } from "./number";
import { checkChiralAnswer, prepareChiral } from "./chiral";

const PASS_REACTION_EMOJI_ID = "144";

const VERIFY_PASS_PROMPT_INJECTION = {
  title: "新成员通过入群验证",
  content: "这位新成员刚刚通过了入群验证，请在欢迎语中点到验证通过类似话语",
};

export function createVerifyController(
  options: VerifyControllerOptions,
): VerifyController {
  const {
    ctx,
    aiService,
    getConfig,
    getVerifyConfig,
    getWelcomeEnabled,
    setVerifyConfig,
  } = options;
  const pending = getPendingMap();

  async function disableGroupVerify(groupId: number, reason: string) {
    ctx.logger.warn(`admin verify 关闭群 ${groupId} 验证：${reason}`);
    try {
      await setVerifyConfig(
        upsertGroupVerifyConfig(getVerifyConfig(), groupId, { enabled: false }),
      );
    } catch (err) {
      ctx.logger.error(`admin verify 关闭群验证写回配置失败: ${err}`);
    }
  }

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

  async function startVerification(
    info: MemberJoinInfo,
    skipDelay = false,
  ): Promise<boolean> {
    const cfg = getVerifyConfig();
    const groupCfg = getGroupVerifyConfig(cfg, info.groupId);
    if (!groupCfg.enabled) return false;

    const bot = ctx.pickBot(info.selfId);
    if (!bot) return false;

    const botRole = await getMemberRole(bot, info.groupId, info.selfId);
    if (botRole !== "owner" && botRole !== "admin") {
      try {
        await bot.sendGroupMsg(info.groupId, [
          ctx.segment.text("我在不是管理员，没法入群验证啦，本群验证已关闭~"),
        ]);
      } catch (err) {
        ctx.logger.warn(`admin verify 提醒本群验证关闭失败: ${err}`);
      }
      await disableGroupVerify(
        info.groupId,
        `Bot 群内身份为 ${botRole}，非群主/管理员`,
      );
      return false;
    }

    const mode = groupCfg.mode;
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

    const key = pendingKey(info.selfId, info.groupId, info.userId);
    pending.set(key, entry);

    if (mode === "reaction") {
      const delay = skipDelay ? 0 : Math.max(0, cfg.reactionDelayMs);
      entry.delayTimer = setTimeout(() => {
        entry.delayTimer = null;
        void sendReactionPrompt(ctx, cfg, entry);
      }, delay);
    } else if (mode === "number") {
      void sendNumberPrompt(ctx, cfg, entry);
    } else if (mode === "chiral") {
      const ok = await prepareChiral(ctx, cfg, entry);
      if (!ok) {
        // 验证服务不可用时放行，避免误伤
        removePending(key);
        return false;
      }
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
    const text = ctx.text(event) || "";
    const messageId = Number(event?.message_id || 0);
    const bot = ctx.pickBot(selfId);

    if (p.mode === "number" && isNumberAnswerCorrect(p, text)) {
      await passVerification(p);
      return;
    }

    if (p.mode === "chiral") {
      const result = checkChiralAnswer(p, text);
      if (result.status === "pass") {
        await passVerification(p);
        return;
      }
      if (result.status === "progress") {
        if (bot) {
          try {
            await bot.sendGroupMsg(groupId, [
              ctx.segment.at(String(userId)),
              ctx.segment.text(` 答对一部分啦，还差 ${result.remaining} 个哦~`),
            ]);
          } catch (err) {
            ctx.logger.warn(`admin verify 手性碳进度提示发送失败: ${err}`);
          }
        }
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

    if (isReactionPass(p, event)) {
      await passVerification(p);
    }
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

  const decreaseDispose = ctx.handle(
    "notice.group.decrease" as any,
    async (event: any) => {
      const selfId = Number(event?.self_id || 0);
      const groupId = Number(event?.group_id || 0);
      const userId = Number(event?.user_id || 0);
      if (!selfId || !groupId || !userId) return;
      const key = pendingKey(selfId, groupId, userId);
      if (!pending.has(key)) return;
      removePending(key);
      ctx.logger.info(
        `admin verify 成员 ${userId} 退出群 ${groupId}，清除验证队列`,
      );
    },
  );

  async function restartVerification(info: MemberJoinInfo): Promise<boolean> {
    removePending(pendingKey(info.selfId, info.groupId, info.userId));
    return startVerification(info, true);
  }

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
