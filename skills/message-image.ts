export async function getImageUrlByMessageId(
  bot: any,
  messageId: number,
): Promise<string | null> {
  try {
    const msg =
      typeof bot?.getMsg === "function"
        ? await bot.getMsg(messageId)
        : await bot.api("get_msg", { message_id: messageId });
    const segments = Array.isArray(msg?.message) ? msg.message : [];
    const imageSeg = segments.find((seg: any) => seg?.type === "image");
    if (!imageSeg) {
      return null;
    }

    return imageSeg.url || imageSeg.file || null;
  } catch {
    return null;
  }
}
