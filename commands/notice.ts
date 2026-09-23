import type { MessageEvent, MiokuContext } from "mioku";
import { getService, Services } from "mioku";

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export async function replyAdminErrorNotice(options: {
  ctx: MiokuContext;
  event: MessageEvent;
  instruction: string;
  fallbackMessage: string;
  error?: unknown;
}): Promise<void> {
  const text = options.ctx.text(options.event)?.trim() ?? "";
  // 只对真正的命令消息做 AI 兜底提示,普通聊天不打扰(命令支持 / 与 . 前缀)
  if (!/^[./]/.test(text)) {
    return;
  }
  if (options.error != null) {
    options.ctx.logger.error(
      `[admin] ${options.instruction}\n执行错误: ${normalizeErrorMessage(options.error)}`,
    );
  }

  const aiService = getService(options.ctx, Services.AI);
  const chatRuntime = aiService?.getChatRuntime();
  if (chatRuntime) {
    try {
      const instructionLines = [options.instruction];
      if (options.error != null) {
        instructionLines.push(
          `执行错误: ${normalizeErrorMessage(options.error)}`,
        );
      }
      await chatRuntime.generateNotice({
        event: options.event,
        instruction: instructionLines.join("\n"),
        send: true,
        promptInjections: [
            {
              title: "Admin Plugin Notice",
              content:
                "An admin-related action was triggered. Judge whether the user likely intended this action or triggered it accidentally. If it looks accidental or like a casual mention, weave a natural reply into the conversation without mentioning the plugin, tools, or commands. If the user seems to want this feature, respond helpfully.",
            },
          ],
      });
      return;
    } catch (noticeError) {
      options.ctx.logger.error(`admin error notice failed: ${noticeError}`);
    }
  }

  await options.event.reply(options.fallbackMessage, true);
}
