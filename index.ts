import { definePlugin, type MiokuContext } from "mioku";
import {
  setPluginRuntimeState,
  resetPluginRuntimeState,
  getService,
  Services,
} from "mioku";
import groupAdminSkill from "./skills/group";
import personalSkill from "./skills/personal";
import { DEFAULT_CONFIG, normalizeConfig, type AdminConfig } from "./config";
import {
  DEFAULT_VERIFY_CONFIG,
  normalizeVerifyConfig,
  type VerifyConfig,
} from "./verify/config";
import { registerNotificationHandlers } from "./notify";
import { registerPersonalCommands } from "./commands/personal";
import { registerGroupAdminCommands } from "./commands/group";
import { registerVerifyCommands } from "./commands/verify";
import { registerWelcomeHandler } from "./notify/welcome";
import { createVerifyController } from "./verify";

interface RuntimeState {
  ctx?: MiokuContext;
  config?: AdminConfig;
}

export default definePlugin({
  name: "admin",

  async setup(ctx: MiokuContext) {
    const configService = getService(ctx, Services.Config);
    const aiService = getService(ctx, Services.AI);

    let config: AdminConfig = { ...DEFAULT_CONFIG };
    let verifyConfig: VerifyConfig = { ...DEFAULT_VERIFY_CONFIG };

    if (configService) {
      await configService.registerConfig("admin", "base", DEFAULT_CONFIG);
      const raw = await configService.getConfig("admin", "base");
      config = normalizeConfig(raw);
      configService.onConfigChange("admin", "base", (next) => {
        config = normalizeConfig(next);
      });

      await configService.registerConfig(
        "admin",
        "verify",
        DEFAULT_VERIFY_CONFIG,
      );
      const verifyRaw = await configService.getConfig("admin", "verify");
      verifyConfig = normalizeVerifyConfig(verifyRaw);
      configService.onConfigChange("admin", "verify", (next) => {
        verifyConfig = normalizeVerifyConfig(next);
      });
    }

    setPluginRuntimeState("admin", { ctx });

    if (aiService) {
      aiService.registerSkill(groupAdminSkill);
      aiService.registerSkill(personalSkill);
    }

    const getConfig = () => config;
    const getVerifyConfig = () => verifyConfig;
    const getWelcomeEnabled = () => config.welcome.enabled;
    const setVerifyConfig = async (next: VerifyConfig) => {
      verifyConfig = next;
      if (configService) {
        await configService.updateConfig("admin", "verify", next);
      }
    };

    const verifyController = createVerifyController({
      ctx,
      aiService,
      getConfig,
      getVerifyConfig,
      getWelcomeEnabled,
      setVerifyConfig,
    });

    // 注册事件通知
    registerNotificationHandlers(ctx, getConfig);

    // 注册新人入群欢迎（开启验证的群由 verify 接管，验证通过后再欢迎）
    const disposeWelcome = registerWelcomeHandler(
      ctx,
      aiService,
      getConfig,
      (info, bot) => verifyController.handleMemberJoin(info, bot),
      (info, bot) => verifyController.trySendCustomWelcome(info, bot),
    );

    // 注册入群验证指令
    registerVerifyCommands({
      ctx,
      getVerifyConfig,
      setVerifyConfig,
      verifyController,
    });

    // 注册指令
    registerPersonalCommands(ctx);
    registerGroupAdminCommands(ctx);

    ctx.logger.info("管理插件加载成功");

    return () => {
      disposeWelcome();
      verifyController.dispose();
      if (aiService) {
        aiService.removeSkill("admin_group");
        aiService.removeSkill("admin_personal");
      }
      resetPluginRuntimeState("admin");
      ctx.logger.info("管理插件已卸载");
    };
  },
});
