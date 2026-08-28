import type { Bot, MessageEvent, MiokuContext, MessageSegment } from "mioku";
import { createGroupRef, friendDelete, friendGetList, groupGetList } from "mioku";
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

function toForwardMessages(bot: Bot, nodes: readonly unknown[]): unknown[] {
  const normalizeElements = (elements: readonly unknown[]): unknown[] => {
    const asRecord = (element: unknown): unknown => {
      if (!element || typeof element !== "object") return element
      if ("type" in element && "data" in element) return element
      if ("type" in element) {
        const { type, ...data } = element as { type: string } & Record<string, unknown>
        return { type, data }
      }
      return element
    }
    const sendable = (bot as unknown as { normalizeSendable?: (v: unknown[]) => unknown[] }).normalizeSendable
    if (typeof sendable === "function") return sendable(elements as unknown[])
    return elements.map(asRecord)
  };

  return nodes.map((node) => {
    const rawNode =
      node && typeof node === "object" && "type" in node && "data" in node
        ? { type: (node as { type: string }).type, ...(node as { data: Record<string, unknown> }).data }
        : node;
    if (!rawNode || typeof rawNode !== "object" || (rawNode as { type?: unknown }).type !== "node") {
      return normalizeElements([rawNode])[0];
    }

    const nodeObj = rawNode as { type: string; user_id?: string; nickname?: string; id?: string; content?: unknown };
    const content = Array.isArray(nodeObj.content) ? nodeObj.content : [];
    if (nodeObj.id) {
      return {
        type: "node",
        data: {
          user_id: nodeObj.user_id,
          nickname: nodeObj.nickname,
          id: nodeObj.id,
        },
      };
    }

    return {
      type: "node",
      data: {
        user_id: nodeObj.user_id,
        nickname: nodeObj.nickname,
        content: normalizeElements(content),
      },
    };
  });
}

async function sendForwardByEvent(options: {
  bot: Bot;
  event: MessageEvent;
  messages: readonly unknown[];
}): Promise<void> {
  const { bot, event, messages } = options;
  const chunkSize = 50;

  for (let i = 0; i < messages.length; i += chunkSize) {
    const chunk = messages.slice(i, i + chunkSize);
    if (event.message_type === "group" && event.group_id) {
      await bot.sendApi("send_group_forward_msg", {
        group_id: String(event.group_id),
        messages: chunk,
      });
      continue;
    }

    await bot.sendApi("send_private_forward_msg", {
      user_id: String(event.user_id),
      messages: chunk,
    });
  }
}

export function registerPersonalCommands(ctx: MiokuContext) {
  ctx.handle("message", async (event) => {
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
        await event.reply("图片呢图片呢～", true);
      return;
      }
      try {
        await bot.sendApi("set_qq_avatar", { file: imageUrl });
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
        await event.reply("想改成什么昵称呀～", true);
      return;
      }
      try {
        await bot.sendApi("set_qq_profile", { nickname });
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
        await event.reply("想改成什么签名呀～", true);
      return;
      }
      try {
        await bot.sendApi("set_qq_profile", { personal_note: personalNote });
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
        await bot.sendApi("set_qq_profile", { sex });
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
        await bot.invoke(friendDelete, { user_id: String(qq) });
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
        await bot.sendMessage({ type: "private", user_id: String(targetUser) }, payload);
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
        await bot.sendMessage({ type: "group", group_id: String(targetGroup) }, payload);
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
        const friendList = await bot.invoke(friendGetList, {});
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
        const groupList = await bot.invoke(groupGetList, {});
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
      return;
    }
  });
}
