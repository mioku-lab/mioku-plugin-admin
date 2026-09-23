import type { Bot, MiokuContext } from "mioku";
import type { VerifyConfig } from "./config";
import type { PendingVerify } from "./types";

export async function sendReactionPrompt(
  ctx: MiokuContext,
  cfg: VerifyConfig,
  p: PendingVerify,
): Promise<void> {
  const bot = p.bot;
  if (!bot) return;
  let messageId: string | number | undefined;
  try {
    const res = await bot.sendMessage({ type: "group", group_id: p.groupId }, [
      ctx.segment.at(String(p.userId)),
      ctx.segment.text(` ${cfg.reactionPrompt}`),
    ]);
    messageId = res?.message_id;
  } catch (err) {
    ctx.logger.warn(`admin verify 发送回应提示失败: ${err}`);
    return;
  }
  if (messageId == null || messageId === "") return;
  p.promptMessageId = messageId;
  await addReaction(bot, messageId, cfg.reactionEmojiId, ctx);
}

/** 表态能力按平台探测:icqq 扩展方法优先,其次 OneBot 原生 action */
export async function addReaction(
  bot: Bot,
  messageId: string,
  emojiId: string,
  ctx: { logger: { warn(message: string): void } },
): Promise<boolean> {
  const extended = bot as unknown as {
    setReaction?: (
      messageId: string,
      emojiId: string,
      set: boolean,
    ) => Promise<unknown>;
  };
  if (typeof extended.setReaction === "function") {
    try {
      await extended.setReaction(messageId, emojiId, true);
      return true;
    } catch (err) {
      ctx.logger.warn(`admin verify 添加表态失败: ${err}`);
      return false;
    }
  }
  if (bot.adapter === "onebotv11") {
    try {
      await bot.sendApi("set_msg_emoji_like", {
        message_id: messageId,
        emoji_id: emojiId,
        set: true,
      });
      return true;
    } catch (err) {
      ctx.logger.warn(`admin verify 添加表态失败: ${err}`);
      return false;
    }
  }
  ctx.logger.warn(`admin verify 当前平台(${bot.adapter})不支持消息表态`);
  return false;
}

/** icqq GroupReactionEvent 的 seq 提取（cqhttp message_id 为 base64，seq 在第 9-12 字节，与 icqq parseGroupMessageId 同布局） */
function seqOfIcqqMessageId(messageId: string | number): number {
  try {
    const buf = Buffer.from(String(messageId), "base64");
    return buf.length >= 12 ? buf.readUInt32BE(8) : 0;
  } catch {
    return 0;
  }
}

export function isReactionPass(p: PendingVerify, event: unknown): boolean {
  if (!p.promptMessageId) return false;
  const ev = event as { raw?: unknown };
  const raw = (ev.raw ?? event) as {
    message_id?: unknown;
    likes?: unknown;
    notice_type?: unknown;
    sub_type?: unknown;
    set?: unknown;
    seq?: unknown;
    id?: unknown;
  };
  const emojiId = String(p.reactionEmojiId || "");

  if (
    raw?.sub_type === "reaction" &&
    String(raw.notice_type ?? "") === "group"
  ) {
    if (raw.set === false) return false;
    const seq = seqOfIcqqMessageId(p.promptMessageId);
    return (
      seq > 0 && Number(raw.seq) === seq && String(raw.id ?? "") === emojiId
    );
  }

  if (String(raw?.message_id ?? "") !== String(p.promptMessageId ?? "")) {
    return false;
  }
  const likes: unknown[] = Array.isArray(raw?.likes) ? raw.likes : [];
  return likes.some((l) => {
    const item = l as { emoji_id?: unknown };
    return String(item?.emoji_id || "") === emojiId;
  });
}
