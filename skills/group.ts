import type { AISkill } from "mioku";
import { getMemberRole } from "../config";
import { getImageUrlByMessageId } from "./message-image";

async function resolveGroupRuntime(runtimeCtx: any) {
  const ctx = runtimeCtx?.ctx;
  if (!ctx) return { error: "无法获取上下文" };

  const event = runtimeCtx?.event || runtimeCtx?.rawEvent;
  const groupId = Number(event?.group_id || 0);
  if (!groupId) return { error: "这个工具只能在群聊中使用" };

  const selfId = runtimeCtx?.event?.self_id || runtimeCtx?.rawEvent?.self_id;
  if (!selfId) return { error: "无法获取Bot ID" };

  const bot = ctx.pickBot(selfId);
  if (!bot) return { error: "Bot不可用" };

  return { ctx, selfId, bot, groupId, event };
}

function logAdminSkillError(runtimeCtx: any, toolName: string, err: unknown) {
  runtimeCtx?.ctx?.logger?.error?.(
    `[admin skills] ${toolName} failed: ${String(err)}`,
  );
}

function formatGroupRole(role: string): string {
  if (role === "owner") return "群主";
  if (role === "admin") return "管理员";
  return "群成员";
}

async function checkDangerousTargetPermission(
  runtime: any,
  targetUserId: number,
): Promise<string | null> {
  const operatorUserId = Number(runtime.event?.user_id || 0);
  if (!operatorUserId) return "无法获取当前操作人ID";

  const operatorRole = await getMemberRole(
    runtime.bot,
    runtime.groupId,
    operatorUserId,
  );
  const targetRole = await getMemberRole(
    runtime.bot,
    runtime.groupId,
    targetUserId,
  );
  if (operatorRole !== targetRole) return null;

  return `无权操作同级成员：操作人与被操作人均为${formatGroupRole(operatorRole)}`;
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
          user_id: { type: "number", description: "要踢出的成员QQ号" },
        },
        required: ["user_id"],
      },
      handler: async (args: any, runtimeCtx?: any) => {
        const runtime = await resolveGroupRuntime(runtimeCtx);
        if ("error" in runtime) return { error: runtime.error };
        const { bot, groupId } = runtime;
        const permissionError = await checkDangerousTargetPermission(
          runtime,
          args.user_id,
        );
        if (permissionError) {
          logAdminSkillError(
            runtimeCtx,
            "admin_group.kick_member",
            permissionError,
          );
          return { error: permissionError };
        }
        try {
          await bot.api("set_group_kick", {
            group_id: groupId,
            user_id: args.user_id,
          });
          return {
            success: true,
            message: `已将 ${args.user_id} 移出当前群`,
          };
        } catch (err) {
          logAdminSkillError(runtimeCtx, "admin_group.kick_member", err);
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
          user_id: { type: "number", description: "要禁言的成员QQ号" },
          duration: {
            type: "number",
            description: "禁言时长（秒），不提供或小于等于0时默认600秒",
          },
        },
        required: ["user_id"],
      },
      handler: async (args: any, runtimeCtx?: any) => {
        const runtime = await resolveGroupRuntime(runtimeCtx);
        if ("error" in runtime) return { error: runtime.error };
        const { bot, groupId } = runtime;
        const duration =
          Number(args.duration) > 0 ? Number(args.duration) : 10 * 60;
        const permissionError = await checkDangerousTargetPermission(
          runtime,
          args.user_id,
        );
        if (permissionError) {
          logAdminSkillError(
            runtimeCtx,
            "admin_group.mute_member",
            permissionError,
          );
          return { error: permissionError };
        }
        try {
          await bot.setGroupBan(groupId, args.user_id, duration);
          return {
            success: true,
            message: `已禁言 ${args.user_id} ${duration}秒`,
          };
        } catch (err) {
          logAdminSkillError(runtimeCtx, "admin_group.mute_member", err);
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
          user_id: { type: "number", description: "要解禁的成员QQ号" },
        },
        required: ["user_id"],
      },
      handler: async (args: any, runtimeCtx?: any) => {
        const runtime = await resolveGroupRuntime(runtimeCtx);
        if ("error" in runtime) return { error: runtime.error };
        const { bot, groupId } = runtime;
        try {
          await bot.setGroupBan(groupId, args.user_id, 0);
          return { success: true, message: `已解除 ${args.user_id} 的禁言` };
        } catch (err) {
          logAdminSkillError(runtimeCtx, "admin_group.unmute_member", err);
          return { error: `解禁失败: ${err}` };
        }
      },
    },
    {
      name: "set_group_admin",
      description: "设置或取消群管理员",
      parameters: {
        type: "object",
        properties: {
          user_id: { type: "number", description: "要设为管理的QQ号" },
          enable: {
            type: "boolean",
            description: "true设为管理，false取消管理",
          },
        },
        required: ["user_id", "enable"],
      },
      handler: async (args: any, runtimeCtx?: any) => {
        const runtime = await resolveGroupRuntime(runtimeCtx);
        if ("error" in runtime) return { error: runtime.error };
        const { bot, groupId } = runtime;
        try {
          await bot.api("set_group_admin", {
            group_id: groupId,
            user_id: args.user_id,
            enable: args.enable,
          });
          return {
            success: true,
            message: args.enable
              ? `已将 ${args.user_id} 设为当前群的管理员`
              : `已取消 ${args.user_id} 在当前群的管理员`,
          };
        } catch (err) {
          logAdminSkillError(runtimeCtx, "admin_group.set_group_admin", err);
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
          enable: {
            type: "boolean",
            description: "true开启全体禁言，false关闭",
          },
        },
        required: ["enable"],
      },
      handler: async (args: any, runtimeCtx?: any) => {
        const runtime = await resolveGroupRuntime(runtimeCtx);
        if ("error" in runtime) return { error: runtime.error };
        const { bot, groupId } = runtime;
        try {
          await bot.api("set_group_whole_ban", {
            group_id: groupId,
            enable: args.enable,
          });
          return {
            success: true,
            message: args.enable
              ? "当前群已开启全体禁言"
              : "当前群已关闭全体禁言",
          };
        } catch (err) {
          logAdminSkillError(
            runtimeCtx,
            "admin_group.set_group_whole_ban",
            err,
          );
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
          group_name: { type: "string", description: "新群名" },
        },
        required: ["group_name"],
      },
      handler: async (args: any, runtimeCtx?: any) => {
        const runtime = await resolveGroupRuntime(runtimeCtx);
        if ("error" in runtime) return { error: runtime.error };
        const { bot, groupId } = runtime;
        try {
          await bot.api("set_group_name", {
            group_id: groupId,
            group_name: args.group_name,
          });
          return {
            success: true,
            message: `当前群名称已修改为 ${args.group_name}`,
          };
        } catch (err) {
          logAdminSkillError(runtimeCtx, "admin_group.set_group_name", err);
          return { error: `修改群名失败: ${err}` };
        }
      },
    },
    {
      name: "set_group_card",
      description: "修改Bot在当前群内的群名片",
      parameters: {
        type: "object",
        properties: {
          card: { type: "string", description: "新的群名片" },
        },
        required: ["card"],
      },
      handler: async (args: any, runtimeCtx?: any) => {
        const runtime = await resolveGroupRuntime(runtimeCtx);
        if ("error" in runtime) return { error: runtime.error };
        const { bot, selfId, groupId } = runtime;
        const card = String(args?.card || "").trim();
        if (!card) return { error: "card 不能为空" };
        try {
          await bot.setGroupCard(groupId, selfId, card);
          return {
            success: true,
            message: `Bot在当前群的群名片已修改为 ${card}`,
          };
        } catch (err) {
          logAdminSkillError(runtimeCtx, "admin_group.set_group_card", err);
          return { error: `修改群名片失败: ${err}` };
        }
      },
    },
    {
      name: "set_group_avatar",
      description: "修改群头像",
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
        const runtime = await resolveGroupRuntime(runtimeCtx);
        if ("error" in runtime) return { error: runtime.error };
        const { bot, groupId } = runtime;
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
            group_id: groupId,
            file: imageUrl,
          });
          return { success: true, message: "当前群头像已修改" };
        } catch (err) {
          logAdminSkillError(runtimeCtx, "admin_group.set_group_avatar", err);
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
          user_id: { type: "number", description: "成员QQ号" },
          title: { type: "string", description: "新头衔" },
        },
        required: ["user_id", "title"],
      },
      handler: async (args: any, runtimeCtx?: any) => {
        const runtime = await resolveGroupRuntime(runtimeCtx);
        if ("error" in runtime) return { error: runtime.error };
        const { bot, groupId } = runtime;
        try {
          await (bot as any).setGroupSpecialTitle(
            groupId,
            args.user_id,
            args.title,
          );
          return {
            success: true,
            message: `已将 ${args.user_id} 的头衔设为 "${args.title}"`,
          };
        } catch (err) {
          logAdminSkillError(runtimeCtx, "admin_group.set_group_title", err);
          return { error: `设置头衔失败: ${err}` };
        }
      },
    },
    {
      name: "set_self_group_title",
      description: "给当前发起用户设置自己的群专属头衔，不能指定或修改别人",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "新头衔" },
        },
        required: ["title"],
      },
      handler: async (args: any, runtimeCtx?: any) => {
        const runtime = await resolveGroupRuntime(runtimeCtx);
        if ("error" in runtime) return { error: runtime.error };
        const { bot, groupId } = runtime;
        const event = runtimeCtx?.event || runtimeCtx?.rawEvent;
        const userId = event?.user_id;
        if (!userId) return { error: "无法获取当前用户ID" };
        const title = String(args?.title || "").trim();
        if (!title) return { error: "title 不能为空" };
        try {
          await (bot as any).setGroupSpecialTitle(groupId, userId, title);
          return {
            success: true,
            message: `已将你的头衔设为 "${title}"`,
          };
        } catch (err) {
          logAdminSkillError(
            runtimeCtx,
            "admin_group.set_self_group_title",
            err,
          );
          return { error: `设置头衔失败: ${err}` };
        }
      },
    },
  ],
};

export default groupAdminSkill;
