export type VerifyMode = "reaction" | "number" | "chiral";

export interface VerifyGroupConfig {
  groupId: number;
  enabled: boolean;
  mode: VerifyMode;
}

export interface VerifyConfig {
  groups: VerifyGroupConfig[];
  reactionEmojiId: string;
  reactionDelayMs: number;
  verifyTimeoutMs: number;
  reactionPrompt: string;
  numberPrompt: string;
  chiralApiUrl: string;
  chiralDifficulty: "simple" | "hard";
  chiralPrompt: string;
  maxInvalidMessages: number;
  kickOnFail: boolean;
  kickOnTimeout: boolean;
}

export const DEFAULT_VERIFY_CONFIG: VerifyConfig = {
  groups: [],
  reactionEmojiId: "424",
  reactionDelayMs: 3000,
  verifyTimeoutMs: 120000,
  reactionPrompt:
    "新来的小伙伴请在2分钟内点击下方红色按钮完成验证 不听话会被移出群聊喵~",
  numberPrompt:
    "新来的小伙伴请在2分钟内回答下面的题目完成验证，不听话移出群聊喵~\n请问：{question}",
  chiralApiUrl: "https://carbon.crystelf.top",
  chiralDifficulty: "simple",
  chiralPrompt:
    "新来的小伙伴请在2分钟内完成下面的手性碳验证：找出图中{count}个手性碳所在的格子，回复格子编号即可，不听话会被移出群聊喵~",
  maxInvalidMessages: 5,
  kickOnFail: true,
  kickOnTimeout: true,
};

export function normalizeVerifyMode(value: unknown): VerifyMode {
  const v = String(value || "").trim();
  if (v === "number" || v === "数字") return "number";
  if (v === "chiral" || v === "手性碳") return "chiral";
  return "reaction";
}

function normalizeVerifyGroup(raw: any): VerifyGroupConfig {
  const groupId = Number(raw?.groupId || raw?.group_id || 0);
  return {
    groupId: groupId > 0 ? groupId : 0,
    enabled: raw?.enabled === true,
    mode: normalizeVerifyMode(raw?.mode),
  };
}

export function normalizeVerifyConfig(raw: any): VerifyConfig {
  const groups: VerifyGroupConfig[] = Array.isArray(raw?.groups)
    ? raw.groups
        .map((g: any) => normalizeVerifyGroup(g))
        .filter((g: VerifyGroupConfig) => g.groupId > 0)
    : [];

  const numOr = (value: unknown, fallback: number): number => {
    const num = Number(value);
    return Number.isFinite(num) && num >= 0 ? Math.floor(num) : fallback;
  };

  return {
    groups,
    reactionEmojiId:
      typeof raw?.reactionEmojiId === "string" && raw.reactionEmojiId.trim()
        ? raw.reactionEmojiId.trim()
        : DEFAULT_VERIFY_CONFIG.reactionEmojiId,
    reactionDelayMs: numOr(
      raw?.reactionDelayMs,
      DEFAULT_VERIFY_CONFIG.reactionDelayMs,
    ),
    verifyTimeoutMs: numOr(
      raw?.verifyTimeoutMs,
      DEFAULT_VERIFY_CONFIG.verifyTimeoutMs,
    ),
    reactionPrompt:
      typeof raw?.reactionPrompt === "string" && raw.reactionPrompt.trim()
        ? raw.reactionPrompt
        : DEFAULT_VERIFY_CONFIG.reactionPrompt,
    numberPrompt:
      typeof raw?.numberPrompt === "string" && raw.numberPrompt.trim()
        ? raw.numberPrompt
        : DEFAULT_VERIFY_CONFIG.numberPrompt,
    chiralApiUrl:
      typeof raw?.chiralApiUrl === "string" && raw.chiralApiUrl.trim()
        ? raw.chiralApiUrl.trim().replace(/\/+$/, "")
        : DEFAULT_VERIFY_CONFIG.chiralApiUrl,
    chiralDifficulty: raw?.chiralDifficulty === "hard" ? "hard" : "simple",
    chiralPrompt:
      typeof raw?.chiralPrompt === "string" && raw.chiralPrompt.trim()
        ? raw.chiralPrompt
        : DEFAULT_VERIFY_CONFIG.chiralPrompt,
    maxInvalidMessages: numOr(
      raw?.maxInvalidMessages,
      DEFAULT_VERIFY_CONFIG.maxInvalidMessages,
    ),
    kickOnFail: raw?.kickOnFail ?? DEFAULT_VERIFY_CONFIG.kickOnFail,
    kickOnTimeout: raw?.kickOnTimeout ?? DEFAULT_VERIFY_CONFIG.kickOnTimeout,
  };
}

export function getGroupVerifyConfig(
  config: VerifyConfig,
  groupId: number,
): VerifyGroupConfig {
  const found = config.groups.find((g) => g.groupId === groupId);
  if (found) return found;
  return { groupId, enabled: false, mode: "reaction" };
}

export function upsertGroupVerifyConfig(
  config: VerifyConfig,
  groupId: number,
  patch: Partial<Omit<VerifyGroupConfig, "groupId">>,
): VerifyConfig {
  const idx = config.groups.findIndex((g) => g.groupId === groupId);
  const next = { ...config };
  if (idx >= 0) {
    next.groups = config.groups.map((g, i) =>
      i === idx ? { ...g, ...patch } : g,
    );
  } else {
    next.groups = [
      ...config.groups,
      { groupId, enabled: false, mode: "reaction", ...patch },
    ];
  }
  return next;
}
