import type { AISkill } from "../../../src";
import { getMemberRole } from "../config";
import { getImageUrlByMessageId } from "./message-image";

async function resolveGroupRuntime(runtimeCtx: any, groupId: number) {
  const ctx = runtimeCtx?.ctx;
  if (!ctx) return { error: "无法获取上下文" };

  const selfId = runtimeCtx?.event?.self_id || runtimeCtx?.rawEvent?.self_id;
  if (!selfId) return { error: "无法获取Bot ID" };

  const bot = ctx.pickBot(selfId);
  if (!bot) return { error: "Bot不可用" };

  const botRole = await getMemberRole(bot, groupId, selfId);
  return { ctx, selfId, bot, botRole };
}

const groupAdminSkill: AISkill = {
  name: "admin_group",
  description:
    "群管理工具，提供踢人、禁言、解禁、设管理、全体禁言、改群名、改群头像、设头衔等群管操作",
  permission: "admin",
  tools: [
    {
      name: "kick_member",
      description: "将群成员踢出群聊",
      parameters: {
        type: "object",
        properties: {
          group_id: { type: "number", description: "群号" },
          user_id: { type: "number", description: "要踢出的成员QQ号" },
        },
        required: ["group_id", "user_id"],
      },
      handler: async (args: any, runtimeCtx?: any) => {
        const runtime = await resolveGroupRuntime(runtimeCtx, args.group_id);
        if ("error" in runtime) return { error: runtime.error };
        const { bot } = runtime;
        try {
          await bot.api("set_group_kick", {
            group_id: args.group_id,
            user_id: args.user_id,
          });
          return {
            success: true,
            message: `已将 ${args.user_id} 移出群 ${args.group_id}`,
          };
        } catch (err) {
          return { error: `踢人失败: ${err}` };
        }
      },
    },
    {
      name: "mute_member",
      description: "禁言群成员，不指定时长时默认10分钟",
      parameters: {
        type: "object",
        properties: {
          group_id: { type: "number", description: "群号" },
          user_id: { type: "number", description: "要禁言的成员QQ号" },
          duration: {
            type: "number",
            description: "禁言时长（秒），不提供或小于等于0时默认600秒",
          },
        },
        required: ["group_id", "user_id"],
      },
      handler: async (args: any, runtimeCtx?: any) => {
        const runtime = await resolveGroupRuntime(runtimeCtx, args.group_id);
        if ("error" in runtime) return { error: runtime.error };
        const { bot } = runtime;
        const duration =
          Number(args.duration) > 0 ? Number(args.duration) : 10 * 60;
        try {
          await bot.setGroupBan(args.group_id, args.user_id, duration);
          return {
            success: true,
            message: `已禁言 ${args.user_id} ${duration}秒`,
          };
        } catch (err) {
          return { error: `禁言失败: ${err}` };
        }
      },
    },
    {
      name: "unmute_member",
      description: "解除群成员禁言",
      parameters: {
        type: "object",
        properties: {
          group_id: { type: "number", description: "群号" },
          user_id: { type: "number", description: "要解禁的成员QQ号" },
        },
        required: ["group_id", "user_id"],
      },
      handler: async (args: any, runtimeCtx?: any) => {
        const runtime = await resolveGroupRuntime(runtimeCtx, args.group_id);
        if ("error" in runtime) return { error: runtime.error };
        const { bot } = runtime;
        try {
          await bot.setGroupBan(args.group_id, args.user_id, 0);
          return { success: true, message: `已解除 ${args.user_id} 的禁言` };
        } catch (err) {
          return { error: `解禁失败: ${err}` };
        }
      },
    },
    {
      name: "set_group_admin",
      description: "设置群管理员（需要Bot为群主）",
      parameters: {
        type: "object",
        properties: {
          group_id: { type: "number", description: "群号" },
          user_id: { type: "number", description: "要设为管理的QQ号" },
          enable: {
            type: "boolean",
            description: "true设为管理，false取消管理",
          },
        },
        required: ["group_id", "user_id", "enable"],
      },
      handler: async (args: any, runtimeCtx?: any) => {
        const runtime = await resolveGroupRuntime(runtimeCtx, args.group_id);
        if ("error" in runtime) return { error: runtime.error };
        const { bot, botRole } = runtime;
        if (botRole !== "owner") {
          return { error: "Bot不是群主，无法设置管理员" };
        }
        try {
          await bot.api("set_group_admin", {
            group_id: args.group_id,
            user_id: args.user_id,
            enable: args.enable,
          });
          return {
            success: true,
            message: args.enable
              ? `已将 ${args.user_id} 设为群 ${args.group_id} 的管理员`
              : `已取消 ${args.user_id} 在群 ${args.group_id} 的管理员`,
          };
        } catch (err) {
          return { error: `设管理失败: ${err}` };
        }
      },
    },
    {
      name: "set_group_whole_ban",
      description: "开启或关闭全体禁言",
      parameters: {
        type: "object",
        properties: {
          group_id: { type: "number", description: "群号" },
          enable: {
            type: "boolean",
            description: "true开启全体禁言，false关闭",
          },
        },
        required: ["group_id", "enable"],
      },
      handler: async (args: any, runtimeCtx?: any) => {
        const runtime = await resolveGroupRuntime(runtimeCtx, args.group_id);
        if ("error" in runtime) return { error: runtime.error };
        const { bot } = runtime;
        try {
          await bot.api("set_group_whole_ban", {
            group_id: args.group_id,
            enable: args.enable,
          });
          return {
            success: true,
            message: args.enable
              ? `群 ${args.group_id} 已开启全体禁言`
              : `群 ${args.group_id} 已关闭全体禁言`,
          };
        } catch (err) {
          return { error: `全体禁言操作失败: ${err}` };
        }
      },
    },
    {
      name: "set_group_name",
      description: "修改群聊名称",
      parameters: {
        type: "object",
        properties: {
          group_id: { type: "number", description: "群号" },
          group_name: { type: "string", description: "新群名" },
        },
        required: ["group_id", "group_name"],
      },
      handler: async (args: any, runtimeCtx?: any) => {
        const runtime = await resolveGroupRuntime(runtimeCtx, args.group_id);
        if ("error" in runtime) return { error: runtime.error };
        const { bot } = runtime;
        try {
          await bot.api("set_group_name", {
            group_id: args.group_id,
            group_name: args.group_name,
          });
          return {
            success: true,
            message: `群 ${args.group_id} 名称已修改为 ${args.group_name}`,
          };
        } catch (err) {
          return { error: `修改群名失败: ${err}` };
        }
      },
    },
    {
      name: "set_group_avatar",
      description: "修改群头像",
      parameters: {
        type: "object",
        properties: {
          group_id: { type: "number", description: "群号" },
          message_id: {
            type: "number",
            description: "包含图片的消息 message_id",
          },
        },
        required: ["group_id", "message_id"],
      },
      handler: async (args: any, runtimeCtx?: any) => {
        const runtime = await resolveGroupRuntime(runtimeCtx, args.group_id);
        if ("error" in runtime) return { error: runtime.error };
        const { bot } = runtime;
        const messageId = Number(args?.message_id);
        if (!Number.isFinite(messageId) || messageId <= 0) {
          return { error: "请提供有效的 message_id" };
        }
        const imageUrl = await getImageUrlByMessageId(bot, messageId);
        if (!imageUrl) {
          return { error: "指定 message_id 中未找到图片" };
        }
        try {
          await bot.api("set_group_portrait", {
            group_id: args.group_id,
            file: imageUrl,
          });
          return { success: true, message: `群 ${args.group_id} 头像已修改` };
        } catch (err) {
          return { error: `修改群头像失败: ${err}` };
        }
      },
    },
    {
      name: "set_group_title",
      description: "设置群成员专属头衔",
      parameters: {
        type: "object",
        properties: {
          group_id: { type: "number", description: "群号" },
          user_id: { type: "number", description: "成员QQ号" },
          title: { type: "string", description: "新头衔" },
        },
        required: ["group_id", "user_id", "title"],
      },
      handler: async (args: any, runtimeCtx?: any) => {
        const runtime = await resolveGroupRuntime(runtimeCtx, args.group_id);
        if ("error" in runtime) return { error: runtime.error };
        const { bot, botRole } = runtime;
        if (botRole !== "owner") {
          return { error: "Bot不是群主，无法设置头衔" };
        }
        try {
          await (bot as any).setGroupSpecialTitle(
            args.group_id,
            args.user_id,
            args.title,
          );
          return {
            success: true,
            message: `已将 ${args.user_id} 的头衔设为 "${args.title}"`,
          };
        } catch (err) {
          return { error: `设置头衔失败: ${err}` };
        }
      },
    },
  ],
};

export default groupAdminSkill;
