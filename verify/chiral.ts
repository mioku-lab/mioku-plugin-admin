import type { MiokiContext } from "mioki";
import type { VerifyConfig } from "./config";
import type { PendingVerify } from "./types";

interface ChiralCaptcha {
  regions: string[];
  imageDataUrl: string;
}

function extractRegions(text: string): string[] {
  const matches = String(text || "").match(/[A-Za-z]\s*\d+/g);
  if (!matches) return [];
  return matches.map((m) => m.replace(/\s+/g, "").toUpperCase());
}

async function fetchChiralCaptcha(
  apiUrl: string,
  difficulty: "simple" | "hard",
): Promise<ChiralCaptcha> {
  const res = await fetch(
    `${apiUrl}/captcha/chiralCarbon/getChiralCarbonCaptcha`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: true, hint: difficulty === "simple" }),
    },
  );
  if (!res.ok) {
    throw new Error(`手性碳验证接口返回 ${res.status}`);
  }
  const json: any = await res.json();
  const data = json?.data?.data;
  const regions: string[] = Array.isArray(data?.regions)
    ? data.regions.map((r: any) => String(r).toUpperCase())
    : [];
  const imageDataUrl = String(data?.base64 || "").trim();
  if (!regions.length || !imageDataUrl) {
    throw new Error("手性碳验证接口返回数据缺失");
  }
  return { regions, imageDataUrl };
}

export async function prepareChiral(
  ctx: MiokiContext,
  cfg: VerifyConfig,
  p: PendingVerify,
): Promise<boolean> {
  const bot = ctx.pickBot(p.selfId);
  if (!bot) return false;
  try {
    const captcha = await fetchChiralCaptcha(cfg.chiralApiUrl, cfg.chiralDifficulty);
    p.requiredRegions = captcha.regions;
    p.matchedRegions = new Set<string>();
    const prompt = cfg.chiralPrompt.replace(
      "{count}",
      String(captcha.regions.length),
    );
    await bot.sendGroupMsg(p.groupId, [
      ctx.segment.at(String(p.userId)),
      ctx.segment.text(` ${prompt}`),
      ctx.segment.image(captcha.imageDataUrl),
    ]);
    return true;
  } catch (err) {
    ctx.logger.error(`admin verify 手性碳验证准备失败: ${err}`);
    return false;
  }
}

export type ChiralCheckResult = {
  status: "pass" | "progress" | "none";
  remaining: number;
};

export function checkChiralAnswer(
  p: PendingVerify,
  text: string,
): ChiralCheckResult {
  const required = p.requiredRegions ?? [];
  if (!required.length) return { status: "none", remaining: 0 };
  if (!p.matchedRegions) p.matchedRegions = new Set<string>();

  const requiredSet = new Set(required);
  let progressed = false;
  for (const region of extractRegions(text)) {
    if (requiredSet.has(region) && !p.matchedRegions.has(region)) {
      p.matchedRegions.add(region);
      progressed = true;
    }
  }

  const remaining = requiredSet.size - p.matchedRegions.size;
  if (remaining <= 0) return { status: "pass", remaining: 0 };
  return { status: progressed ? "progress" : "none", remaining };
}
