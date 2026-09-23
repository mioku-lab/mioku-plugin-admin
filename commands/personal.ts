import type { Bot, CommandDefinition, MessageEvent, MessageInput, MessageTarget, MiokuContext, MessageSegment } from "mioku";
import {createGroupRef} from "mioku";
import { extractImageUrl } from "../config";
import { replyAdminErrorNotice } from "./notice";

function parseProfileSex(value: string): 0 | 1 | 2 {
  const normalized = String(value || "").trim();
  if (normalized === "男" || normalized === "1") return 1;
  if (normalized === "女" || normalized === "2") return 2;
  return 0;
}

function toSendSegment(ctx: MiokuContext, seg: MessageSegment): MessageSegment | null {
  const data = seg.data as Record<string, unknown>;
  switch (seg.type) {
    case "text": {
      const text = String(data.text ?? "").trim();
      return text ? ctx.segment.text(text) : null;
    }
    case "image": {
      const source = String(data.url ?? data.file ?? "").trim();
      return source ? ctx.segment.image(source) : null;
    }
    case "record": {
      const source = String(data.file ?? data.url ?? "").trim();
      return source ? ctx.segment.raw("record", { file: source }) : null;
    }
    case "video": {
      const source = String(data.file ?? data.url ?? "").trim();
      return source ? ctx.segment.raw("video", { file: source }) : null;
    }
    case "file": {
      const source = String(data.file ?? data.url ?? "").trim();
      return source ? ctx.segment.raw("file", { file: source }) : null;
    }
    case "at": {
      const target = String(data.qq ?? data.target ?? "");
      return target && target !== "all" ? ctx.segment.at(target) : null;
    }
    case "face": {
      const id = data.id;
      return id == null ? null : ctx.segment.raw("face", { id: String(id) });
    }
    case "reply": {
      const id = data.message_id ?? data.id;
      return id == null ? null : ctx.segment.reply(String(id));
    }
    case "forward": {
      const id = data.id;
      return id == null ? null : ctx.segment.raw("forward", { id: String(id) });
    }
    case "json": {
      return ctx.segment.raw("json", data);
    }
    default:
      return seg;
  }
}

function normalizeIncomingSegments(
  ctx: MiokuContext,
  segments: readonly MessageSegment[],
): MessageSegment[] {
  if (!Array.isArray(segments)) return [];
  return segments
    .map((seg) => toSendSegment(ctx, seg))
    .filter((seg): seg is MessageSegment => seg !== null);
}

function buildForwardPayloadAfterCommand(
  ctx: MiokuContext,
  message: readonly MessageSegment[],
  commandPattern: RegExp,
  fallbackText?: string,
): MessageSegment[] {
  const payload: MessageSegment[] = [];
  let stripped = false;

  for (const seg of message) {
    if (seg.type !== "text") {
      const converted = toSendSegment(ctx, seg);
      if (converted) {
        payload.push(converted);
      }
      continue;
    }
    const original = String((seg.data as Record<string, unknown>).text ?? "");
    if (!stripped) {
      const nextText = original.replace(commandPattern, "");
      if (nextText !== original) {
        stripped = true;
        const text = nextText.trim();
        if (text) {
          payload.push(ctx.segment.text(text));
        }
        continue;
      }
    }
    if (original.trim()) {
      payload.push(ctx.segment.text(original));
    }
  }

  if (payload.length === 0) {
    const text = String(fallbackText || "").trim();
    if (text) {
      payload.push(ctx.segment.text(text));
    }
  }

  return payload;
}

async function sendForwardByEvent(options: {
  bot: Bot;
  event: MessageEvent;
  messages: readonly unknown[];
}): Promise<void> {
  const { bot, event, messages } = options;
  const chunkSize = 50;

  const nodes = (messages as Array<{
    type?: string;
    data?: { user_id?: string; nickname?: string; content?: unknown };
  }>)
    .map((node) => ({
      user_id: String(node?.data?.user_id ?? event.user_id ?? ""),
      nickname:
        String(node?.data?.nickname || "") ||
        String(node?.data?.user_id ?? event.user_id ?? "转发"),
      content: Array.isArray(node?.data?.content)
        ? node.data.content
        : [node?.data?.content],
    }))
    .filter((node) => node.content.length > 0)
    .map((node) => ({
      user_id: node.user_id,
      nickname: node.nickname,
      content: node.content as MessageInput,
    }));

  const target: MessageTarget =
    event.message_type === "group" && event.group_id
      ? { type: "group", group_id: event.group_id }
      : { type: "private", user_id: event.user_id ?? "" };

  for (let i = 0; i < nodes.length; i += chunkSize) {
    await bot.sendForward(target, nodes.slice(i, i + chunkSize));
  }
}

export function registerPersonalCommands(ctx: MiokuContext) {
  const register = (command: CommandDefinition) => {
    const { handler, ...rest } = command;
    ctx.command({
      ...rest,
      handler: async (c) => {
        if (c.event.user_id === c.event.self_id) return;
        await handler(c);
      },
    });
  };

  register({
    name: "改头像",
    match: /^\/?改头像/,
    permission: "master",
    description: "修改Bot头像",
    handler: async ({ event }) => {
      const bot = event.bot;
      if (!bot) return;
      const imageUrl = extractImageUrl(event.message);
      if (!imageUrl) {
        await event.reply("图片呢图片呢～", true);
        return;
      }
      try {
        await bot.setAvatar(imageUrl);
        await event.reply("done");
      } catch (err) {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction: "改头像执行失败，请简要说明失败并建议稍后重试。",
          fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
          error: err,
        });
      }
    },
  });

  register({
    name: "改昵称",
    match: /^\/?改昵称/,
    permission: "master",
    description: "修改Bot昵称",
    handler: async ({ event, body }) => {
      const bot = event.bot;
      if (!bot) return;
      const nickname = body.replace(/^\/?改昵称\s*/, "").trim();
      if (!nickname) {
        await event.reply("想改成什么昵称呀～", true);
        return;
      }
      try {
        await bot.setProfile({ nickname });
        await event.reply("done");
      } catch (err) {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction: "改昵称执行失败，请简要说明失败并建议稍后重试。",
          fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
          error: err,
        });
      }
    },
  });

  register({
    name: "改签名",
    match: /^\/?改签名/,
    permission: "master",
    description: "修改Bot个性签名",
    handler: async ({ event, body }) => {
      const bot = event.bot;
      if (!bot) return;
      const personalNote = body.replace(/^\/?改签名\s*/, "").trim();
      if (!personalNote) {
        await event.reply("想改成什么签名呀～", true);
        return;
      }
      try {
        await bot.setProfile({ personal_note: personalNote });
        await event.reply("done");
      } catch (err) {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction: "改签名执行失败，请简要说明失败并建议稍后重试。",
          fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
          error: err,
        });
      }
    },
  });

  register({
    name: "改性别",
    match: /^\/?改性别/,
    permission: "master",
    description: "修改Bot性别",
    handler: async ({ event, body }) => {
      const bot = event.bot;
      if (!bot) return;
      const sex = parseProfileSex(body.replace(/^\/?改性别\s*/, ""));
      try {
        await bot.setProfile({ sex });
        await event.reply("done");
      } catch (err) {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction: "改性别执行失败，请简要说明失败并建议稍后重试。",
          fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
          error: err,
        });
      }
    },
  });

  register({
    name: "删好友",
    match: /^\/?删好友(?:\s|$)/,
    permission: "master",
    description: "删除好友",
    usage: ".删好友 qq号",
    handler: async ({ event, body }) => {
      const bot = event.bot;
      if (!bot) return;
      const qq = parseInt(body.replace(/^\/?删好友\s*/, "").trim(), 10);
      if (!qq) {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction: "用户触发删好友时缺少QQ号，请给出示例：/删好友 123456。",
          fallbackMessage: "你要删谁呀～",
        });
        return;
      }
      try {
        await bot.deleteFriend(qq);
        await event.reply("done");
      } catch (err) {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction: "删好友执行失败，请简要说明失败并建议稍后重试。",
          fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
          error: err,
        });
      }
    },
  });

  register({
    name: "退群",
    match: /^\/?退群(?:\s|$)/,
    permission: "master",
    description: "退出群聊",
    usage: ".退群 群号",
    handler: async ({ event, body }) => {
      const bot = event.bot;
      if (!bot) return;
      const targetGroup = parseInt(body.replace(/^\/?退群\s*/, "").trim(), 10);
      if (!targetGroup) {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction: "用户触发退群时缺少群号，请给出示例：/退群 123456。",
          fallbackMessage: "你想退哪个群呀～",
        });
        return;
      }
      try {
        await createGroupRef(bot, String(targetGroup)).leave(false);
        await event.reply("done");
      } catch (err) {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction: "退群执行失败，请简要说明失败并建议稍后重试。",
          fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
          error: err,
        });
      }
    },
  });

  register({
    name: "发好友",
    match: /^\/?发好友(?:\s|$)/,
    permission: "master",
    description: "给好友发送私聊消息",
    usage: ".发好友 qq号 内容",
    handler: async ({ event, body }) => {
      const bot = event.bot;
      if (!bot) return;
      const matched = body.match(/^\/发好友\s*(\d+)\s*([\s\S]*)$/);
      if (!matched) {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction:
            "用户触发发好友指令时参数不足，请提示用法：/发好友 QQ号 内容。",
          fallbackMessage: "要发给谁、发什么呀～",
        });
        return;
      }
      const targetUser = Number(matched[1]);
      const fallbackText = String(matched[2] || "").trim();
      const payload = buildForwardPayloadAfterCommand(
        ctx,
        event?.message || [],
        /^\/发好友\s*\d+\s*/,
        fallbackText,
      );
      if (!targetUser || !payload.length) {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction:
            "用户触发发好友指令时缺少目标QQ号或内容，请提示用法：/发好友 QQ号 内容（也支持图片/语音/视频）。",
          fallbackMessage: "要发给谁、发什么呀～",
        });
        return;
      }
      try {
        await bot.sendMessage({ type: "private", user_id: targetUser}, payload);
        await event.reply("done");
      } catch (err) {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction: "发好友消息执行失败，请简要说明失败并建议稍后重试。",
          fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
          error: err,
        });
      }
    },
  });

  register({
    name: "发群聊",
    match: /^\/?发群聊(?:\s|$)/,
    permission: "master",
    description: "给群聊发送消息",
    usage: ".发群聊 群号 内容",
    handler: async ({ event, body }) => {
      const bot = event.bot;
      if (!bot) return;
      const matched = body.match(/^\/发群聊\s*(\d+)\s*([\s\S]*)$/);
      if (!matched) {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction:
            "用户触发发群聊指令时参数不足，请提示用法：/发群聊 群号 内容。",
          fallbackMessage: "要发到哪个群、发什么呀～",
        });
        return;
      }
      const targetGroup = Number(matched[1]);
      const fallbackText = String(matched[2] || "").trim();
      const payload = buildForwardPayloadAfterCommand(
        ctx,
        event?.message || [],
        /^\/发群聊\s*\d+\s*/,
        fallbackText,
      );
      if (!targetGroup || !payload.length) {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction:
            "用户触发发群聊指令时缺少群号或内容，请提示用法：/发群聊 群号 内容（也支持图片/语音/视频）。",
          fallbackMessage: "要发到哪个群、发什么呀～",
        });
        return;
      }
      try {
        await bot.sendMessage({ type: "group", group_id: targetGroup}, payload);
        await event.reply("done");
      } catch (err) {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction: "发群聊消息执行失败，请简要说明失败并建议稍后重试。",
          fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
          error: err,
        });
      }
    },
  });

  register({
    name: "全部好友",
    match: /^\/?全部好友$/,
    permission: "master",
    description: "获取全部好友列表",
    handler: async ({ event }) => {
      const bot = event.bot;
      if (!bot) return;
      if (event.message_type === "group") {
        await event.reply("在私聊使用试试看吧～", true);
        return;
      }
      try {
        const friendList = await bot.getFriendList();
        if (!Array.isArray(friendList) || friendList.length === 0) {
          await replyAdminErrorNotice({
            ctx,
            event,
            instruction: "查询全部好友时列表为空，请简短告知当前没有好友数据。",
            fallbackMessage: "你现在还没有好友哦～",
          });
          return;
        }
        const nodes = friendList.map((friend) =>
          ctx.segment.raw("node", {
            user_id: friend.user_id,
            nickname:
              friend.nickname || friend.remark || String(friend.user_id),
            content: [
              ctx.segment.image(
                `https://q1.qlogo.cn/g?b=qq&nk=${friend.user_id}&s=640`,
              ),
              ctx.segment.text(
                `昵称：${friend.nickname || "未知"}\nQQ号：${friend.user_id}\n备注：${friend.remark || "无"}`,
              ),
            ],
          }),
        );
        await sendForwardByEvent({ bot, event, messages: nodes });
      } catch (err) {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction: "获取好友列表失败，请简要说明失败并建议稍后重试。",
          fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
          error: err,
        });
      }
    },
  });

  register({
    name: "全部群聊",
    match: /^\/?全部群聊$/,
    permission: "master",
    description: "获取全部群聊列表",
    handler: async ({ event }) => {
      const bot = event.bot;
      if (!bot) return;
      if (event.message_type === "group") {
        await event.reply("在私聊使用试试看吧～", true);
        return;
      }
      try {
        const groupList = await bot.getGroupList();
        if (!Array.isArray(groupList) || groupList.length === 0) {
          await replyAdminErrorNotice({
            ctx,
            event,
            instruction: "查询全部群聊时列表为空，请简短告知当前没有群聊数据。",
            fallbackMessage: "你现在还没有群聊哦～",
          });
          return;
        }
        const nodes = groupList.map((group) =>
          ctx.segment.raw("node", {
            user_id: event.self_id ?? "",
            nickname: String(event.self_id ?? ""),
            content: [
              ctx.segment.image(
                `https://p.qlogo.cn/gh/${group.group_id}/${group.group_id}/640/`,
              ),
              ctx.segment.text(
                `群名称：${group.group_name || "未知"}\n群号：${group.group_id}\n人数：${group.member_count || "未知"}`,
              ),
            ],
          }),
        );
        await sendForwardByEvent({ bot, event, messages: nodes });
      } catch (err) {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction: "获取群聊列表失败，请简要说明失败并建议稍后重试。",
          fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
          error: err,
        });
      }
    },
  });
}
