import type { Bot, MiokuContext, RouteEvent } from "mioku";

import { existsSync } from "fs";
import { getMemberRole } from "../config";
import { resolveMemberName, triggerSingleWelcome } from "../notify/welcome";
import {
  getGroupVerifyConfig,
  hasCustomPrompt,
  upsertGroupVerifyConfig,
} from "./config";
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
import { getGroupPromptImagePath } from "../utils/prompt-image-store";

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

  async function recallMessage(bot: Bot, messageId: number) {
    try {
      await bot.recallMessage(messageId);
    } catch (err) {
      ctx.logger.warn(`admin verify 撤回消息失败: ${err}`);
    }
  }

  async function kickMember(bot: Bot, groupId: number, userId: number) {
    try {
      await bot.kickMember(groupId, userId, false);
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

  async function passVerification(p: PendingVerify, bot?: Bot) {
    if (p.passed) return;
    p.passed = true;
    clearTimers(p);
    pending.delete(pendingKey(p.selfId, p.groupId, p.userId));

    if (
      p.mode === "reaction" &&
      p.promptMessageId &&
      bot &&
      (bot.adapter === "onebotv11" || bot.adapter === "icqq")
    ) {
      try {
        if (bot.adapter === "onebotv11") {
          // onebot：set_msg_emoji_like 专属 action
          await bot.sendApi("set_msg_emoji_like", {
            message_id: p.promptMessageId,
            emoji_id: PASS_REACTION_EMOJI_ID,
            set: true,
          });
        } else {
          // icqq：Group.setReaction（0x9082）
          await bot.setReaction(p.promptMessageId, PASS_REACTION_EMOJI_ID, true);
        }
      } catch (err) {
        ctx.logger.warn(`admin verify 通过表态失败: ${err}`);
      }
    }

    if (!getWelcomeEnabled()) return;
    try {
      const customSent = await trySendCustomWelcome({
        selfId: p.selfId,
        groupId: p.groupId,
        userId: p.userId,
        groupName: p.groupName,
      }, bot);
      if (customSent) return;
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

  async function failKick(p: PendingVerify, reason: string, bot?: Bot) {
    clearTimers(p);
    pending.delete(pendingKey(p.selfId, p.groupId, p.userId));
    const cfg = getVerifyConfig();
    if (!cfg.kickOnFail) return;
    const target = bot ?? p.bot;
    if (!target) return;
    ctx.logger.info(
      `admin verify 踢出群 ${p.groupId} 用户 ${p.userId}（${reason}）`,
    );
    await kickMember(target, p.groupId, p.userId);
  }

  async function timeoutExpire(p: PendingVerify, bot?: Bot) {
    p.timeoutTimer = null;
    const cfg = getVerifyConfig();
    if (!cfg.kickOnTimeout) {
      pending.delete(pendingKey(p.selfId, p.groupId, p.userId));
      return;
    }
    const target = bot ?? p.bot;
    if (!target) {
      pending.delete(pendingKey(p.selfId, p.groupId, p.userId));
      return;
    }
    try {
      await target.sendMessage({ type: "group", group_id: p.groupId}, [
        ctx.segment.at(String(p.userId)),
        ctx.segment.text(" 验证超时啦，下次再来哦～"),
      ]);
    } catch (err) {
      ctx.logger.warn(`admin verify 超时提示发送失败: ${err}`);
    }
    ctx.logger.info(`admin verify 超时踢出群 ${p.groupId} 用户 ${p.userId}`);
    await kickMember(target, p.groupId, p.userId);
    pending.delete(pendingKey(p.selfId, p.groupId, p.userId));
  }

  async function startVerification(
    info: MemberJoinInfo,
    bot?: Bot,
    skipDelay = false,
  ): Promise<boolean> {
    const cfg = getVerifyConfig();
    const groupCfg = getGroupVerifyConfig(cfg, info.groupId);
    if (!groupCfg.enabled) return false;

    if (!bot) return false;

    const botRole = await getMemberRole(bot, info.groupId, info.selfId);
    if (botRole !== "owner" && botRole !== "admin") {
      try {
        await bot.sendMessage({ type: "group", group_id: info.groupId}, [
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
      bot,
      info.groupId,
      info.userId,
    );

    const entry: PendingVerify = {
      selfId: info.selfId,
      groupId: info.groupId,
      userId: info.userId,
      memberName,
      groupName: info.groupName,
      mode,
      bot,
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
        void timeoutExpire(entry, bot);
      },
      Math.max(1000, cfg.verifyTimeoutMs),
    );

    return true;
  }

  async function onGroupMessage(event: RouteEvent<"message.group">) {
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
    const bot = event.bot;

    if (p.mode === "number" && isNumberAnswerCorrect(p, text)) {
      await passVerification(p, bot);
      return;
    }

    if (p.mode === "chiral") {
      const result = checkChiralAnswer(p, text);
      if (result.status === "pass") {
        await passVerification(p, bot);
        return;
      }
      if (result.status === "progress") {
        if (bot) {
          try {
            await bot.sendMessage({ type: "group", group_id: groupId}, [
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
      await failKick(p, `连续 ${cfg.maxInvalidMessages} 次无关消息`, bot);
    }
  }

  async function onGroupReaction(event: RouteEvent<"notice.group.reaction">) {
    const selfId = Number(event?.self_id || 0);
    const groupId = Number(event?.group_id || 0);
    const userId = Number(event?.user_id || 0);
    if (!selfId || !groupId || !userId) return;
    if (userId === selfId) return;
    const raw = event.raw as { is_add?: boolean } | undefined;
    if (raw?.is_add === false) return;

    const key = pendingKey(selfId, groupId, userId);
    const p = pending.get(key);
    if (!p || p.passed || p.mode !== "reaction") return;

    if (isReactionPass(p, event)) {
      await passVerification(p, event.bot);
    }
  }

  const messageDispose = ctx.handle(
    "message.group",
    async (event) => {
      try {
        await onGroupMessage(event);
      } catch (err) {
        ctx.logger.error(`admin verify message 处理失败: ${err}`);
      }
    },
  );

  const reactionDispose = ctx.handle(
    "notice.group.reaction",
    async (event) => {
      try {
        await onGroupReaction(event);
      } catch (err) {
        ctx.logger.error(`admin verify reaction 处理失败: ${err}`);
      }
    },
  );

  const decreaseDispose = ctx.handle(
    "notice.group.decrease",
    async (event) => {
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

  async function restartVerification(info: MemberJoinInfo, bot?: Bot): Promise<boolean> {
    removePending(pendingKey(info.selfId, info.groupId, info.userId));
    return startVerification(info, bot, true);
  }

  async function bypassVerification(info: MemberJoinInfo): Promise<void> {
    removePending(pendingKey(info.selfId, info.groupId, info.userId));
  }

  async function trySendCustomWelcome(
    info: MemberJoinInfo,
    bot?: Bot,
  ): Promise<boolean> {
    const groupCfg = getGroupVerifyConfig(getVerifyConfig(), info.groupId);
    if (!hasCustomPrompt(groupCfg)) return false;
    if (!bot) return false;
    const target = bot;
    const segments: any[] = [];
    const prompt = String(groupCfg.customPrompt || "").trim();
    if (prompt) {
      segments.push(ctx.segment.text(prompt));
    }
    const filename = String(groupCfg.promptImage || "").trim();
    if (filename) {
      const imagePath = getGroupPromptImagePath(info.groupId, filename);
      if (!existsSync(imagePath)) {
        ctx.logger.warn(
          `admin verify 自定义入群提示图片缺失: ${imagePath}`,
        );
      } else {
        segments.push(ctx.segment.image(`file://${imagePath}`));
      }
    }
    if (!segments.length) return false;
    try {
      await target.sendMessage({ type: "group", group_id: info.groupId}, segments);
      return true;
    } catch (err) {
      ctx.logger.error(`admin verify 发送自定义入群提示失败: ${err}`);
      return false;
    }
  }

  return {
    handleMemberJoin: startVerification,
    restartVerification,
    bypassVerification,
    trySendCustomWelcome,
    dispose() {
      for (const p of pending.values()) clearTimers(p);
      pending.clear();
      messageDispose();
      reactionDispose();
      decreaseDispose();
    },
  };
}
