import { botConfig, type MiokiContext } from "mioki";
import type {
  FriendRequestEvent,
  GroupBanNoticeEvent,
  GroupDecreaseNoticeEvent,
  GroupInviteRequestEvent,
  MessageEvent,
  PrivateMessageEvent,
  RecvAtElement,
  RecvElement,
  RecvFaceElement,
  RecvFileElement,
  RecvForwardElement,
  RecvImageElement,
  RecvJsonElement,
  RecvRecordElement,
  RecvReplyElement,
  RecvTextElement,
  RecvVideoElement,
} from "napcat-sdk";
import type { AdminConfig } from "../config";
import { formatDuration, getAvatarUrl, getGroupAvatarUrl } from "../config";

interface NotifyPayload {
  avatarUrl?: string;
  lines: string[];
  rawSegments?: any[];
}

interface PendingFriendRequest {
  selfId: number;
  userId: number;
  flag: string;
  createdAt: number;
}

interface PendingGroupInvite {
  selfId: number;
  groupId: number;
  userId: number;
  flag: string;
  subType: string;
  createdAt: number;
}

const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
const PENDING_MAX_SIZE = 200;
const EVENT_DEDUP_TTL_MS = 10 * 1000;

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** 获取应该通知的主人列表 */
function getNotifyOwners(config: AdminConfig): number[] {
  if (config.notifyTarget.length > 0) return config.notifyTarget;
  const owners = Array.isArray(botConfig?.owners) ? botConfig.owners : [];
  return owners.map((v: any) => Number(v)).filter((n: number) => n > 0);
}

/** 注册所有事件通知处理器 */
export function registerNotificationHandlers(
  ctx: MiokiContext,
  getConfig: () => AdminConfig,
) {
  const pendingFriendRequests: PendingFriendRequest[] = [];
  const pendingGroupInvites: PendingGroupInvite[] = [];
  const recentEventKeys = new Map<string, number>();

  function owners(): number[] {
    return getNotifyOwners(getConfig());
  }

  function prunePendingRequests() {
    const now = Date.now();
    const isAlive = (createdAt: number) => now - createdAt <= PENDING_TTL_MS;

    for (let i = pendingFriendRequests.length - 1; i >= 0; i--) {
      if (!isAlive(pendingFriendRequests[i].createdAt)) {
        pendingFriendRequests.splice(i, 1);
      }
    }
    for (let i = pendingGroupInvites.length - 1; i >= 0; i--) {
      if (!isAlive(pendingGroupInvites[i].createdAt)) {
        pendingGroupInvites.splice(i, 1);
      }
    }

    if (pendingFriendRequests.length > PENDING_MAX_SIZE) {
      pendingFriendRequests.splice(
        0,
        pendingFriendRequests.length - PENDING_MAX_SIZE,
      );
    }
    if (pendingGroupInvites.length > PENDING_MAX_SIZE) {
      pendingGroupInvites.splice(
        0,
        pendingGroupInvites.length - PENDING_MAX_SIZE,
      );
    }

    for (const [key, ts] of recentEventKeys.entries()) {
      if (now - ts > EVENT_DEDUP_TTL_MS) {
        recentEventKeys.delete(key);
      }
    }
  }

  function markEventOnce(key: string): boolean {
    prunePendingRequests();
    if (recentEventKeys.has(key)) {
      return false;
    }
    recentEventKeys.set(key, Date.now());
    return true;
  }

  function buildNotifyMessage(payload: NotifyPayload): any[] {
    const message: any[] = [];
    if (payload.avatarUrl) {
      message.push(ctx.segment.image(payload.avatarUrl));
    }
    const text = payload.lines
      .map((line) => String(line || "").trim())
      .filter(Boolean)
      .join("\n");
    if (text) {
      message.push(ctx.segment.text(text));
    }
    if (Array.isArray(payload.rawSegments) && payload.rawSegments.length > 0) {
      message.push(...payload.rawSegments);
    }
    return message.length > 0 ? message : [ctx.segment.text("")];
  }

  function normalizeIncomingSegments(segments: RecvElement[]): any[] {
    if (!Array.isArray(segments)) return [];
    return segments
      .map((seg) => {
        if (!seg || typeof seg !== "object") return null;
        const type = String(seg.type || "");

        if (!type) return null;

        if (type === "text") {
          const text = String((seg as RecvTextElement).text || "");
          return text ? ctx.segment.text(text) : null;
        }

        if (type === "image" || type === "record" || type === "video") {
          const mediaSeg = seg as
            | RecvImageElement
            | RecvRecordElement
            | RecvVideoElement;
          const source = String(mediaSeg.url || mediaSeg.file || "").trim();
          if (!source) return null;
          if (type === "image") {
            return ctx.segment.image(source);
          }
          if (type === "record") {
            return (ctx.segment as any).record(source);
          }
          return (ctx.segment as any).video(source);
        }

        if (type === "file") {
          const fileSeg = seg as RecvFileElement;
          const source = String(fileSeg.url || fileSeg.file || "").trim();
          if (!source) return null;
          return (ctx.segment as any).file(source);
        }

        if (type === "at") {
          const qq = (seg as RecvAtElement).qq;
          if (qq == null) return null;
          return ctx.segment.at(String(qq));
        }

        if (type === "face") {
          const id = (seg as RecvFaceElement).id;
          if (id == null) return null;
          return ctx.segment.face(Number(id));
        }

        if (type === "reply") {
          const id = (seg as RecvReplyElement).id;
          if (id == null) return null;
          return ctx.segment.reply(String(id));
        }

        if (type === "forward") {
          const id = (seg as RecvForwardElement).id;
          if (id == null) return null;
          return (ctx.segment as any).forward?.(String(id)) ?? null;
        }

        if (type === "json") {
          const data = (seg as RecvJsonElement).data;
          if (type === "json" && ctx.segment.json) {
            return ctx.segment.json(data);
          }
          return null;
        }

        return null;
      })
      .filter(Boolean);
  }

  function isOwnerPrivateMessage(event: PrivateMessageEvent): boolean {
    if (ctx.isOwner?.(event)) {
      return true;
    }
    const userId = Number(event.user_id || 0);
    if (userId <= 0) {
      return false;
    }
    return owners().includes(userId);
  }

  async function sendNotify(selfId: number, payload: NotifyPayload) {
    const bot = ctx.pickBot(selfId);
    if (!bot) return;
    for (const ownerId of owners()) {
      try {
        await bot.sendPrivateMsg(ownerId, buildNotifyMessage(payload));
      } catch (err) {
        ctx.logger.error(`admin notify owner ${ownerId} failed: ${err}`);
      }
    }
  }

  function pushPendingFriendRequest(event: FriendRequestEvent) {
    const selfId = Number(event.self_id || 0);
    const userId = Number(event.user_id || 0);
    const flag = String(event.flag || "").trim();
    if (!selfId || !userId || !flag) return;
    pendingFriendRequests.push({
      selfId,
      userId,
      flag,
      createdAt: Date.now(),
    });
    prunePendingRequests();
  }

  function pushPendingGroupInvite(event: GroupInviteRequestEvent) {
    const selfId = Number(event.self_id || 0);
    const groupId = Number(event.group_id || 0);
    const userId = Number(event.user_id || 0);
    const flag = String(event.flag || "").trim();
    const subType = String(event.sub_type || "invite").trim() || "invite";
    if (!selfId || !groupId || !userId || !flag) return;
    pendingGroupInvites.push({
      selfId,
      groupId,
      userId,
      flag,
      subType,
      createdAt: Date.now(),
    });
    prunePendingRequests();
  }

  function shiftLatestFriendRequest(
    selfId: number,
    userId: number,
  ): PendingFriendRequest | undefined {
    prunePendingRequests();
    for (let i = pendingFriendRequests.length - 1; i >= 0; i--) {
      const item = pendingFriendRequests[i];
      if (item.selfId === selfId && item.userId === userId) {
        pendingFriendRequests.splice(i, 1);
        return item;
      }
    }
    return undefined;
  }

  function shiftLatestGroupInvite(
    selfId: number,
    groupId: number,
    userId?: number,
  ): PendingGroupInvite | undefined {
    prunePendingRequests();
    for (let i = pendingGroupInvites.length - 1; i >= 0; i--) {
      const item = pendingGroupInvites[i];
      if (item.selfId !== selfId || item.groupId !== groupId) continue;
      if (userId && item.userId !== userId) continue;
      pendingGroupInvites.splice(i, 1);
      return item;
    }
    return undefined;
  }

  function extractTextFromSegments(segments: RecvElement[]): string {
    if (!Array.isArray(segments)) return "";
    return segments
      .map((seg) => {
        if (seg.type !== "text") return "";
        return String((seg as RecvTextElement).text || "");
      })
      .join("")
      .trim();
  }

  async function resolveQuotedText(event: MessageEvent): Promise<string> {
    if (!event.quote_id) return "";
    try {
      const quoted = await event.getQuoteMsg();
      return extractTextFromSegments(quoted?.message || []);
    } catch {
      return "";
    }
  }

  function parseQuotedApprovalTarget(
    quotedText: string,
  ):
    | { type: "friend_message"; userId: number }
    | { type: "friend_request"; userId: number }
    | { type: "group_invite"; groupId: number; userId?: number }
    | { type: "group_ban"; groupId: number }
    | null {
    const text = String(quotedText || "");
    if (!text) return null;

    if (text.includes("[好友消息]")) {
      const userIdMatch =
        text.match(/好友QQ[：:]\s*(\d+)/) ||
        text.match(/QQ[：:]\s*(\d+)/);
      const userId = Number(userIdMatch?.[1] || 0);
      return userId > 0 ? { type: "friend_message", userId } : null;
    }

    if (text.includes("[好友申请]")) {
      const userIdMatch =
        text.match(/好友QQ[：:]\s*(\d+)/) ||
        text.match(/QQ[：:]\s*(\d+)/) ||
        text.match(/\[好友申请\]\s*(\d+)/);
      const userId = Number(userIdMatch?.[1] || 0);
      return userId > 0 ? { type: "friend_request", userId } : null;
    }

    if (text.includes("[群邀请]")) {
      const groupIdMatch =
        text.match(/群号[：:]\s*(\d+)/) || text.match(/\[群邀请\][^\d]*(\d+)/);
      const inviterIdMatch = text.match(/邀请人QQ[：:]\s*(\d+)/);
      const groupId = Number(groupIdMatch?.[1] || 0);
      const userId = Number(inviterIdMatch?.[1] || 0);
      if (groupId <= 0) return null;
      return userId > 0
        ? { type: "group_invite", groupId, userId }
        : { type: "group_invite", groupId };
    }

    if (text.includes("[Bot被禁言]")) {
      const groupIdMatch = text.match(/群号[：:]\s*(\d+)/);
      const groupId = Number(groupIdMatch?.[1] || 0);
      return groupId > 0 ? { type: "group_ban", groupId } : null;
    }

    return null;
  }

  function extractReplyPayloadSegments(event: MessageEvent): any[] {
    return normalizeIncomingSegments(event?.message || []).filter(
      (seg: any) => {
        const type = String(seg?.type || "");
        return type !== "reply";
      },
    );
  }

  function isApproveText(text: string): boolean {
    const normalized = String(text || "").trim();
    return normalized === "通过" || normalized === "同意";
  }

  function isRejectText(text: string): boolean {
    const normalized = String(text || "").trim();
    return normalized === "拒绝" || normalized === "驳回";
  }

  async function notifyGroupInvite(
    event: GroupInviteRequestEvent,
  ): Promise<void> {
    if (!getConfig().notifyGroupInvite) return;

    const selfId = Number(event.self_id || 0);
    const groupId = Number(event.group_id || 0);
    const userId = Number(event.user_id || 0);
    const flag = String(event.flag || "").trim();
    if (!selfId || !groupId || !userId || !flag) return;

    const eventKey = `group-invite:${selfId}:${groupId}:${userId}:${flag}`;
    if (!markEventOnce(eventKey)) return;

    pushPendingGroupInvite(event);

    const comment = event.comment || "无";
    await sendNotify(selfId, {
      avatarUrl: getGroupAvatarUrl(groupId),
      lines: [
        "[群邀请]",
        `群号：${groupId}`,
        `邀请人QQ：${userId}`,
        `验证消息：${comment}`,
        "备注：引用该消息回复「同意」或「拒绝」",
      ],
    });
  }

  async function notifyGroupBan(event: GroupBanNoticeEvent): Promise<void> {
    const selfId = Number(event.self_id || 0);
    const groupId = Number(event.group_id || 0);
    const userId = Number(event.user_id || 0);
    const duration = Number(event.duration || 0);
    if (!selfId || !groupId) return;
    if (userId !== selfId) return;

    const operatorId = Number(event.operator_id || 0);
    const isUnban = event.action_type === "lift_ban";
    if (isUnban) {
      if (!getConfig().notifyGroupUnban) return;
    } else if (!getConfig().notifyGroupBan) {
      return;
    }

    const eventKey = `group-ban:${selfId}:${groupId}:${operatorId}:${duration}:${event.action_type}:${Number(event.time || 0)}`;
    if (!markEventOnce(eventKey)) return;

    await sendNotify(selfId, {
      avatarUrl: getGroupAvatarUrl(groupId),
      lines: [
        isUnban ? "[Bot被解除禁言]" : "[Bot被禁言]",
        `群号：${groupId}`,
        `操作人QQ：${operatorId}`,
        isUnban ? "" : `禁言时长：${formatDuration(duration)}`,
        isUnban ? "" : "引用该消息回复「退群」可退出该群",
      ],
    });
  }

  async function notifyGroupKick(
    event: GroupDecreaseNoticeEvent,
  ): Promise<void> {
    if (!getConfig().notifyGroupKick) return;

    const selfId = Number(event.self_id || 0);
    const groupId = Number(event.group_id || 0);
    const userId = Number(event.user_id || 0);
    const leaveType = String((event as any).action_type || "").trim();
    if (!selfId || !groupId) return;
    if (userId !== selfId) return;
    if (leaveType !== "kick" && leaveType !== "kick_me") return;

    const operatorId = Number(event.operator_id || 0);
    const eventKey = `group-kick:${selfId}:${groupId}:${operatorId}:${leaveType}:${Number(event.time || 0)}`;
    if (!markEventOnce(eventKey)) return;

    await sendNotify(selfId, {
      avatarUrl:
        operatorId > 0 ? getAvatarUrl(operatorId) : getGroupAvatarUrl(groupId),
      lines: ["[Bot被踢]", `群号：${groupId}`, `操作者QQ：${operatorId}`],
    });
  }

  // 好友私聊消息通知
  ctx.handle("message.private", async (event: PrivateMessageEvent) => {
    if (!getConfig().notifyFriendMsg) return;
    if (event.user_id === event.self_id) return;
    if (isOwnerPrivateMessage(event)) return;

    const userId = event.user_id;
    const nickname = event.sender?.nickname || String(userId);
    const rawSegments = normalizeIncomingSegments(event.message || []);

    await sendNotify(event.self_id, {
      avatarUrl: getAvatarUrl(userId),
      lines: [
        "[好友消息]",
        `好友昵称：${nickname}`,
        `好友QQ：${userId}`,
        "消息：",
        "引用该消息回复",
      ],
      rawSegments,
    });
  });

  // 好友申请通知
  ctx.handle("request.friend", async (event: FriendRequestEvent) => {
    pushPendingFriendRequest(event);
    if (!getConfig().notifyFriendRequest) return;

    const userId = event.user_id;
    const comment = event.comment || "无";

    await sendNotify(event.self_id, {
      avatarUrl: getAvatarUrl(userId),
      lines: [
        "[好友申请]",
        `好友QQ：${userId}`,
        `验证消息：${comment}`,
        "引用该消息回复「同意」或「拒绝」",
      ],
    });
  });

  // 群邀请通知
  ctx.handle("request.group.invite", async (event: GroupInviteRequestEvent) => {
    await notifyGroupInvite(event);
  });

  // Bot被禁言通知
  ctx.handle("notice.group.ban", async (event: GroupBanNoticeEvent) => {
    await notifyGroupBan(event);
  });

  // Bot被踢通知
  ctx.handle(
    "notice.group.decrease",
    async (event: GroupDecreaseNoticeEvent) => {
      await notifyGroupKick(event);
    },
  );

  // 引用回复处理
  ctx.handle("message", async (event: MessageEvent) => {
    if (event.message_type !== "private") return;
    if (!ctx.isOwner?.(event)) return;

    const quotedText = await resolveQuotedText(event);
    if (!quotedText) {
      return;
    }

    const target = parseQuotedApprovalTarget(quotedText);
    if (!target) {
      return;
    }
    const text = (ctx.text(event) || "").trim();

    const selfId = Number(event.self_id || 0);
    const bot = ctx.pickBot(selfId);
    if (!bot) {
      await event.reply("Bot不可用", true);
      return;
    }

    if (target.type === "friend_message") {
      const payload = extractReplyPayloadSegments(event);
      if (!payload.length) {
        await event.reply("回复内容不能为空", true);
        return;
      }
      try {
        await bot.sendPrivateMsg(target.userId, payload);
        await event.reply("done");
      } catch (err) {
        ctx.logger.error(
          `[admin notify] 回发好友消息失败: ${normalizeErrorMessage(err)}`,
        );
        await event.reply(`出错了，笨蛋～ ${String(err)}`, true);
      }
      return;
    }

    if (target.type === "friend_request") {
      if (!isApproveText(text) && !isRejectText(text)) {
        await event.reply("请引用该消息回复「同意」或「拒绝」", true);
        return;
      }
      const pending = shiftLatestFriendRequest(selfId, target.userId);
      if (!pending) {
        await event.reply("没找到待处理的好友申请", true);
        return;
      }

      try {
        await bot.api("set_friend_add_request", {
          flag: pending.flag,
          approve: isApproveText(text),
        });
        await event.reply("done");
      } catch (err) {
        ctx.logger.error(
          `[admin notify] 处理好友申请失败: ${normalizeErrorMessage(err)}`,
        );
        await event.reply(`出错了，笨蛋～ ${String(err)}`, true);
      }
      return;
    }

    if (target.type === "group_ban") {
      if (text !== "退群") {
        await event.reply("请引用该消息回复「退群」", true);
        return;
      }
      try {
        await bot.api("set_group_leave", {
          group_id: target.groupId,
          is_dismiss: false,
        });
        await event.reply("done");
      } catch (err) {
        ctx.logger.error(
          `[admin notify] 引用退群失败: ${normalizeErrorMessage(err)}`,
        );
        await event.reply(`出错了，笨蛋～ ${String(err)}`, true);
      }
      return;
    }

    if (target.type === "group_invite") {
      if (!isApproveText(text) && !isRejectText(text)) {
        await event.reply("请引用该消息回复「同意」或「拒绝」", true);
        return;
      }

      const pending = shiftLatestGroupInvite(
        selfId,
        target.groupId,
        target.userId,
      );
      if (!pending) {
        await event.reply("没找到待处理的群邀请", true);
        return;
      }

      try {
        await bot.api("set_group_add_request", {
          flag: pending.flag,
          sub_type: pending.subType || "invite",
          approve: isApproveText(text),
        });
        await event.reply("done");
      } catch (err) {
        ctx.logger.error(
          `[admin notify] 处理群邀请失败: ${normalizeErrorMessage(err)}`,
        );
        await event.reply(`出错了，笨蛋～ ${String(err)}`, true);
      }
    }
  });
}
