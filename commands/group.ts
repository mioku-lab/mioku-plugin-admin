import type { MiokiContext } from "mioki";
import {
  extractImageUrl,
  getAtUserId,
  getMemberRole,
  parseDuration,
} from "../config";
import { replyAdminErrorNotice } from "./notice";

function formatGroupRole(role: string): string {
  if (role === "owner") return "群主";
  if (role === "admin") return "管理员";
  return "群成员";
}

export function registerGroupAdminCommands(ctx: MiokiContext) {
  ctx.handle("message", async (event: any) => {
    const text = ctx.text(event)?.trim();
    if (!text) return;
    if (event.user_id === event.self_id) return;

    const isGroupAdminCommand = [
      "改头衔",
      "/改头衔",
      "我要头衔",
      "踢",
      "/踢",
      "禁言",
      "/禁言",
      "解禁",
      "/解禁",
      "设管理",
      "/设管理",
      "/全体禁言",
      "/全体解禁",
      "改群名片",
      "/改群名片",
      "/改群昵称",
      "/改群头像",
    ].some((prefix) => text.startsWith(prefix));

    try {
      const selfId = event.self_id;
      const bot = ctx.pickBot(selfId);
      if (!bot) return;

      const isGroup = event.message_type === "group";
      const groupId: number | undefined = isGroup ? event.group_id : undefined;
      if (!isGroup || !groupId) return;

      const isMaster = ctx.isOwner?.(event) ?? false;
      const senderRole = await getMemberRole(bot, groupId, event.user_id);
      const hasAdminPermission =
        isMaster || senderRole === "owner" || senderRole === "admin";

      const replyDone = async () => {
        await event.reply("done");
      };
      const ensureAdminPermission = async (instruction?: string) => {
        if (hasAdminPermission) return true;
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction:
            instruction ||
            "用户想让你执行群管操作但用户不是群主或管理员，无权限让操作",
          fallbackMessage: "你得是群主或管理员才行哦～",
        });
        return false;
      };
      const ensureDangerousTargetPermission = async (
        targetUserId: number,
        actionName: string,
      ) => {
        const targetRole = await getMemberRole(bot, groupId, targetUserId);
        if (senderRole !== targetRole) return true;

        await replyAdminErrorNotice({
          ctx,
          event,
          instruction: `用户想${actionName}目标成员，但操作人与被操作人群身份相同，均为${formatGroupRole(senderRole)}，群管危险操作无权操作同等级成员。请明确告诉用户无权操作同级成员。`,
          fallbackMessage: "无权操作同级成员哦～",
        });
        return false;
      };

      // 普通群员只能给自己设置头衔。
      if (text.startsWith("我要头衔")) {
        const atUser = getAtUserId(event.message);
        if (atUser && atUser !== event.user_id) {
          await event.reply("管好自己呗～", true);
          return;
        }

        const title = text.replace(/^我要头衔\s*/, "").trim();
        if (!title) {
          await event.reply("想要什么头衔呀～", true);
          return;
        }

        try {
          await (bot as any).setGroupSpecialTitle(
            groupId,
            event.user_id,
            title,
          );
          await replyDone();
        } catch (err) {
          await replyAdminErrorNotice({
            ctx,
            event,
            instruction: `为用户设置个人头衔执行失败：${String(err)}，请简要说明失败并建议稍后重试`,
            fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
            error: err,
          });
        }
        return;
      }

      // 改头衔
      if (text.startsWith("改头衔") || text.startsWith("/改头衔")) {
        if (!(await ensureAdminPermission())) return;

        const rest = text.replace(/^\/?改头衔\s*/, "").trim();
        const atUser = getAtUserId(event.message);
        let targetUser: number | undefined = atUser;
        let title: string;

        if (atUser) {
          title = rest.replace(/@\d+\s*/, "").trim();
        } else {
          const parts = rest.split(/\s+/);
          if (parts.length < 2) {
            await replyAdminErrorNotice({
              ctx,
              event,
              instruction:
                "用户在让你修改别人的头衔时缺少参数，请提示用户命令后需要加qq号或@人",
              fallbackMessage: "想改谁的头衔呀～",
            });
            return;
          }
          targetUser = parseInt(parts[0], 10);
          title = parts.slice(1).join(" ");
        }

        if (!targetUser || !title) {
          await replyAdminErrorNotice({
            ctx,
            event,
            instruction:
              "用户触发改头衔时参数无效，请提示用户命令后需要加qq号或@人",
            fallbackMessage: "想改谁的头衔呀～",
          });
          return;
        }

        try {
          await (bot as any).setGroupSpecialTitle(groupId, targetUser, title);
          await replyDone();
        } catch (err) {
          await replyAdminErrorNotice({
            ctx,
            event,
            instruction: `改头衔执行失败： ${String(err)}，请简要说明失败并建议稍后重试`,
            fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
            error: err,
          });
        }
        return;
      }

      // 踢
      if (text.startsWith("踢") || text.startsWith("/踢")) {
        if (!(await ensureAdminPermission())) return;
        const atUser = getAtUserId(event.message);
        if (!atUser) {
          await replyAdminErrorNotice({
            ctx,
            event,
            instruction:
              "用户希望从群聊中踢出一个人，请提醒要在命令后@要踢出的人",
            fallbackMessage: "你想踢掉谁呀～",
          });
          return;
        }
        if (!(await ensureDangerousTargetPermission(atUser, "踢出"))) return;
        try {
          await bot.api("set_group_kick", {
            group_id: groupId,
            user_id: atUser,
          });
          await replyDone();
        } catch (err) {
          await replyAdminErrorNotice({
            ctx,
            event,
            instruction: `踢执行失败${String(err)}，请简要说明失败`,
            fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
            error: err,
          });
        }
        return;
      }

      if (
        text.startsWith("禁言") ||
        text.startsWith("/禁言") ||
        text.startsWith("/禁") ||
        text.startsWith("禁")
      ) {
        if (!(await ensureAdminPermission())) return;
        const atUser = getAtUserId(event.message);
        if (!atUser) {
          await replyAdminErrorNotice({
            ctx,
            event,
            instruction:
              "用户希望禁言一个人，但是没有目标，请提醒要在命令后@要禁言的人",
            fallbackMessage: "想把谁关小黑屋呀～",
          });
          return;
        }
        if (!(await ensureDangerousTargetPermission(atUser, "禁言"))) return;
        const rest = text.replace(/^\/?禁言\s*/, "").trim();
        const durationStr = rest.replace(/@\d+\s*/, "").trim();
        const durationSec = parseDuration(durationStr) || 10 * 60;
        try {
          await bot.setGroupBan(groupId, atUser, durationSec);
          await replyDone();
        } catch (err) {
          await replyAdminErrorNotice({
            ctx,
            event,
            instruction: `禁言执行失败：${String(err)}，请简要说明失败并建议稍后重试`,
            fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
            error: err,
          });
        }
        return;
      }

      if (
        text.startsWith("解禁") ||
        text.startsWith("/解禁") ||
        text.startsWith("/解") ||
        text.startsWith("解")
      ) {
        if (!(await ensureAdminPermission())) return;
        const atUser = getAtUserId(event.message);
        if (!atUser) {
          await replyAdminErrorNotice({
            ctx,
            event,
            instruction:
              "用户想让你解除一个人的禁言，请提醒要在命令后@要解禁的人",
            fallbackMessage: "你想拉谁出来呀～",
          });
          return;
        }
        try {
          await bot.setGroupBan(groupId, atUser, 0);
          await replyDone();
        } catch (err) {
          await replyAdminErrorNotice({
            ctx,
            event,
            instruction: `解禁执行失败：${String(err)}，请简要说明失败`,
            fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
            error: err,
          });
        }
        return;
      }

      if (text.startsWith("设管理") || text.startsWith("/设管理")) {
        if (!(await ensureAdminPermission())) return;
        const atUser = getAtUserId(event.message);
        if (!atUser) {
          await replyAdminErrorNotice({
            ctx,
            event,
            instruction:
              "用户希望你把一个人设置成群管理员，但是没有目标，请提醒要在命令后@要设为管理的人",
            fallbackMessage: "你想给谁管理呀～",
          });
          return;
        }
        try {
          await bot.api("set_group_admin", {
            group_id: groupId,
            user_id: atUser,
            enable: true,
          });
          await replyDone();
        } catch (err) {
          await replyAdminErrorNotice({
            ctx,
            event,
            instruction: `设管理执行失败：${String(err)}，请简要说明失败`,
            fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
            error: err,
          });
        }
        return;
      }

      if (text === "/全体禁言") {
        if (!(await ensureAdminPermission())) return;
        try {
          await bot.api("set_group_whole_ban", {
            group_id: groupId,
            enable: true,
          });
          await replyDone();
        } catch (err) {
          await replyAdminErrorNotice({
            ctx,
            event,
            instruction: `全体禁言执行失败：${String(err)}，请简要说明失败`,
            fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
            error: err,
          });
        }
        return;
      }

      if (text === "/全体解禁") {
        if (!(await ensureAdminPermission())) return;
        try {
          await bot.api("set_group_whole_ban", {
            group_id: groupId,
            enable: false,
          });
          await replyDone();
        } catch (err) {
          await replyAdminErrorNotice({
            ctx,
            event,
            instruction: `全体解禁执行失败：${String(err)}，请简要说明失败`,
            fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
            error: err,
          });
        }
        return;
      }

      if (text.startsWith("改群名片") || text.startsWith("/改群名片")) {
        if (!isGroup || !groupId) {
          return event.reply("这个要在群里用哦～", true);
        }
        if (!(await ensureAdminPermission())) return;
        const card = text.replace(/^\/?改群名片\s*/, "").trim();
        if (!card) {
          await replyAdminErrorNotice({
            ctx,
            event,
            instruction: "用户希望修改你在群里的昵称，但是没有指定名称。",
            fallbackMessage: "名片内容呢～",
          });
          return;
        }
        try {
          await bot.setGroupCard(groupId, selfId, card);
          await event.reply("done");
        } catch (err) {
          await replyAdminErrorNotice({
            ctx,
            event,
            instruction: `改群名片执行失败，${String(err)}`,
            fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
            error: err,
          });
        }
        return;
      }

      if (text.startsWith("/改群昵称")) {
        if (!isGroup || !groupId) {
          return event.reply("这个要在群里用哦～", true);
        }
        if (!(await ensureAdminPermission())) return;
        const groupName = text.replace(/^\/改群昵称\s*/, "").trim();
        if (!groupName) {
          await replyAdminErrorNotice({
            ctx,
            event,
            instruction:
              "用户希望修改群聊的名称，但是没有告诉你新的名称是啥，请提醒输入群聊名称",
            fallbackMessage: "群名想改成什么呀～",
          });
          return;
        }
        try {
          await bot.api("set_group_name", {
            group_id: groupId,
            group_name: groupName,
          });
          await event.reply("done");
        } catch (err) {
          await replyAdminErrorNotice({
            ctx,
            event,
            instruction: `改群昵称执行失败${String(err)}`,
            fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
            error: err,
          });
        }
        return;
      }

      if (text.startsWith("/改群头像")) {
        if (!isGroup || !groupId) {
          return event.reply("这个要在群里用哦～", true);
        }
        if (!(await ensureAdminPermission())) return;
        const imageUrl = extractImageUrl(event.message);
        if (!imageUrl) {
          await replyAdminErrorNotice({
            ctx,
            event,
            instruction:
              "用户希望修改群聊的群头像，但是没有发你图片，请提醒附带图片或引用图片。",
            fallbackMessage: "图片呢图片呢～",
          });
          return;
        }
        try {
          await bot.api("set_group_portrait", {
            group_id: groupId,
            file: imageUrl,
          });
          await event.reply("done");
        } catch (err) {
          await replyAdminErrorNotice({
            ctx,
            event,
            instruction: `改群头像执行失败 ${String(err)}`,
            fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
            error: err,
          });
        }
        return;
      }
    } catch (err) {
      ctx.logger.error(`[admin group] 未捕获异常: ${String(err)}`);
      if (!isGroupAdminCommand) return;
      await replyAdminErrorNotice({
        ctx,
        event,
        instruction: `群管理指令执行时发生未捕获异常：${String(err)}，请简要说明失败并建议稍后重试`,
        fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
        error: err,
      });
    }
  });
}
