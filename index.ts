import { definePlugin, type MiokiContext } from "mioki";
import type { AIService, ConfigService } from "mioku";
import { setPluginRuntimeState, resetPluginRuntimeState } from "mioku";
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
  ctx?: MiokiContext;
  config?: AdminConfig;
}

export default definePlugin({
  name: "admin",
  version: "1.0.0",
  description: "管理插件，提供事件通知与群管/个人管理指令",

  async setup(ctx: MiokiContext) {
    const configService = ctx.services?.config as ConfigService | undefined;
    const aiService = ctx.services?.ai as AIService | undefined;

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
      (info) => verifyController.handleMemberJoin(info),
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
      resetPluginRuntimeState("admin");
      ctx.logger.info("管理插件已卸载");
    };
  },
});
