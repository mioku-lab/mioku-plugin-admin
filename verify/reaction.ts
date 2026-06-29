import type { MiokiContext } from "mioki";
import type { VerifyConfig } from "./config";
import type { PendingVerify } from "./types";

export async function sendReactionPrompt(
  ctx: MiokiContext,
  cfg: VerifyConfig,
  p: PendingVerify,
): Promise<void> {
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

export function isReactionPass(p: PendingVerify, event: any): boolean {
  if (!p.promptMessageId) return false;
  if (Number(event?.message_id || 0) !== p.promptMessageId) return false;
  const emojiId = String(p.reactionEmojiId || "");
  const likes: any[] = Array.isArray(event?.likes) ? event.likes : [];
  return likes.some((l) => String(l?.emoji_id || "") === emojiId);
}
