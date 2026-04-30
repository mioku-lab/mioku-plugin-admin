import { MiokiContext } from "mioki";
import type {
  MessageEvent,
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
import { extractImageUrl } from "../config";
import { replyAdminErrorNotice } from "./notice";

function parseProfileSex(value: string): 0 | 1 | 2 {
  const normalized = String(value || "").trim();
  if (normalized === "男" || normalized === "1") return 1;
  if (normalized === "女" || normalized === "2") return 2;
  return 0;
}

function toSendSegment(ctx: MiokiContext, seg: RecvElement): any | null {
  if (seg.type === "text") {
    const text = String((seg as RecvTextElement).text || "");
    return text ? ctx.segment.text(text) : null;
  }

  if (seg.type === "image" || seg.type === "record" || seg.type === "video") {
    const mediaSeg = seg as
      | RecvImageElement
      | RecvRecordElement
      | RecvVideoElement;
    const source = String(mediaSeg.url || mediaSeg.file || "").trim();
    if (!source) return null;
    if (seg.type === "image") {
      return ctx.segment.image(source);
    }
    if (seg.type === "record") {
      return (ctx.segment as any).record(source);
    }
    return (ctx.segment as any).video(source);
  }

  if (seg.type === "file") {
    const fileSeg = seg as RecvFileElement;
    const source = String(fileSeg.url || fileSeg.file || "").trim();
    if (!source) return null;
    return (ctx.segment as any).file(source);
  }

  if (seg.type === "at") {
    const qq = (seg as RecvAtElement).qq;
    return qq == null ? null : ctx.segment.at(String(qq));
  }

  if (seg.type === "face") {
    const id = (seg as RecvFaceElement).id;
    return id == null ? null : ctx.segment.face(Number(id));
  }

  if (seg.type === "reply") {
    const id = (seg as RecvReplyElement).id;
    return id == null ? null : ctx.segment.reply(String(id));
  }

  if (seg.type === "forward") {
    const id = (seg as RecvForwardElement).id;
    return id == null
      ? null
      : ((ctx.segment as any).forward?.(String(id)) ?? null);
  }

  if (seg.type === "json") {
    const data = (seg as RecvJsonElement).data;
    return ctx.segment.json ? ctx.segment.json(data) : null;
  }

  return null;
}

function normalizeIncomingSegments(
  ctx: MiokiContext,
  segments: RecvElement[],
): any[] {
  if (!Array.isArray(segments)) return [];
  return segments.map((seg) => toSendSegment(ctx, seg)).filter(Boolean);
}

function buildForwardPayloadAfterCommand(
  ctx: MiokiContext,
  message: RecvElement[],
  commandPattern: RegExp,
  fallbackText?: string,
): any[] {
  const payload: any[] = [];
  let stripped = false;

  for (const seg of message) {
    if (seg.type !== "text") {
      const converted = toSendSegment(ctx, seg);
      if (converted) {
        payload.push(converted);
      }
      continue;
    }
    const original = String((seg as RecvTextElement).text || "");
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

function toForwardMessages(bot: any, nodes: any[]): any[] {
  const normalizeElements = (elements: any[]): any[] => {
    if (typeof bot?.normalizeSendable === "function") {
      return bot.normalizeSendable(elements);
    }
    return elements.map((element: any) => {
      if (
        element &&
        typeof element === "object" &&
        "type" in element &&
        "data" in element
      ) {
        return element;
      }
      if (element && typeof element === "object" && "type" in element) {
        const { type, ...data } = element;
        return { type, data };
      }
      return element;
    });
  };

  return nodes.map((node: any) => {
    const rawNode =
      node && typeof node === "object" && "type" in node && "data" in node
        ? { type: node.type, ...node.data }
        : node;
    if (!rawNode || rawNode.type !== "node") {
      return normalizeElements([rawNode])[0];
    }

    const content = Array.isArray(rawNode.content) ? rawNode.content : [];
    if ("id" in rawNode && rawNode.id) {
      return {
        type: "node",
        data: {
          user_id: rawNode.user_id,
          nickname: rawNode.nickname,
          id: rawNode.id,
        },
      };
    }

    return {
      type: "node",
      data: {
        user_id: rawNode.user_id,
        nickname: rawNode.nickname,
        content: normalizeElements(content),
      },
    };
  });
}

async function sendForwardByEvent(options: {
  bot: any;
  event: any;
  messages: any[];
}): Promise<void> {
  const { bot, event, messages } = options;
  const chunkSize = 50;

  for (let i = 0; i < messages.length; i += chunkSize) {
    const chunk = messages.slice(i, i + chunkSize);
    if (event?.message_type === "group" && event?.group_id) {
      await bot.api("send_group_forward_msg", {
        group_id: event.group_id,
        messages: chunk,
      });
      continue;
    }

    await bot.api("send_private_forward_msg", {
      user_id: event.user_id,
      messages: chunk,
    });
  }
}

export function registerPersonalCommands(ctx: MiokiContext) {
  ctx.handle("message", async (event: MessageEvent) => {
    const text = ctx.text(event)?.trim();
    if (!text) return;
    if (event.user_id === event.self_id) return;

    const isMaster = ctx.isOwner?.(event) ?? false;

    const selfId = event.self_id;
    const bot = ctx.pickBot(selfId);
    if (!bot) return;

    const isGroup = event.message_type === "group";

    if (text.startsWith("/改头像")) {
      if (!isMaster) {
        ctx.logger.warn("[admin] 改头像功能仅主人可用");
        return;
      }
      const imageUrl = extractImageUrl(event.message);
      if (!imageUrl) {
        return event.reply("图片呢图片呢～", true);
      }
      try {
        await bot.api("set_qq_avatar", { file: imageUrl });
        await event.reply("done");
      } catch (err) {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction: "改头像执行失败，请简要说明失败并建议稍后重试。",
          fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
          error: err,
        });
        return;
      }
      return;
    }

    if (text.startsWith("/改昵称")) {
      if (!isMaster) {
        ctx.logger.warn("[admin] 改昵称功能仅主人可用");
        return;
      }
      const nickname = text.replace(/^\/改昵称\s*/, "").trim();
      if (!nickname) {
        return event.reply("想改成什么昵称呀～", true);
      }
      try {
        await bot.api("set_qq_profile", { nickname });
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
      return;
    }

    if (text.startsWith("/改签名")) {
      if (!isMaster) {
        ctx.logger.warn("[admin] 改签名功能仅主人可用");
        return;
      }
      const personalNote = text.replace(/^\/改签名\s*/, "").trim();
      if (!personalNote) {
        return event.reply("想改成什么签名呀～", true);
      }
      try {
        await bot.api("set_qq_profile", { personal_note: personalNote });
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
      return;
    }

    if (text.startsWith("/改性别")) {
      if (!isMaster) {
        ctx.logger.warn("[admin] 改性别功能仅主人可用");
        return;
      }
      const genderText = text.replace(/^\/改性别\s*/, "").trim();
      const sex = parseProfileSex(genderText);
      try {
        await bot.api("set_qq_profile", { sex });
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
      return;
    }

    if (text.startsWith("/删好友")) {
      if (!isMaster) {
        ctx.logger.warn("[admin] 删好友功能仅主人可用");
        return;
      }
      const qq = parseInt(text.replace(/^\/删好友\s*/, "").trim(), 10);
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
        await bot.api("delete_friend", { user_id: qq });
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
      return;
    }

    if (text.startsWith("/退群")) {
      if (!isMaster) {
        ctx.logger.warn("[admin] 退群功能仅主人可用");
        return;
      }
      const targetGroup = parseInt(text.replace(/^\/退群\s*/, "").trim(), 10);
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
        await bot.api("set_group_leave", {
          group_id: targetGroup,
          is_dismiss: false,
        });
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
      return;
    }

    if (text.startsWith("/发好友")) {
      if (!isMaster) {
        ctx.logger.warn("[admin] 发好友功能仅主人可用");
        return;
      }
      const matched = text.match(/^\/发好友\s*(\d+)\s*([\s\S]*)$/);
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
        await bot.sendPrivateMsg(targetUser, payload);
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
      return;
    }

    if (text.startsWith("/发群聊")) {
      if (!isMaster) {
        ctx.logger.warn("[admin] 发群聊功能仅主人可用");
        return;
      }
      const matched = text.match(/^\/发群聊\s*(\d+)\s*([\s\S]*)$/);
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
        await bot.sendGroupMsg(targetGroup, payload);
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
      return;
    }

    if (text === "/全部好友") {
      if (!isMaster) {
        ctx.logger.warn("[admin] 全部好友功能仅主人可用");
        return;
      }
      if (isGroup) {
        await event.reply("在私聊使用试试看吧～", true);
        return;
      }
      try {
        const friendList: any[] = await bot.api("get_friend_list");
        if (!Array.isArray(friendList) || friendList.length === 0) {
          await replyAdminErrorNotice({
            ctx,
            event,
            instruction: "查询全部好友时列表为空，请简短告知当前没有好友数据。",
            fallbackMessage: "你现在还没有好友哦～",
          });
          return;
        }
        const nodes = friendList.map((friend: any) =>
          ctx.segment.node({
            user_id: String(friend.user_id),
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
        await sendForwardByEvent({
          bot,
          event,
          messages: toForwardMessages(bot, nodes),
        });
      } catch (err) {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction: "获取好友列表失败，请简要说明失败并建议稍后重试。",
          fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
          error: err,
        });
      }
      return;
    }

    if (text === "/全部群聊") {
      if (!isMaster) {
        ctx.logger.warn("[admin] 全部群聊功能仅主人可用");
        return;
      }
      if (isGroup) {
        await event.reply("在私聊使用试试看吧～", true);
        return;
      }
      try {
        const groupList: any[] = await bot.api("get_group_list");
        if (!Array.isArray(groupList) || groupList.length === 0) {
          await replyAdminErrorNotice({
            ctx,
            event,
            instruction: "查询全部群聊时列表为空，请简短告知当前没有群聊数据。",
            fallbackMessage: "你现在还没有群聊哦～",
          });
          return;
        }
        const nodes = groupList.map((group: any) =>
          ctx.segment.node({
            user_id: String(selfId),
            nickname: String(selfId),
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
        await sendForwardByEvent({
          bot,
          event,
          messages: toForwardMessages(bot, nodes),
        });
      } catch (err) {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction: "获取群聊列表失败，请简要说明失败并建议稍后重试。",
          fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
          error: err,
        });
      }
      return;
    }
  });
}
