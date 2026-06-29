import { getPluginRuntimeState } from "mioku";
import type { PendingVerify } from "./types";

const RUNTIME_KEY = "verifyPending";

export function getPendingMap(): Map<string, PendingVerify> {
  const state = getPluginRuntimeState("admin");
  if (!state[RUNTIME_KEY]) {
    state[RUNTIME_KEY] = new Map<string, PendingVerify>();
  }
  return state[RUNTIME_KEY] as Map<string, PendingVerify>;
}

export function pendingKey(
  selfId: number,
  groupId: number,
  userId: number,
): string {
  return `${selfId}:${groupId}:${userId}`;
}

export function clearTimers(p: PendingVerify) {
  if (p.timeoutTimer) {
    clearTimeout(p.timeoutTimer);
    p.timeoutTimer = null;
  }
  if (p.delayTimer) {
    clearTimeout(p.delayTimer);
    p.delayTimer = null;
  }
}
