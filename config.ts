import type { RecvAtElement, RecvElement, RecvImageElement } from "napcat-sdk";

export interface AdminConfig {
  notifyTarget: number[];
  notifyFriendMsg: boolean;
  notifyFriendRequest: boolean;
  notifyGroupInvite: boolean;
  notifyGroupBan: boolean;
  notifyGroupUnban: boolean;
  notifyGroupKick: boolean;
}

export const DEFAULT_CONFIG: AdminConfig = {
  notifyTarget: [],
  notifyFriendMsg: true,
  notifyFriendRequest: true,
  notifyGroupInvite: true,
  notifyGroupBan: true,
  notifyGroupUnban: true,
  notifyGroupKick: true,
};

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
  };
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
