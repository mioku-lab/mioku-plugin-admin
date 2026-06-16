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
    "群管理统一入口。action 决定具体行为：管理成员（踢/禁言/解禁/设管理/设头衔）或管理群（全体禁言/改群名/改Bot群名片/改群头像/撤回消息）。",
  permission: "admin",
  tools: [
    {
      name: "manage_member",
      description:
        "管理群成员：踢人(kick)、禁言(mute)、解除禁言(unmute)、设为管理员(set_admin)、取消管理员(unset_admin)、设置某成员头衔(set_title)、设置自己头衔(set_self_title)。",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: "要执行的动作",
            enum: [
              "kick",
              "mute",
              "unmute",
              "set_admin",
              "unset_admin",
              "set_title",
              "set_self_title",
            ],
          },
          user_id: {
            type: "number",
            description:
              "目标成员QQ号。set_self_title 不需要；其他动作必填。",
          },
          duration: {
            type: "number",
            description: "禁言时长（秒），仅 mute 生效；不提供或<=0时默认600秒",
          },
          title: {
            type: "string",
            description: "头衔内容，仅 set_title / set_self_title 需要",
          },
        },
        required: ["action"],
      },
      handler: async (args: any, runtimeCtx?: any) => {
        const runtime = await resolveGroupRuntime(runtimeCtx);
        if ("error" in runtime) return { error: runtime.error };
        const { bot, selfId, groupId, event } = runtime;
        const action = String(args?.action || "");

        try {
          switch (action) {
            case "kick": {
              const userId = Number(args?.user_id);
              if (!userId) return { error: "kick 需要提供 user_id" };
              const permErr = await checkDangerousTargetPermission(
                runtime,
                userId,
              );
              if (permErr) return { error: permErr };
              await bot.api("set_group_kick", {
                group_id: groupId,
                user_id: userId,
              });
              return { success: true, message: `已将 ${userId} 移出当前群` };
            }
            case "mute": {
              const userId = Number(args?.user_id);
              if (!userId) return { error: "mute 需要提供 user_id" };
              const permErr = await checkDangerousTargetPermission(
                runtime,
                userId,
              );
              if (permErr) return { error: permErr };
              const duration =
                Number(args?.duration) > 0 ? Number(args.duration) : 10 * 60;
              await bot.setGroupBan(groupId, userId, duration);
              return {
                success: true,
                message: `已禁言 ${userId} ${duration}秒`,
              };
            }
            case "unmute": {
              const userId = Number(args?.user_id);
              if (!userId) return { error: "unmute 需要提供 user_id" };
              await bot.setGroupBan(groupId, userId, 0);
              return { success: true, message: `已解除 ${userId} 的禁言` };
            }
            case "set_admin": {
              const userId = Number(args?.user_id);
              if (!userId) return { error: "set_admin 需要提供 user_id" };
              await bot.api("set_group_admin", {
                group_id: groupId,
                user_id: userId,
                enable: true,
              });
              return {
                success: true,
                message: `已将 ${userId} 设为当前群的管理员`,
              };
            }
            case "unset_admin": {
              const userId = Number(args?.user_id);
              if (!userId) return { error: "unset_admin 需要提供 user_id" };
              await bot.api("set_group_admin", {
                group_id: groupId,
                user_id: userId,
                enable: false,
              });
              return {
                success: true,
                message: `已取消 ${userId} 在当前群的管理员`,
              };
            }
            case "set_title": {
              const userId = Number(args?.user_id);
              const title = String(args?.title || "").trim();
              if (!userId || !title) {
                return { error: "set_title 需要提供 user_id 和 title" };
              }
              await (bot as any).setGroupSpecialTitle(groupId, userId, title);
              return {
                success: true,
                message: `已将 ${userId} 的头衔设为 "${title}"`,
              };
            }
            case "set_self_title": {
              const userId = Number(event?.user_id);
              if (!userId) return { error: "无法获取当前用户ID" };
              const title = String(args?.title || "").trim();
              if (!title) return { error: "set_self_title 需要提供 title" };
              await (bot as any).setGroupSpecialTitle(groupId, userId, title);
              return {
                success: true,
                message: `已将你的头衔设为 "${title}"`,
              };
            }
            default:
              return { error: `未知的 action: ${action}` };
          }
        } catch (err) {
          logAdminSkillError(runtimeCtx, `admin_group.manage_member.${action}`, err);
          return { error: `执行 ${action} 失败: ${err}` };
        }
      },
    },
    {
      name: "manage_group",
      description:
        "管理群本身或批量撤回消息：开启/关闭全体禁言(set_whole_ban/unset_whole_ban)、改群名(set_group_name)、改Bot在群里的名片(set_self_card)、改群头像(set_group_avatar)、撤回一条或多条消息(recall_messages，需要 message_ids 数组)。",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: "要执行的动作",
            enum: [
              "set_whole_ban",
              "unset_whole_ban",
              "set_group_name",
              "set_self_card",
              "set_group_avatar",
              "recall_messages",
            ],
          },
          group_name: {
            type: "string",
            description: "新群名，仅 set_group_name 需要",
          },
          card: {
            type: "string",
            description: "新的Bot群名片，仅 set_self_card 需要",
          },
          message_id: {
            type: "number",
            description:
              "包含图片的消息 message_id，仅 set_group_avatar 需要",
          },
          message_ids: {
            type: "array",
            items: { type: "number" },
            description:
              "要撤回的消息 message_id 数组，仅 recall_messages 需要。一次调用可批量撤回。",
          },
        },
        required: ["action"],
      },
      handler: async (args: any, runtimeCtx?: any) => {
        const runtime = await resolveGroupRuntime(runtimeCtx);
        if ("error" in runtime) return { error: runtime.error };
        const { bot, selfId, groupId } = runtime;
        const action = String(args?.action || "");

        try {
          switch (action) {
            case "set_whole_ban":
              await bot.api("set_group_whole_ban", {
                group_id: groupId,
                enable: true,
              });
              return { success: true, message: "当前群已开启全体禁言" };
            case "unset_whole_ban":
              await bot.api("set_group_whole_ban", {
                group_id: groupId,
                enable: false,
              });
              return { success: true, message: "当前群已关闭全体禁言" };
            case "set_group_name": {
              const groupName = String(args?.group_name || "").trim();
              if (!groupName) return { error: "set_group_name 需要提供 group_name" };
              await bot.api("set_group_name", {
                group_id: groupId,
                group_name: groupName,
              });
              return {
                success: true,
                message: `当前群名称已修改为 ${groupName}`,
              };
            }
            case "set_self_card": {
              const card = String(args?.card || "").trim();
              if (!card) return { error: "set_self_card 需要提供 card" };
              await bot.setGroupCard(groupId, selfId, card);
              return {
                success: true,
                message: `Bot在当前群的群名片已修改为 ${card}`,
              };
            }
            case "set_group_avatar": {
              const messageId = Number(args?.message_id);
              if (!Number.isFinite(messageId) || messageId <= 0) {
                return { error: "set_group_avatar 需要提供有效的 message_id" };
              }
              const imageUrl = await getImageUrlByMessageId(bot, messageId);
              if (!imageUrl) {
                return { error: "指定 message_id 中未找到图片" };
              }
              await bot.api("set_group_portrait", {
                group_id: groupId,
                file: imageUrl,
              });
              return { success: true, message: "当前群头像已修改" };
            }
            case "recall_messages": {
              const ids = Array.isArray(args?.message_ids)
                ? args.message_ids
                    .map((v: any) => Number(v))
                    .filter((n: number) => Number.isFinite(n) && n !== 0)
                : [];
              if (ids.length === 0) {
                return { error: "recall_messages 需要提供至少一个 message_id" };
              }
              const results: Array<{
                message_id: number;
                success: boolean;
                error?: string;
              }> = [];
              for (const id of ids) {
                try {
                  await bot.api("delete_msg", { message_id: id });
                  results.push({ message_id: id, success: true });
                } catch (err) {
                  results.push({
                    message_id: id,
                    success: false,
                    error: String(err),
                  });
                }
              }
              const ok = results.filter((r) => r.success).length;
              return {
                success: ok === results.length,
                message: `共尝试撤回 ${results.length} 条消息，成功 ${ok} 条，失败 ${results.length - ok} 条`,
                results,
              };
            }
            default:
              return { error: `未知的 action: ${action}` };
          }
        } catch (err) {
          logAdminSkillError(runtimeCtx, `admin_group.manage_group.${action}`, err);
          return { error: `执行 ${action} 失败: ${err}` };
        }
      },
    },
  ],
};

export default groupAdminSkill;
