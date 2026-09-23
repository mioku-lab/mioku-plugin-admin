import type {
  Bot,
  CommandDefinition,
  CommandExecutionContext,
  MessageEvent,
  MiokuContext,
} from "mioku";
import { extractImageUrls, getAtUserId, getMemberRole } from "../config";
import {
  getGroupVerifyConfig,
  hasCustomPrompt,
  MAX_CUSTOM_PROMPT_LENGTH,
  normalizeCustomPrompt,
  normalizeVerifyMode,
  upsertGroupVerifyConfig,
  type VerifyConfig,
} from "../verify/config";
import { replyAdminErrorNotice } from "./notice";
import type { VerifyController } from "../verify/types";
import {
  pruneGroupPromptImages,
  saveRemoteImageAsPrompt,
} from "../utils/prompt-image-store";

export interface VerifyCommandOptions {
  ctx: MiokuContext;
  getVerifyConfig: () => VerifyConfig;
  setVerifyConfig: (next: VerifyConfig) => Promise<void>;
  verifyController: VerifyController;
}

const VERIFY_MODE_LABELS: Record<string, string> = {
  reaction: "回应",
  number: "数字",
  chiral: "手性碳",
};

type VerifyContext = CommandExecutionContext & {
  bot: Bot;
  groupIdNum: string;
  groupName: string;
  selfId: string;
};

async function extractQuoteImageUrls(event: MessageEvent): Promise<string[]> {
  const eventAny = event as MessageEvent & {
    getQuoteMsg?: () => Promise<{ message?: unknown[] } | null>;
  };
  if (typeof eventAny.getQuoteMsg !== "function") return [];
  const quoteMsg = await eventAny.getQuoteMsg().catch(() => null);
  if (!quoteMsg || !Array.isArray(quoteMsg.message)) return [];
  return extractImageUrls(quoteMsg.message as Parameters<typeof extractImageUrls>[0]);
}

export function registerVerifyCommands(options: VerifyCommandOptions) {
  const { ctx, getVerifyConfig, setVerifyConfig, verifyController } = options;

  const register = (
    def: Omit<CommandDefinition, "handler">,
    run: (c: VerifyContext) => Promise<void>,
  ) => {
    ctx.command({
      ...def,
      handler: async (c) => {
        const event = c.event;
        if (event.user_id === event.self_id) return;
        if (event.message_type !== "group") return;
        const bot = event.bot;
        if (!bot) return;
        const groupIdNum = String(event.group_id ?? "").trim();
        if (!groupIdNum) return;
        try {
          await run({
            ...c,
            bot,
            groupIdNum,
            groupName: String(event?.group?.group_name || "").trim() || groupIdNum,
            selfId: String(event.self_id ?? "").trim(),
          });
        } catch (err) {
          ctx.logger.error(`[admin verify] 未捕获异常: ${String(err)}`);
          await replyAdminErrorNotice({
            ctx,
            event,
            instruction: `入群验证指令执行时发生未捕获异常：${String(err)}，请简要说明失败并建议稍后重试。`,
            fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
            error: err,
          });
        }
      },
    });
  };

  register(
    {
      name: "开启验证",
      match: /^[/#]开启验证$/,
      permission: "admin",
      description: "开启本群入群验证",
    },
    async (c) => {
      const { ctx, event, bot, groupIdNum, selfId } = c;
      const botRole = await getMemberRole(bot, groupIdNum, selfId);
      if (botRole !== "owner" && botRole !== "admin") {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction:
            "用户想开启入群验证，但Bot在群内不是群主或管理员，无法执行撤回/踢人等验证操作。请告诉用户需要先把Bot设为群主或管理员。",
          fallbackMessage: "我得是群主或管理员才能开验证哦～",
        });
        return;
      }
      const current = getVerifyConfig();
      const groupCfg = getGroupVerifyConfig(current, groupIdNum);
      if (groupCfg.enabled) {
        await event.reply("本群已经开启验证啦～", true);
        return;
      }
      const next = upsertGroupVerifyConfig(current, groupIdNum, {
        enabled: true,
      });
      await setVerifyConfig(next);
      await event.reply("已开启入群验证～", true);
    },
  );

  register(
    {
      name: "关闭验证",
      match: /^[/#]关闭验证$/,
      permission: "admin",
      description: "关闭本群入群验证",
    },
    async (c) => {
      const { event, groupIdNum } = c;
      const current = getVerifyConfig();
      const groupCfg = getGroupVerifyConfig(current, groupIdNum);
      if (!groupCfg.enabled) {
        await event.reply("本群还没开启验证哦～", true);
        return;
      }
      const next = upsertGroupVerifyConfig(current, groupIdNum, {
        enabled: false,
      });
      await setVerifyConfig(next);
      await event.reply("已关闭入群验证～", true);
    },
  );

  register(
    {
      name: "切换验证模式",
      match: /^[/#]切换验证模式(?:\s|$)/,
      permission: "admin",
      description: "切换验证模式：回应/数字/手性碳",
      usage: ".切换验证模式 回应",
    },
    async (c) => {
      const { ctx, event, groupIdNum, body } = c;
      const arg = body.replace(/^[/#]切换验证模式\s*/, "").trim();
      const mode = normalizeVerifyMode(arg);
      if (!arg) {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction:
            "用户想切换验证模式但没指定模式。请告诉用户可用模式：回应、数字、手性碳，用法：/切换验证模式 回应。",
          fallbackMessage: "想切换成哪种模式呀～回应/数字/手性碳",
        });
        return;
      }
      const current = getVerifyConfig();
      const next = upsertGroupVerifyConfig(current, groupIdNum, { mode });
      await setVerifyConfig(next);
      await event.reply(
        `验证模式已切换为：${VERIFY_MODE_LABELS[mode]}～`,
        true,
      );
    },
  );

  register(
    {
      name: "绕过验证",
      match: /^[/#]绕过验证(?:\s|$)/,
      permission: "admin",
      description: "绕过指定新成员的验证直接欢迎",
      usage: ".绕过验证 @新成员",
    },
    async (c) => {
      const { ctx, event, groupIdNum, groupName, selfId } = c;
      const atUser = getAtUserId(event.message);
      if (!atUser) {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction:
            "用户想绕过某位新成员的验证，但没有@目标成员。请提醒用户在命令后@要绕过验证的新成员。",
          fallbackMessage: "要绕过谁呀～先@一下～",
        });
        return;
      }
      try {
        await verifyController.bypassVerification({
          selfId,
          groupId: groupIdNum,
          userId: atUser,
          groupName,
        });
        await event.reply("done");
      } catch (err) {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction: `绕过验证执行失败：${String(err)}，请简要说明失败并建议稍后重试。`,
          fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
          error: err,
        });
      }
    },
  );

  register(
    {
      name: "重新验证",
      match: /^[/#]重新验证(?:\s|$)/,
      permission: "admin",
      description: "让指定成员重新进行入群验证",
      usage: ".重新验证 @成员",
    },
    async (c) => {
      const { ctx, event, bot, groupIdNum, groupName, selfId } = c;
      const atUser = getAtUserId(event.message);
      if (!atUser) {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction:
            "用户想让某人重新进行入群验证，但没有@目标成员。请提醒用户在命令后@要重新验证的成员。",
          fallbackMessage: "要重新验证谁呀～先@一下～",
        });
        return;
      }
      const isTargetMaster = ctx.isMaster?.(atUser) ?? false;
      const targetRole = await getMemberRole(bot, groupIdNum, atUser);
      if (isTargetMaster || targetRole === "owner" || targetRole === "admin") {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction:
            "用户想让一位群主/管理员/主人重新验证，但这些成员无需验证。请告诉用户该成员是管理/群主或主人，不能对其重新验证。",
          fallbackMessage: "管理/群主或主人可不用验证哦～",
        });
        return;
      }
      try {
        const started = await verifyController.restartVerification(
          {
            selfId,
            groupId: groupIdNum,
            userId: atUser,
            groupName,
          },
          bot,
        );
        if (!started) {
          await event.reply("本群还没开启验证哦～", true);
        }
      } catch (err) {
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction: `重新验证执行失败：${String(err)}，请简要说明失败并建议稍后重试。`,
          fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
          error: err,
        });
      }
    },
  );

  register(
    {
      name: "入群提示",
      match: /^[/#]入群提示(?:\s|$)/,
      permission: "admin",
      description: "设置本群自定义入群提示，可附带文字+图片",
      usage: ".入群提示 xxx；/入群提示 关闭",
    },
    async (c) => {
      const { ctx, event, groupIdNum, body } = c;
      const rawArg = body.replace(/^[/#]入群提示\s*/, "").trim();
      const current = getVerifyConfig();
      const groupCfg = getGroupVerifyConfig(current, groupIdNum);
      const directImageUrls = extractImageUrls(event.message);
      const quoteImageUrls = await extractQuoteImageUrls(event).catch(() => []);
      const imageUrls =
        directImageUrls.length > 0 ? directImageUrls : quoteImageUrls;

      if (rawArg === "关闭" || rawArg === "清空" || rawArg === "关") {
        if (!hasCustomPrompt(groupCfg)) {
          await event.reply("本群还没设置自定义入群提示哦～", true);
          return;
        }
        const removedFile = groupCfg.promptImage;
        const next = upsertGroupVerifyConfig(current, groupIdNum, {
          customPrompt: "",
          promptImage: "",
        });
        await setVerifyConfig(next);
        await pruneGroupPromptImages(groupIdNum, []).catch(() => {});
        ctx.logger.info(
          `admin verify 关闭群 ${groupIdNum} 自定义入群提示，清理图片 ${removedFile}`,
        );
        await event.reply("已关闭本群自定义入群提示～", true);
        return;
      }

      if (!rawArg && !imageUrls.length) {
        if (!hasCustomPrompt(groupCfg)) {
          await event.reply(
            "用法：/入群提示 xxx（最多 50 字），可附带图片（当前消息或引用消息中的图片）一起发送；/入群提示 关闭 关闭自定义提示～",
            true,
          );
          return;
        }
        const lines = ["已开启本群自定义入群提示"];
        lines.push(
          groupCfg.customPrompt
            ? `文字：${groupCfg.customPrompt}`
            : "文字：（未设置）",
        );
        lines.push(
          groupCfg.promptImage
            ? `图片：已设置（filename=${groupCfg.promptImage}）`
            : "图片：（未设置）",
        );
        await event.reply(lines.join("\n"), true);
        return;
      }

      if (rawArg) {
        const argLength = Array.from(rawArg).length;
        if (argLength > MAX_CUSTOM_PROMPT_LENGTH) {
          await replyAdminErrorNotice({
            ctx,
            event,
            instruction: `用户想设置本群入群提示，但内容长度 ${argLength} 超过了上限 ${MAX_CUSTOM_PROMPT_LENGTH} 字，请明确告诉用户最多 ${MAX_CUSTOM_PROMPT_LENGTH} 字。`,
            fallbackMessage: `最多 ${MAX_CUSTOM_PROMPT_LENGTH} 字哦～当前 ${argLength} 字`,
          });
          return;
        }
      }
      const nextPrompt = rawArg
        ? normalizeCustomPrompt(rawArg)
        : groupCfg.customPrompt;

      let nextImage = groupCfg.promptImage;
      let imageNote = "";
      if (imageUrls.length) {
        const targetUrl = imageUrls[0];
        const savedImage = await saveRemoteImageAsPrompt(groupIdNum, targetUrl);
        if (savedImage) {
          const previousImage = groupCfg.promptImage;
          nextImage = savedImage.filename;
          imageNote = previousImage
            ? `图片已替换（旧文件 ${previousImage} 已删除）`
            : `图片已设置（${savedImage.filename}）`;
          if (previousImage) {
            ctx.logger.info(
              `admin verify 替换群 ${groupIdNum} 入群提示图片：${previousImage} -> ${savedImage.filename}`,
            );
          }
        } else {
          imageNote = "图片下载失败，请稍后重试";
        }
      }

      const next = upsertGroupVerifyConfig(current, groupIdNum, {
        customPrompt: nextPrompt,
        promptImage: nextImage,
      });
      await setVerifyConfig(next);
      await pruneGroupPromptImages(groupIdNum, nextImage ? [nextImage] : []).catch(
        () => {},
      );

      const lines = ["已更新本群自定义入群提示"];
      if (rawArg) lines.push(`文字：${nextPrompt}`);
      else if (groupCfg.customPrompt)
        lines.push(`文字（保持）：${groupCfg.customPrompt}`);
      if (imageUrls.length && imageNote) lines.push(imageNote);
      await event.reply(lines.join("\n"), true);
    },
  );
}
