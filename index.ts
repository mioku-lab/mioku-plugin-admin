import { definePlugin, type MiokiContext } from "mioki";
import type { ConfigService } from "../../src/services/config/tpyes";
import { setPluginRuntimeState, resetPluginRuntimeState } from "../../src";
import { DEFAULT_CONFIG, normalizeConfig } from "./config";
import type { AdminConfig } from "./config";
import { registerNotificationHandlers } from "./notify";
import { registerPersonalCommands } from "./commands/personal";
import { registerGroupAdminCommands } from "./commands/group";

interface RuntimeState {
  ctx?: MiokiContext;
  config?: AdminConfig;
}

export default definePlugin({
  name: "admin",
  version: "1.0.0",
  description: "管理插件，提供事件通知与管理指令",

  async setup(ctx: MiokiContext) {
    const configService = ctx.services?.config as ConfigService | undefined;

    let config: AdminConfig = { ...DEFAULT_CONFIG };

    if (configService) {
      await configService.registerConfig("admin", "base", DEFAULT_CONFIG);
      const raw = await configService.getConfig("admin", "base");
      config = normalizeConfig(raw);
      configService.onConfigChange("admin", "base", (next) => {
        config = normalizeConfig(next);
      });
    }

    setPluginRuntimeState<RuntimeState>("admin", { ctx });

    const getConfig = () => config;

    // 注册事件通知
    registerNotificationHandlers(ctx, getConfig);

    // 注册指令
    registerPersonalCommands(ctx);
    registerGroupAdminCommands(ctx);

    ctx.logger.info("管理插件加载成功");

    return () => {
      resetPluginRuntimeState("admin");
      ctx.logger.info("管理插件已卸载");
    };
  },
});
