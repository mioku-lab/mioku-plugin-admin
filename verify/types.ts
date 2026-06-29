import type { MiokiContext } from "mioki";
import type { AIService } from "mioku";
import type { AdminConfig } from "../config";
import type { VerifyConfig, VerifyMode } from "./config";

export interface VerifyControllerOptions {
  ctx: MiokiContext;
  aiService?: AIService;
  getConfig: () => AdminConfig;
  getVerifyConfig: () => VerifyConfig;
  getWelcomeEnabled: () => boolean;
  setVerifyConfig: (next: VerifyConfig) => Promise<void>;
}

export interface MemberJoinInfo {
  selfId: number;
  groupId: number;
  userId: number;
  groupName: string;
}

export interface PendingVerify {
  selfId: number;
  groupId: number;
  userId: number;
  memberName: string;
  groupName: string;
  mode: VerifyMode;
  promptMessageId?: number;
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
  handleMemberJoin(info: MemberJoinInfo): Promise<boolean>;
  restartVerification(info: MemberJoinInfo): Promise<boolean>;
  bypassVerification(info: MemberJoinInfo): Promise<void>;
  dispose(): void;
}
