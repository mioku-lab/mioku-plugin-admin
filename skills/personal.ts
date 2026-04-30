import type { AISkill } from "../../../src";
import { getImageUrlByMessageId } from "./message-image";

function parseProfileSex(value: string): 0 | 1 | 2 {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "男" || normalized === "male" || normalized === "1")
    return 1;
  if (normalized === "女" || normalized === "female" || normalized === "2")
    return 2;
  return 0;
}

const personalSkill: AISkill = {
  name: "admin_personal",
  description:
    "个人账号管理工具，提供修改自己头像、昵称、个性签名、性别、发送消息、查看好友/群列表等操作",
  permission: "owner",
  tools: [
    {
      name: "set_bot_avatar",
      description: "修改Bot头像",
      parameters: {
        type: "object",
        properties: {
          message_id: {
            type: "number",
            description: "包含图片的消息 message_id",
          },
        },
        required: ["message_id"],
      },
      handler: async (args: any, runtimeCtx?: any) => {
        const ctx = runtimeCtx?.ctx;
        if (!ctx) return { error: "无法获取上下文" };
        const selfId =
          runtimeCtx?.event?.self_id || runtimeCtx?.rawEvent?.self_id;
        if (!selfId) return { error: "无法获取Bot ID" };
        const bot = ctx.pickBot(selfId);
        if (!bot) return { error: "Bot不可用" };
        const messageId = Number(args?.message_id);
        if (!Number.isFinite(messageId) || messageId <= 0) {
          return { error: "请提供有效的 message_id" };
        }
        const imageUrl = await getImageUrlByMessageId(bot, messageId);
        if (!imageUrl) {
          return { error: "指定 message_id 中未找到图片" };
        }
        try {
          await bot.api("set_qq_avatar", { file: imageUrl });
          return { success: true, message: "Bot头像已修改" };
        } catch (err) {
          return { error: `修改头像失败: ${err}` };
        }
      },
    },
    {
      name: "set_bot_nickname",
      description: "修改Bot昵称",
      parameters: {
        type: "object",
        properties: { nickname: { type: "string", description: "新昵称" } },
        required: ["nickname"],
      },
      handler: async (args: any, runtimeCtx?: any) => {
        const ctx = runtimeCtx?.ctx;
        if (!ctx) return { error: "无法获取上下文" };
        const selfId =
          runtimeCtx?.event?.self_id || runtimeCtx?.rawEvent?.self_id;
        if (!selfId) return { error: "无法获取Bot ID" };
        const bot = ctx.pickBot(selfId);
        if (!bot) return { error: "Bot不可用" };
        try {
          await bot.api("set_qq_profile", {
            nickname: String(args.nickname || "").trim(),
          });
          return {
            success: true,
            message: `Bot昵称已修改为: ${args.nickname}`,
          };
        } catch (err) {
          return { error: `修改昵称失败: ${err}` };
        }
      },
    },
    {
      name: "set_bot_signature",
      description: "修改Bot个性签名",
      parameters: {
        type: "object",
        properties: {
          personal_note: { type: "string", description: "新个性签名" },
        },
        required: ["personal_note"],
      },
      handler: async (args: any, runtimeCtx?: any) => {
        const ctx = runtimeCtx?.ctx;
        if (!ctx) return { error: "无法获取上下文" };
        const selfId =
          runtimeCtx?.event?.self_id || runtimeCtx?.rawEvent?.self_id;
        if (!selfId) return { error: "无法获取Bot ID" };
        const bot = ctx.pickBot(selfId);
        if (!bot) return { error: "Bot不可用" };
        const personalNote = String(args?.personal_note || "").trim();
        if (!personalNote) return { error: "personal_note 不能为空" };
        try {
          await bot.api("set_qq_profile", { personal_note: personalNote });
          return { success: true, message: "Bot个性签名已修改" };
        } catch (err) {
          return { error: `修改个性签名失败: ${err}` };
        }
      },
    },
    {
      name: "set_bot_gender",
      description: "修改Bot性别",
      parameters: {
        type: "object",
        properties: {
          gender: {
            type: "string",
            description: "性别：男/女/无 或 male/female/unknown",
            enum: [
              "male",
              "female",
              "unknown",
              "男",
              "女",
              "无",
              "0",
              "1",
              "2",
            ],
          },
        },
        required: ["gender"],
      },
      handler: async (args: any, runtimeCtx?: any) => {
        const ctx = runtimeCtx?.ctx;
        if (!ctx) return { error: "无法获取上下文" };
        const selfId =
          runtimeCtx?.event?.self_id || runtimeCtx?.rawEvent?.self_id;
        if (!selfId) return { error: "无法获取Bot ID" };
        const bot = ctx.pickBot(selfId);
        if (!bot) return { error: "Bot不可用" };
        try {
          const sex = parseProfileSex(args.gender);
          await bot.api("set_qq_profile", { sex });
          const genderMap: Record<number, string> = {
            0: "无",
            1: "男",
            2: "女",
          };
          return {
            success: true,
            message: `Bot性别已修改为: ${genderMap[sex]}`,
          };
        } catch (err) {
          return { error: `修改性别失败: ${err}` };
        }
      },
    },
    {
      name: "send_private_message",
      description: "给指定QQ号发送私聊消息",
      parameters: {
        type: "object",
        properties: {
          user_id: { type: "number", description: "目标QQ号" },
          content: { type: "string", description: "消息内容" },
        },
        required: ["user_id", "content"],
      },
      handler: async (args: any, runtimeCtx?: any) => {
        const ctx = runtimeCtx?.ctx;
        if (!ctx) return { error: "无法获取上下文" };
        const selfId =
          runtimeCtx?.event?.self_id || runtimeCtx?.rawEvent?.self_id;
        if (!selfId) return { error: "无法获取Bot ID" };
        const bot = ctx.pickBot(selfId);
        if (!bot) return { error: "Bot不可用" };
        try {
          await bot.sendPrivateMsg(args.user_id, [
            ctx.segment.text(args.content),
          ]);
          return { success: true, message: `已发送私聊消息给 ${args.user_id}` };
        } catch (err) {
          return { error: `发送私聊失败: ${err}` };
        }
      },
    },
    {
      name: "send_group_message",
      description: "给指定群发送消息",
      parameters: {
        type: "object",
        properties: {
          group_id: { type: "number", description: "目标群号" },
          content: { type: "string", description: "消息内容" },
        },
        required: ["group_id", "content"],
      },
      handler: async (args: any, runtimeCtx?: any) => {
        const ctx = runtimeCtx?.ctx;
        if (!ctx) return { error: "无法获取上下文" };
        const selfId =
          runtimeCtx?.event?.self_id || runtimeCtx?.rawEvent?.self_id;
        if (!selfId) return { error: "无法获取Bot ID" };
        const bot = ctx.pickBot(selfId);
        if (!bot) return { error: "Bot不可用" };
        try {
          await bot.sendGroupMsg(args.group_id, [
            ctx.segment.text(args.content),
          ]);
          return { success: true, message: `已发送群消息到 ${args.group_id}` };
        } catch (err) {
          return { error: `发送群消息失败: ${err}` };
        }
      },
    },
    {
      name: "get_friend_list",
      description:
        "获取Bot的全部好友列表，对应/全部好友命令，仅适合在私聊场景调用",
      parameters: { type: "object", properties: {}, required: [] },
      handler: async (_args: any, runtimeCtx?: any) => {
        const ctx = runtimeCtx?.ctx;
        if (!ctx) return { error: "无法获取上下文" };
        const event = runtimeCtx?.event || runtimeCtx?.rawEvent;
        if (event?.message_type === "group") {
          return { error: "在私聊使用试试看吧～" };
        }
        const selfId =
          runtimeCtx?.event?.self_id || runtimeCtx?.rawEvent?.self_id;
        if (!selfId) return { error: "无法获取Bot ID" };
        const bot = ctx.pickBot(selfId);
        if (!bot) return { error: "Bot不可用" };
        try {
          const friendList: any[] = await bot.api("get_friend_list");
          if (!Array.isArray(friendList)) return { friends: [] };
          return {
            friends: friendList.map((f) => ({
              user_id: f.user_id,
              nickname: f.nickname,
              remark: f.remark,
            })),
          };
        } catch (err) {
          return { error: `获取好友列表失败: ${err}` };
        }
      },
    },
    {
      name: "get_group_list",
      description:
        "获取Bot的全部群聊列表，对应/全部群聊命令，仅适合在私聊场景调用",
      parameters: { type: "object", properties: {}, required: [] },
      handler: async (_args: any, runtimeCtx?: any) => {
        const ctx = runtimeCtx?.ctx;
        if (!ctx) return { error: "无法获取上下文" };
        const event = runtimeCtx?.event || runtimeCtx?.rawEvent;
        if (event?.message_type === "group") {
          return { error: "在私聊使用试试看吧～" };
        }
        const selfId =
          runtimeCtx?.event?.self_id || runtimeCtx?.rawEvent?.self_id;
        if (!selfId) return { error: "无法获取Bot ID" };
        const bot = ctx.pickBot(selfId);
        if (!bot) return { error: "Bot不可用" };
        try {
          const groupList: any[] = await bot.api("get_group_list");
          if (!Array.isArray(groupList)) return { groups: [] };
          return {
            groups: groupList.map((g) => ({
              group_id: g.group_id,
              group_name: g.group_name,
              member_count: g.member_count,
            })),
          };
        } catch (err) {
          return { error: `获取群聊列表失败: ${err}` };
        }
      },
    },
    {
      name: "delete_friend",
      description: "删除好友",
      parameters: {
        type: "object",
        properties: {
          user_id: { type: "number", description: "要删除的好友QQ号" },
        },
        required: ["user_id"],
      },
      handler: async (args: any, runtimeCtx?: any) => {
        const ctx = runtimeCtx?.ctx;
        if (!ctx) return { error: "无法获取上下文" };
        const selfId =
          runtimeCtx?.event?.self_id || runtimeCtx?.rawEvent?.self_id;
        if (!selfId) return { error: "无法获取Bot ID" };
        const bot = ctx.pickBot(selfId);
        if (!bot) return { error: "Bot不可用" };
        try {
          await bot.api("delete_friend", { user_id: args.user_id });
          return { success: true, message: `已删除好友 ${args.user_id}` };
        } catch (err) {
          return { error: `删除好友失败: ${err}` };
        }
      },
    },
    {
      name: "leave_group",
      description: "退出群聊",
      parameters: {
        type: "object",
        properties: {
          group_id: { type: "number", description: "要退出的群号" },
        },
        required: ["group_id"],
      },
      handler: async (args: any, runtimeCtx?: any) => {
        const ctx = runtimeCtx?.ctx;
        if (!ctx) return { error: "无法获取上下文" };
        const selfId =
          runtimeCtx?.event?.self_id || runtimeCtx?.rawEvent?.self_id;
        if (!selfId) return { error: "无法获取Bot ID" };
        const bot = ctx.pickBot(selfId);
        if (!bot) return { error: "Bot不可用" };
        try {
          await bot.api("set_group_leave", {
            group_id: args.group_id,
            is_dismiss: false,
          });
          return { success: true, message: `已退出群 ${args.group_id}` };
        } catch (err) {
          return { error: `退群失败: ${err}` };
        }
      },
    },
  ],
};

export default personalSkill;
