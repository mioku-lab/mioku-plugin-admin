import type { Bot } from "mioku";

export async function getImageUrlByMessageId(
  bot: Bot,
  messageId: number,
): Promise<string | null> {
  try {
    const msg = await bot.sendApi<{
      message?: Array<{ type?: string; url?: string; file?: string }>;
    }>("get_msg", { message_id: messageId });
    const segments = Array.isArray(msg?.message) ? msg.message : [];
    const imageSeg = segments.find((seg) => seg?.type === "image");
    if (!imageSeg) return null;

    return imageSeg.url || imageSeg.file || null;
  } catch {
    return null;
  }
}
