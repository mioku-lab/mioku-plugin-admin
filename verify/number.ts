import type { MiokiContext } from "mioki";
import type { VerifyConfig } from "./config";
import type { PendingVerify } from "./types";

function genNumberQuestion(): { question: string; answer: number } {
  const a = Math.floor(Math.random() * 99) + 1;
  const b = Math.floor(Math.random() * 99) + 1;
  if (Math.random() < 0.5 && a >= b) {
    return { question: `${a} - ${b} = ?`, answer: a - b };
  }
  return { question: `${a} + ${b} = ?`, answer: a + b };
}

function extractNumbers(text: string): number[] {
  const matches = String(text || "").match(/-?\d+/g);
  return matches ? matches.map(Number) : [];
}

export async function sendNumberPrompt(
  ctx: MiokiContext,
  cfg: VerifyConfig,
  p: PendingVerify,
): Promise<void> {
  const bot = ctx.pickBot(p.selfId);
  if (!bot) return;
  const { question, answer } = genNumberQuestion();
  p.numberAnswer = answer;
  const prompt = cfg.numberPrompt.replace("{question}", question);
  try {
    await bot.sendGroupMsg(p.groupId, [
      ctx.segment.at(String(p.userId)),
      ctx.segment.text(` ${prompt}`),
    ]);
  } catch (err) {
    ctx.logger.warn(`admin verify 发送数字提示失败: ${err}`);
  }
}

export function isNumberAnswerCorrect(p: PendingVerify, text: string): boolean {
  if (p.numberAnswer == null) return false;
  return extractNumbers(text).includes(p.numberAnswer);
}
