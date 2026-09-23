import type { AISkill, Bot, MessageEvent } from "mioku";

import { getImageUrlByMessageId } from "./message-image";

import type { MessageSegment } from "mioku";

interface SkillRuntimeContext {
  ctx?: {
    segment: { text(text: string): MessageSegment };
    logger?: { error?: (...args: unknown[]) => void };
  };
  event?: MessageEvent;
  rawEvent?: MessageEvent;
}

function parseProfileSex(value: string): 0 | 1 | 2 {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "男" || normalized === "male" || normalized === "1") return 1;
  if (normalized === "女" || normalized === "female" || normalized === "2") return 2;
  return 0;
}

function logAdminSkillError(
  runtimeCtx: SkillRuntimeContext | undefined,
  toolName: string,
  err: unknown,
) {
  runtimeCtx?.ctx?.logger?.error?.(
    `[admin skills] ${toolName} failed: ${String(err)}`,
  );
}

const personalSkill: AISkill = {
  name: "admin_personal",
  description:
    "Bot个人账号与消息管理统一入口：修改Bot资料、发送消息、获取列表、管理关系",
  permission: "master",
  tools: [
    {
      name: "manage_personal",
      description:
        "Bot个人账号管理：修改头像/昵称/签名/性别、给指定用户或群发消息、查看好友/群列表、删除好友、退群",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: "要执行的动作",
            enum: [
              "set_avatar",
              "set_nickname",
              "set_signature",
              "set_gender",
              "send_private",
              "send_group",
              "list_friends",
              "list_groups",
              "delete_friend",
              "leave_group",
            ],
          },
          message_id: {
            type: "number",
            description: "包含图片的消息 message_id，仅 set_avatar 需要",
          },
          nickname: { type: "string", description: "新昵称，仅 set_nickname 需要" },
          personal_note: {
            type: "string",
            description: "新个性签名，仅 set_signature 需要",
          },
          gender: {
            type: "string",
            description:
              "性别：男/女/无 或 male/female/unknown 或 1/2/0，仅 set_gender 需要",
          },
          user_id: {
            type: "number",
            description: "目标QQ号。send_private / delete_friend 需要。",
          },
          group_id: {
            type: "number",
            description: "目标群号。send_group / leave_group 需要。",
          },
          content: {
            type: "string",
            description: "消息内容。send_private / send_group 需要。",
          },
        },
        required: ["action"],
      },
      handler: async (args: unknown, runtimeCtx?: SkillRuntimeContext) => {
        const ctx = runtimeCtx?.ctx;
        if (!ctx) return { error: "无法获取上下文" };
        const event = runtimeCtx?.event ?? runtimeCtx?.rawEvent;
        if (!event) return { error: "无法获取事件" };
        const bot = event.bot;
        if (!bot) return { error: "Bot不可用" };
        const a = args as Record<string, unknown>;
        const action = String(a?.action ?? "");

        try {
          switch (action) {
            case "set_avatar": {
              const messageId = String(a?.message_id ?? "").trim();
              if (!messageId) {
                return { error: "set_avatar 需要提供有效的 message_id" };
              }
              const imageUrl = await getImageUrlByMessageId(bot, messageId);
              if (!imageUrl) return { error: "指定 message_id 中未找到图片" };
              await bot.setAvatar(imageUrl);
              return { success: true, message: "Bot头像已修改" };
            }
            case "set_nickname": {
              const nickname = String(a?.nickname ?? "").trim();
              if (!nickname) return { error: "set_nickname 需要提供 nickname" };
              await bot.setProfile({ nickname });
              return { success: true, message: `Bot昵称已修改为: ${nickname}` };
            }
            case "set_signature": {
              const personalNote = String(a?.personal_note ?? "").trim();
              if (!personalNote) return { error: "set_signature 需要提供 personal_note" };
              await bot.setProfile({ personal_note: personalNote });
              return { success: true, message: "Bot个性签名已修改" };
            }
            case "set_gender": {
              const sex = parseProfileSex(String(a?.gender ?? ""));
              await bot.setProfile({ sex });
              const genderMap: Record<number, string> = { 0: "无", 1: "男", 2: "女" };
              return { success: true, message: `Bot性别已修改为: ${genderMap[sex]}` };
            }
            case "send_private": {
              const userId = Number(a?.user_id);
              const content = String(a?.content ?? "");
              if (!userId || !content) return { error: "send_private 需要提供 user_id 和 content" };
              await bot.sendMessage(
                { type: "private", user_id: userId},
                [ctx.segment.text(content)],
              );
              return { success: true, message: `已发送私聊消息给 ${userId}` };
            }
            case "send_group": {
              const groupId = Number(a?.group_id);
              const content = String(a?.content ?? "");
              if (!groupId || !content) return { error: "send_group 需要提供 group_id 和 content" };
              await bot.sendMessage(
                { type: "group", group_id: groupId},
                [ctx.segment.text(content)],
              );
              return { success: true, message: `已发送群消息到 ${groupId}` };
            }
            case "list_friends": {
              if (event?.message_type === "group") return { error: "在私聊使用试试看吧～" };
              const friendList = await bot.getFriendList();
              if (!Array.isArray(friendList)) return { friends: [] };
              return {
                friends: friendList.map((f: { user_id?: unknown; nickname?: unknown; remark?: unknown }) => ({
                  user_id: f.user_id,
                  nickname: f.nickname,
                  remark: f.remark,
                })),
              };
            }
            case "list_groups": {
              if (event?.message_type === "group") return { error: "在私聊使用试试看吧～" };
              const groupList = await bot.getGroupList();
              if (!Array.isArray(groupList)) return { groups: [] };
              return {
                groups: groupList.map((g: { group_id?: unknown; group_name?: unknown; member_count?: unknown }) => ({
                  group_id: g.group_id,
                  group_name: g.group_name,
                  member_count: g.member_count,
                })),
              };
            }
            case "delete_friend": {
              const userId = Number(a?.user_id);
              if (!userId) return { error: "delete_friend 需要提供 user_id" };
              await bot.deleteFriend(userId);
              return { success: true, message: `已删除好友 ${userId}` };
            }
            case "leave_group": {
              const groupId = Number(a?.group_id);
              if (!groupId) return { error: "leave_group 需要提供 group_id" };
              await bot.leaveGroup(groupId, false);
              return { success: true, message: `已退出群 ${groupId}` };
            }
            default:
              return { error: `未知的 action: ${action}` };
          }
        } catch (err) {
          logAdminSkillError(runtimeCtx, `admin_personal.manage_personal.${action}`, err);
          return { error: `执行 ${action} 失败: ${err}` };
        }
      },
    },
  ],
};

export default personalSkill;