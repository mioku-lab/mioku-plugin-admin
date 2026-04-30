import type { AIService } from "../../../src/services/ai/types";
import type { MiokiContext } from "mioki";

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
  ctx: MiokiContext;
  event: any;
  instruction: string;
  fallbackMessage: string;
  error?: unknown;
}): Promise<void> {
  if (options.error != null) {
    options.ctx.logger.error(
      `[admin] ${options.instruction}\n执行错误: ${normalizeErrorMessage(options.error)}`,
    );
  }

  const aiService = options.ctx.services?.ai as AIService | undefined;
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
            title: "Admin Plugin Error Notice",
            content:
              "You are handling admin plugin validation or execution errors. If the user's command is missing a parameter, if the user tells you the missing parameter in the next step, you can directly use skills to help the user complete the required operation",
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
