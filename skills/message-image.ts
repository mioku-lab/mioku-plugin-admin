import type { Bot } from "mioku";

/** 通过框架能力取消息里的第一张图片(适配器各自实现,不依赖 OneBot 原生 action) */
export async function getImageUrlByMessageId(
  bot: Bot,
  messageId: string,
): Promise<string | null> {
  try {
    const msg = await bot.getMessage(messageId);
    const segments = Array.isArray(msg?.message) ? msg.message : [];
    for (const segment of segments) {
      if (segment?.type !== "image") continue;
      const data = (segment.data ?? {}) as Record<string, unknown>;
      const attachment = segment.attachment as
        | { url?: string; file?: string }
        | undefined;
      const url =
        (typeof data.url === "string" && data.url) ||
        (typeof data.file === "string" && data.file) ||
        attachment?.url ||
        attachment?.file ||
        "";
      if (url) return url;
    }
    return null;
  } catch {
    return null;
  }
}
