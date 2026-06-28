import type { RecvAtElement, RecvElement, RecvImageElement } from "napcat-sdk";

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
  maxInvalidMessages: number;
  kickOnFail: boolean;
  kickOnTimeout: boolean;
}

export interface AdminConfig {
  notifyTarget: number[];
  notifyFriendMsg: boolean;
  notifyFriendRequest: boolean;
  notifyGroupInvite: boolean;
  notifyGroupBan: boolean;
  notifyGroupUnban: boolean;
  notifyGroupKick: boolean;
  welcome: {
    enabled: boolean;
    mode: "ai" | "text";
    text: string;
    aiPrompt: string;
    batchWindowMs: number;
  };
}

export const DEFAULT_CONFIG: AdminConfig = {
  notifyTarget: [],
  notifyFriendMsg: true,
  notifyFriendRequest: true,
  notifyGroupInvite: true,
  notifyGroupBan: true,
  notifyGroupUnban: true,
  notifyGroupKick: true,
  welcome: {
    enabled: true,
    mode: "ai",
    text: "欢迎新人～",
    aiPrompt: "",
    batchWindowMs: 20000,
  },
};

export const DEFAULT_VERIFY_CONFIG: VerifyConfig = {
  groups: [],
  reactionEmojiId: "424",
  reactionDelayMs: 3000,
  verifyTimeoutMs: 120000,
  reactionPrompt:
    "新来的小伙伴请在2分钟内点击下方红色按钮完成验证 不听话会被移出群聊喵~",
  numberPrompt:
    "新来的小伙伴请在2分钟内回答下面的题目完成验证，不听话移出群聊喵~\n请问：{question}",
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

export function normalizeConfig(raw: any): AdminConfig {
  return {
    notifyTarget: Array.isArray(raw?.notifyTarget)
      ? raw.notifyTarget.map((v: any) => Number(v)).filter((n: number) => n > 0)
      : DEFAULT_CONFIG.notifyTarget,
    notifyFriendMsg: raw?.notifyFriendMsg ?? DEFAULT_CONFIG.notifyFriendMsg,
    notifyFriendRequest:
      raw?.notifyFriendRequest ?? DEFAULT_CONFIG.notifyFriendRequest,
    notifyGroupInvite:
      raw?.notifyGroupInvite ?? DEFAULT_CONFIG.notifyGroupInvite,
    notifyGroupBan: raw?.notifyGroupBan ?? DEFAULT_CONFIG.notifyGroupBan,
    notifyGroupUnban: raw?.notifyGroupUnban ?? DEFAULT_CONFIG.notifyGroupUnban,
    notifyGroupKick: raw?.notifyGroupKick ?? DEFAULT_CONFIG.notifyGroupKick,
    welcome: {
      enabled: raw?.welcome?.enabled ?? DEFAULT_CONFIG.welcome.enabled,
      mode: raw?.welcome?.mode === "text" ? "text" : "ai",
      text:
        typeof raw?.welcome?.text === "string"
          ? raw.welcome.text
          : DEFAULT_CONFIG.welcome.text,
      aiPrompt:
        typeof raw?.welcome?.aiPrompt === "string"
          ? raw.welcome.aiPrompt
          : DEFAULT_CONFIG.welcome.aiPrompt,
      batchWindowMs: normalizeBatchWindowMs(raw?.welcome?.batchWindowMs),
    },
  };
}

function normalizeBatchWindowMs(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    return DEFAULT_CONFIG.welcome.batchWindowMs;
  }
  return Math.floor(num);
}

// 格式化秒数为可读时长
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0秒";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours > 0) parts.push(`${hours}小时`);
  if (minutes > 0) parts.push(`${minutes}分钟`);
  if (secs > 0) parts.push(`${secs}秒`);
  return parts.join("");
}

// 解析禁言时长
export function parseDuration(text: string): number {
  const match = text.match(/(\d+)\s*(分钟|min|m|小时|hour|h|天|day|d)/i);
  if (!match) return 0;
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (unit.startsWith("分") || unit === "min" || unit === "m")
    return value * 60;
  if (unit.startsWith("小") || unit === "hour" || unit === "h")
    return value * 3600;
  if (unit.startsWith("天") || unit === "day" || unit === "d")
    return value * 86400;
  return 0;
}

// 从消息中提取图片URL
export function extractImageUrl(message: RecvElement[]): string | undefined {
  if (!Array.isArray(message)) return undefined;
  for (const seg of message) {
    if (seg.type === "image") {
      const imageSeg = seg as RecvImageElement;
      return imageSeg.url || imageSeg.file;
    }
  }
  return undefined;
}

// 从消息中提取被@的人的QQ号
export function getAtUserId(message: RecvElement[]): number | undefined {
  if (!Array.isArray(message)) return undefined;
  const atSeg = message.find(
    (seg): seg is RecvAtElement => seg.type === "at" && seg.qq !== "all",
  );
  if (!atSeg) return undefined;
  const qq = Number(atSeg.qq);
  return Number.isFinite(qq) ? qq : undefined;
}

// 获取群成员头像URL
export function getAvatarUrl(userId: number): string {
  return `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`;
}

// 获取群头像URL
export function getGroupAvatarUrl(groupId: number): string {
  return `https://p.qlogo.cn/gh/${groupId}/${groupId}/640/`;
}

// 获取Bot群成员角色
export async function getMemberRole(
  bot: any,
  groupId: number,
  userId: number,
): Promise<string> {
  try {
    const info = await bot.getGroupMemberInfo(groupId, userId);
    return info?.role || "member";
  } catch {
    return "member";
  }
}
