import type { MiokuContext } from "mioku";
import type { AIService } from "mioku";
import type { AdminConfig } from "../config";
import type { VerifyConfig, VerifyMode } from "./config";

export interface VerifyControllerOptions {
  ctx: MiokuContext;
  aiService?: AIService;
  getConfig: () => AdminConfig;
  getVerifyConfig: () => VerifyConfig;
  getWelcomeEnabled: () => boolean;
  setVerifyConfig: (next: VerifyConfig) => Promise<void>;
}

export interface MemberJoinInfo {
  selfId: string | number;
  groupId: number;
  userId: number;
  groupName: string;
}

export interface PendingVerify {
  selfId: string | number;
  groupId: number;
  userId: number;
  memberName: string;
  groupName: string;
  mode: VerifyMode;
  bot?: import("mioku").Bot;
  promptMessageId?: string | number;
  reactionEmojiId?: string;
  numberAnswer?: number;
  requiredRegions?: string[];
  matchedRegions?: Set<string>;
  invalidCount: number;
  startedAt: number;
  passed: boolean;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
  delayTimer: ReturnType<typeof setTimeout> | null;
}

export interface VerifyController {
  handleMemberJoin(
    info: MemberJoinInfo,
    bot?: import("mioku").Bot,
  ): Promise<boolean>;
  restartVerification(
    info: MemberJoinInfo,
    bot?: import("mioku").Bot,
  ): Promise<boolean>;
  bypassVerification(info: MemberJoinInfo): Promise<void>;
  trySendCustomWelcome(
    info: MemberJoinInfo,
    bot?: import("mioku").Bot,
  ): Promise<boolean>;
  dispose(): void;
}
