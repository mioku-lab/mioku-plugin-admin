import type { MiokuContext } from "mioku";
import type { VerifyConfig } from "./config";
import type { PendingVerify } from "./types";

export async function sendReactionPrompt(
  ctx: MiokuContext,
  cfg: VerifyConfig,
  p: PendingVerify,
): Promise<void> {
  const bot = ctx.pickBot(String(p.selfId));
  if (!bot) return;
  let messageId: number | undefined;
  try {
    const res = await bot.sendMessage({ type: "group", group_id: String(p.groupId) }, [
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
    await bot.sendApi("set_msg_emoji_like", {
      message_id: String(messageId),
      emoji_id: cfg.reactionEmojiId,
      set: true,
    });
  } catch (err) {
    ctx.logger.warn(`admin verify 添加表态失败: ${err}`);
  }
}

export function isReactionPass(p: PendingVerify, event: unknown): boolean {
  if (!p.promptMessageId) return false;
  const raw = event as { message_id?: unknown; likes?: unknown };
  if (Number(raw?.message_id || 0) !== p.promptMessageId) return false;
  const emojiId = String(p.reactionEmojiId || "");
  const likes: unknown[] = Array.isArray(raw?.likes) ? raw.likes : [];
  return likes.some((l) => {
    const item = l as { emoji_id?: unknown };
    return String(item?.emoji_id || "") === emojiId;
  });
}
