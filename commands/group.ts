import type {
  Bot,
  CommandDefinition,
  CommandExecutionContext,
  MiokuContext,
} from "mioku";

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

type GroupContext = CommandExecutionContext & {
  bot: Bot;
  groupIdNum: number;
  senderRole: string;
};

export function registerGroupAdminCommands(ctx: MiokuContext) {
  const register = (
    def: Omit<CommandDefinition, "handler">,
    run: (c: GroupContext) => Promise<void>,
  ) => {
    ctx.command({
      ...def,
      prefixes: false,
      handler: async (c) => {
        const event = c.event;
        if (event.user_id === event.self_id) return;
        if (event.message_type !== "group") return;
        const bot = event.bot;
        if (!bot) return;
        const groupIdNum = event.group_id ? Number(event.group_id) : 0;
        if (!groupIdNum) return;
        const senderRole = await getMemberRole(
          bot,
          groupIdNum,
          Number(event.user_id),
        );
        try {
          await run({ ...c, bot, groupIdNum, senderRole });
        } catch (err) {
          ctx.logger.error(`[admin group] 未捕获异常: ${String(err)}`);
          await replyAdminErrorNotice({
            ctx,
            event,
            instruction: `群管理指令执行时发生未捕获异常：${String(err)}，请简要说明失败并建议稍后重试`,
            fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
            error: err,
          });
        }
      },
    });
  };

  const ensureDangerousTargetPermission = async (
    c: GroupContext,
    targetUserId: number,
    actionName: string,
  ): Promise<boolean> => {
    const { bot, groupIdNum, senderRole, event } = c;
    const targetRole = await getMemberRole(bot, groupIdNum, targetUserId);
    if (senderRole !== targetRole) return true;
    await replyAdminErrorNotice({
      ctx,
      event,
      instruction: `用户想${actionName}目标成员，但操作人与被操作人群身份相同，均为${formatGroupRole(senderRole)}，群管危险操作无权操作同等级成员。请明确告诉用户无权操作同级成员。`,
      fallbackMessage: "无权操作同级成员哦～",
    });
    return false;
  };

  register(
    {
      name: "我要头衔",
      match: /^我要头衔/,
      description: "普通群员给自己设置专属头衔",
      usage: "我要头衔 头衔内容",
    },
    async (c) => {
      const { ctx, event, bot, groupIdNum, body } = c;
      const atUser = getAtUserId(event.message);
      if (atUser != null && atUser !== Number(event.user_id)) {
        await event.reply("管好自己呗～", true);
        return;
      }
      const title = body.replace(/^我要头衔\s*/, "").trim();
      if (!title) {
        await event.reply("想要什么头衔呀～", true);
        return;
      }
      try {
        await bot.setMemberTitle(groupIdNum, event.user_id!, title);
        await event.reply("done");
      } catch (err) {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction: `为用户设置个人头衔执行失败：${String(err)}，请简要说明失败并建议稍后重试`,
          fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
          error: err,
        });
      }
    },
  );

  register(
    {
      name: "/改头衔",
      match: /^\/?改头衔(?:\s|$)/,
      permission: "admin",
      description: "设置群成员专属头衔",
      usage: "/改头衔 qq号或@人 头衔",
    },
    async (c) => {
      const { ctx, event, bot, groupIdNum, body } = c;
      const rest = body.replace(/^\/?改头衔\s*/, "").trim();
      const atUser = getAtUserId(event.message);
      let targetUser: number | undefined = atUser;
      let title: string;

      const isSlashCommand = body.startsWith("/");

      if (atUser) {
        title = rest.replace(/@\d+\s*/, "").trim();
      } else {
        const parts = rest.split(/\s+/);
        if (parts.length < 2) {
          if (!isSlashCommand) return;
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
        if (!isSlashCommand) return;
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
        await bot.setMemberTitle(groupIdNum, targetUser, title);
        await event.reply("done");
      } catch (err) {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction: `改头衔执行失败： ${String(err)}，请简要说明失败并建议稍后重试`,
          fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
          error: err,
        });
      }
    },
  );

  register(
    {
      name: "/踢",
      match: /^\/?踢(?:\s|$)/,
      permission: "admin",
      description: "踢出群成员",
    },
    async (c) => {
      const { ctx, event, bot, groupIdNum, body } = c;
      const atUser = getAtUserId(event.message);
      const isSlashCommand = body.startsWith("/");
      if (!atUser && !isSlashCommand) return;
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
      if (!(await ensureDangerousTargetPermission(c, atUser, "踢出"))) return;
      try {
        await bot.kickMember(groupIdNum, atUser);
        await event.reply("done");
      } catch (err) {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction: `踢执行失败${String(err)}，请简要说明失败`,
          fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
          error: err,
        });
      }
    },
  );

  register(
    {
      name: "/禁言",
      match: /^\/?禁(?:言)?(?:\s|$)/,
      permission: "admin",
      description: "禁言群成员（支持分钟/小时/天）",
      usage: "/禁言 @人 10分钟",
    },
    async (c) => {
      const { ctx, event, bot, groupIdNum, body } = c;
      const atUser = getAtUserId(event.message);
      const isSlashCommand = body.startsWith("/");
      if (!atUser && !isSlashCommand) return;
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
      if (!(await ensureDangerousTargetPermission(c, atUser, "禁言"))) return;
      const rest = body.replace(/^\/?禁言\s*/, "").trim();
      const durationStr = rest.replace(/@\d+\s*/, "").trim();
      const durationSec = parseDuration(durationStr) || 10 * 60;
      try {
        await bot.banMember(groupIdNum, atUser, durationSec);
        await event.reply("done");
      } catch (err) {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction: `禁言执行失败：${String(err)}，请简要说明失败并建议稍后重试`,
          fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
          error: err,
        });
      }
    },
  );

  register(
    {
      name: "/解禁",
      match: /^\/?解(?:禁)?(?:\s|$)/,
      permission: "admin",
      description: "解除群成员禁言",
    },
    async (c) => {
      const { ctx, event, bot, groupIdNum, body } = c;
      const atUser = getAtUserId(event.message);
      const isSlashCommand = body.startsWith("/");
      if (!atUser && !isSlashCommand) return;
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
        await bot.banMember(groupIdNum, atUser, 0);
        await event.reply("done");
      } catch (err) {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction: `解禁执行失败：${String(err)}，请简要说明失败`,
          fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
          error: err,
        });
      }
    },
  );

  register(
    {
      name: "/设管理",
      match: /^\/?设管理(?:\s|$)/,
      permission: "admin",
      description: "设置群管理员",
    },
    async (c) => {
      const { ctx, event, bot, groupIdNum, body } = c;
      const atUser = getAtUserId(event.message);
      const isSlashCommand = body.startsWith("/");
      if (!atUser && !isSlashCommand) return;
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
        await bot.setMemberAdmin(groupIdNum, atUser, true);
        await event.reply("done");
      } catch (err) {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction: `设管理执行失败：${String(err)}，请简要说明失败`,
          fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
          error: err,
        });
      }
    },
  );

  register(
    {
      name: "/全体禁言",
      match: /^\/全体禁言$/,
      permission: "admin",
      description: "开启全体禁言",
    },
    async (c) => {
      const { ctx, event, bot, groupIdNum } = c;
      try {
        await bot.setGroupWholeBan(groupIdNum, true);
        await event.reply("done");
      } catch (err) {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction: `全体禁言执行失败：${String(err)}，请简要说明失败`,
          fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
          error: err,
        });
      }
    },
  );

  register(
    {
      name: "/全体解禁",
      match: /^\/全体解禁$/,
      permission: "admin",
      description: "关闭全体禁言",
    },
    async (c) => {
      const { ctx, event, bot, groupIdNum } = c;
      try {
        await bot.setGroupWholeBan(groupIdNum, false);
        await event.reply("done");
      } catch (err) {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction: `全体解禁执行失败：${String(err)}，请简要说明失败`,
          fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
          error: err,
        });
      }
    },
  );

  register(
    {
      name: "/改群名片",
      match: /^\/?改群名片(?:\s|$)/,
      permission: "admin",
      description: "修改Bot在群里的名片",
    },
    async (c) => {
      const { ctx, event, bot, groupIdNum, body } = c;
      const card = body.replace(/^\/?改群名片\s*/, "").trim();
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
        await bot.setMemberCard(groupIdNum, event.self_id ?? "", card);
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
    },
  );

  register(
    {
      name: "/改群昵称",
      match: /^\/改群昵称/,
      permission: "admin",
      description: "修改群聊名称",
    },
    async (c) => {
      const { ctx, event, bot, groupIdNum, body } = c;
      const groupName = body.replace(/^\/改群昵称\s*/, "").trim();
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
        await bot.setGroupName(groupIdNum, groupName);
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
    },
  );

  register(
    {
      name: "/改群头像",
      match: /^\/改群头像/,
      permission: "admin",
      description: "修改群头像",
    },
    async (c) => {
      const { ctx, event, bot, groupIdNum } = c;
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
        await bot.setGroupPortrait(groupIdNum, imageUrl);
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
    },
  );

  register(
    {
      name: "/撤回",
      match: /^\/?撤回(?:\s|$)/,
      permission: "admin",
      description: "撤回别人的消息",
      usage: "引用一条消息后输入 /撤回",
    },
    async (c) => {
      const { ctx, event, bot } = c;
      const quotedId = event.quote_id;
      if (!quotedId) {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction:
            "用户希望撤回一条消息，但命令中没有引用具体消息，请提醒用户引用要撤回的消息后输入 /撤回",
          fallbackMessage: "要撤回哪条消息呀～先引用一下～",
        });
        return;
      }
      try {
        await bot.recallMessage(quotedId);
        await event.reply("done");
      } catch (err) {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction: `撤回消息执行失败：${String(err)}。失败原因通常是Bot没有该消息的撤回权限（需要Bot为群主或管理员，且消息发出不超过2分钟），管理员无法撤回管理员的消息或群主的消息。`,
          fallbackMessage: `撤回失败啦～可能是没权限或消息超过2分钟了：${String(err)}`,
          error: err,
        });
      }
    },
  );
}
