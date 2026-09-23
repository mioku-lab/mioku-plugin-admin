
export interface AdminConfig {
  notifyTarget: string[];
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

export function normalizeConfig(raw: any): AdminConfig {
  return {
    notifyTarget: Array.isArray(raw?.notifyTarget)
      ? raw.notifyTarget
          .map((v: unknown) => String(v ?? "").trim())
          .filter((id: string) => id.length > 0)
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

import type { Bot } from "mioku";


interface SegmentLike {
  type: string;
  data?: Record<string, unknown>;
}

// 从消息中提取图片URL
export function extractImageUrl(message: readonly SegmentLike[] | null | undefined): string | undefined {
  if (!Array.isArray(message)) return undefined;
  for (const seg of message) {
    if (seg.type === "image") {
      const data = seg.data ?? {};
      const url = String(data.url ?? data.file ?? "");
      return url || undefined;
    }
  }
  return undefined;
}

export function extractImageUrls(message: readonly SegmentLike[] | null | undefined): string[] {
  if (!Array.isArray(message)) return [];
  const urls: string[] = [];
  for (const seg of message) {
    if (seg.type === "image") {
      const data = seg.data ?? {};
      const url = String(data.url ?? data.file ?? "").trim();
      if (url) urls.push(url);
    }
  }
  return urls;
}

// 从消息中提取被@的人的QQ号
export function getAtUserId(
  message: readonly SegmentLike[] | null | undefined,
): string | undefined {
  if (!Array.isArray(message)) return undefined;
  const atSeg = message.find(
    (seg) =>
      seg.type === "at" &&
      String(seg.data?.qq ?? seg.data?.target) !== "all",
  );
  if (!atSeg) return undefined;
  const id = String(atSeg.data?.qq ?? atSeg.data?.target ?? "").trim();
  return id || undefined;
}

/** qlogo 头像服务只认数字 QQ 号,openid 一律返回空串 */
function qlogoUrl(host: string, id: string, suffix: string): string {
  if (!/^\d+$/.test(id)) return "";
  return `https://${host}/${id}${suffix}`;
}

// 获取群成员头像URL
export function getAvatarUrl(userId: string): string {
  return qlogoUrl("q1.qlogo.cn/g?b=qq&nk=", String(userId ?? "").trim(), "&s=640");
}

// 获取群头像URL
export function getGroupAvatarUrl(groupId: string): string {
  const g = String(groupId ?? "").trim();
  if (!/^\d+$/.test(g)) return "";
  return `https://p.qlogo.cn/gh/${g}/${g}/640/`;
}

// 获取Bot群成员角色
export async function getMemberRole(
  bot: Bot,
  groupId: string | number,
  userId: string | number,
): Promise<string> {
  try {
    const info = await bot.getMemberInfo(groupId, userId);
    return info?.role || "member";
  } catch {
    return "member";
  }
}
