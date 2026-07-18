import type { MiokiContext } from "mioki";
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
  ctx: MiokiContext;
  getVerifyConfig: () => VerifyConfig;
  setVerifyConfig: (next: VerifyConfig) => Promise<void>;
  verifyController: VerifyController;
}

const VERIFY_MODE_LABELS: Record<string, string> = {
  reaction: "回应",
  number: "数字",
  chiral: "手性碳",
};

async function extractQuoteImageUrls(event: any): Promise<string[]> {
  if (!event || typeof event.getQuoteMsg !== "function") return [];
  const quoteMsg = await event.getQuoteMsg().catch(() => null);
  if (!quoteMsg || !Array.isArray(quoteMsg.message)) return [];
  return extractImageUrls(quoteMsg.message);
}

export function registerVerifyCommands(options: VerifyCommandOptions) {
  const { ctx, getVerifyConfig, setVerifyConfig, verifyController } = options;

  ctx.handle("message", async (event: any) => {
    const text = ctx.text(event)?.trim();
    if (!text) return;
    if (event.user_id === event.self_id) return;

    if (event.message_type !== "group") return;
    const groupId = Number(event.group_id || 0);
    if (!groupId) return;

    const isVerifyCommand =
      text === "/开启验证" ||
      text === "#开启验证" ||
      text === "/关闭验证" ||
      text === "#关闭验证" ||
      text.startsWith("/切换验证模式") ||
      text.startsWith("#切换验证模式") ||
      text.startsWith("/绕过验证") ||
      text.startsWith("#绕过验证") ||
      text.startsWith("/重新验证") ||
      text.startsWith("#重新验证") ||
      text.startsWith("/入群提示") ||
      text.startsWith("#入群提示");

    try {
      const selfId = event.self_id;
      const bot = ctx.pickBot(selfId);
      if (!bot) return;

      const isMaster = ctx.isOwner?.(event) ?? false;
      const senderRole = await getMemberRole(bot, groupId, event.user_id);
      const hasAdminPermission =
        isMaster || senderRole === "owner" || senderRole === "admin";

      const ensureAdminPermission = async (instruction?: string) => {
        if (hasAdminPermission) return true;
        await replyAdminErrorNotice({
          ctx,
          event,
          instruction:
            instruction ||
            "用户想使用入群验证相关指令，但不是群主或管理员，无权限。请告诉用户需要管理权限。",
          fallbackMessage: "你得是群主或管理员才行哦～",
        });
        return false;
      };

      const groupName =
        String(event?.group?.group_name || "").trim() || String(groupId);

      // /开启验证 | #开启验证
      if (text === "/开启验证" || text === "#开启验证") {
        if (!(await ensureAdminPermission())) return;

        const botRole = await getMemberRole(bot, groupId, selfId);
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
        const groupCfg = getGroupVerifyConfig(current, groupId);
        if (groupCfg.enabled) {
          await event.reply("本群已经开启验证啦～", true);
          return;
        }
        const next = upsertGroupVerifyConfig(current, groupId, {
          enabled: true,
        });
        await setVerifyConfig(next);
        await event.reply("已开启入群验证～", true);
        return;
      }

      // /关闭验证 | #关闭验证
      if (text === "/关闭验证" || text === "#关闭验证") {
        if (!(await ensureAdminPermission())) return;

        const current = getVerifyConfig();
        const groupCfg = getGroupVerifyConfig(current, groupId);
        if (!groupCfg.enabled) {
          await event.reply("本群还没开启验证哦～", true);
          return;
        }
        const next = upsertGroupVerifyConfig(current, groupId, {
          enabled: false,
        });
        await setVerifyConfig(next);
        await event.reply("已关闭入群验证～", true);
        return;
      }

      // /切换验证模式 回应|数字|手性碳
      if (
        text.startsWith("/切换验证模式") ||
        text.startsWith("#切换验证模式")
      ) {
        if (!(await ensureAdminPermission())) return;

        const arg = text
          .replace(/^[/#]切换验证模式\s*/, "")
          .trim() as string;
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
        const next = upsertGroupVerifyConfig(current, groupId, { mode });
        await setVerifyConfig(next);
        await event.reply(
          `验证模式已切换为：${VERIFY_MODE_LABELS[mode]}～`,
          true,
        );
        return;
      }

      // /绕过验证 @新成员
      if (text.startsWith("/绕过验证") || text.startsWith("#绕过验证")) {
        if (!(await ensureAdminPermission())) return;

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
            groupId,
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
        return;
      }

      // /重新验证 @某人
      if (text.startsWith("/重新验证") || text.startsWith("#重新验证")) {
        if (!(await ensureAdminPermission())) return;

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

        const isTargetMaster = ctx.isOwner?.(atUser) ?? false;
        const targetRole = await getMemberRole(bot, groupId, atUser);
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
          const started = await verifyController.restartVerification({
            selfId,
            groupId,
            userId: atUser,
            groupName,
          });
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
        return;
      }

      // /入群提示 xxx
      // /入群提示 关闭
      // /入群提示（带图片，可来自当前消息或引用消息）— 仅图片也可
      if (text.startsWith("/入群提示") || text.startsWith("#入群提示")) {
        if (!(await ensureAdminPermission())) return;

        const rawArg = text.replace(/^[/#]入群提示\s*/, "").trim();
        const current = getVerifyConfig();
        const groupCfg = getGroupVerifyConfig(current, groupId);
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
          const next = upsertGroupVerifyConfig(current, groupId, {
            customPrompt: "",
            promptImage: "",
          });
          await setVerifyConfig(next);
          await pruneGroupPromptImages(groupId, []).catch(() => {});
          ctx.logger.info(
            `admin verify 关闭群 ${groupId} 自定义入群提示，清理图片 ${removedFile}`,
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
          const savedImage = await saveRemoteImageAsPrompt(groupId, targetUrl);
          if (savedImage) {
            const previousImage = groupCfg.promptImage;
            nextImage = savedImage.filename;
            imageNote = previousImage
              ? `图片已替换（旧文件 ${previousImage} 已删除）`
              : `图片已设置（${savedImage.filename}）`;
            if (previousImage) {
              ctx.logger.info(
                `admin verify 替换群 ${groupId} 入群提示图片：${previousImage} -> ${savedImage.filename}`,
              );
            }
          } else {
            imageNote = "图片下载失败，请稍后重试";
          }
        }

        const next = upsertGroupVerifyConfig(current, groupId, {
          customPrompt: nextPrompt,
          promptImage: nextImage,
        });
        await setVerifyConfig(next);
        await pruneGroupPromptImages(groupId, nextImage ? [nextImage] : []).catch(
          () => {},
        );

        const lines = ["已更新本群自定义入群提示"];
        if (rawArg) lines.push(`文字：${nextPrompt}`);
        else if (groupCfg.customPrompt)
          lines.push(`文字（保持）：${groupCfg.customPrompt}`);
        if (imageUrls.length && imageNote) lines.push(imageNote);
        await event.reply(lines.join("\n"), true);
        return;
      }
    } catch (err) {
      ctx.logger.error(`[admin verify] 未捕获异常: ${String(err)}`);
      if (!isVerifyCommand) return;
      await replyAdminErrorNotice({
        ctx,
        event,
        instruction: `入群验证指令执行时发生未捕获异常：${String(err)}，请简要说明失败并建议稍后重试。`,
        fallbackMessage: `出错了，笨蛋～ ${String(err)}`,
        error: err,
      });
    }
  });
}
