import type { MiokiContext } from "mioki";
import {
  resolveVerifyPrompt,
  type VerifyConfig,
  type VerifyGroupConfig,
} from "./config";
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
  groupCfg: VerifyGroupConfig,
  p: PendingVerify,
): Promise<void> {
  const bot = ctx.pickBot(p.selfId);
  if (!bot) return;
  const { question, answer } = genNumberQuestion();
  p.numberAnswer = answer;
  const basePrompt = cfg.numberPrompt.replace("{question}", question);
  const prompt = resolveVerifyPrompt(basePrompt, groupCfg);
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
