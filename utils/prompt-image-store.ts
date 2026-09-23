import * as path from "path";
import * as crypto from "crypto";
import * as https from "https";
import * as http from "http";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  promises as fsp,
} from "fs";
import { getPluginDataDir } from "mioku";

const PROMPT_IMAGE_SUBDIR = "prompt-images";

const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp"];

export interface SavedPromptImage {
  filename: string;
  sourceUrl: string;
  size: number;
}

export function getGroupPromptImageDir(groupId: string): string {
  return path.join(
    getPluginDataDir("admin"),
    String(groupId),
    PROMPT_IMAGE_SUBDIR,
  );
}

export function ensureGroupPromptImageDir(groupId: string): string {
  const dir = getGroupPromptImageDir(groupId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function getGroupPromptImagePath(groupId: string, filename: string): string {
  return path.join(getGroupPromptImageDir(groupId), filename);
}

function inferExtension(source: string): string {
  try {
    const url = new URL(source);
    const ext = path.extname(url.pathname).toLowerCase();
    if (ALLOWED_EXTENSIONS.includes(ext)) return ext;
  } catch {
    const ext = path.extname(String(source || "")).toLowerCase();
    if (ALLOWED_EXTENSIONS.includes(ext)) return ext;
  }
  return ".jpg";
}

function generateFilename(ext: string): string {
  const stamp = Date.now().toString(36);
  const rand = crypto.randomBytes(4).toString("hex");
  return `prompt-${stamp}-${rand}${ext}`;
}

export async function saveRemoteImageAsPrompt(
  groupId: string,
  sourceUrl: string,
): Promise<SavedPromptImage | null> {
  const trimmed = String(sourceUrl || "").trim();
  if (!trimmed) return null;

  let downloadUrl = trimmed;
  if (/^file:\/\//i.test(trimmed)) {
    try {
      const filePath = decodeURIComponent(
        trimmed.replace(/^file:\/\//i, ""),
      );
      return await copyLocalFileAsPrompt(groupId, filePath);
    } catch (err) {
      return null;
    }
  }

  if (!/^https?:\/\//i.test(downloadUrl)) return null;

  const dir = ensureGroupPromptImageDir(groupId);
  const filename = generateFilename(inferExtension(downloadUrl));
  const savePath = path.join(dir, filename);

  try {
    const size = await downloadToFile(downloadUrl, savePath);
    if (size <= 0) {
      await fsp.unlink(savePath).catch(() => {});
      return null;
    }
    return { filename, sourceUrl: trimmed, size };
  } catch {
    await fsp.unlink(savePath).catch(() => {});
    return null;
  }
}

async function copyLocalFileAsPrompt(
  groupId: string,
  filePath: string,
): Promise<SavedPromptImage | null> {
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile() || stat.size <= 0) return null;
    const dir = ensureGroupPromptImageDir(groupId);
    const filename = generateFilename(inferExtension(filePath));
    const dest = path.join(dir, filename);
    await fsp.copyFile(filePath, dest);
    return { filename, sourceUrl: filePath, size: stat.size };
  } catch {
    return null;
  }
}

function downloadToFile(url: string, savePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (err) {
      reject(err);
      return;
    }
    const client = parsed.protocol === "https:" ? https : http;
    const req = client.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Referer: "https://q.qq.com/",
        },
      },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          const redirected = new URL(res.headers.location, url).toString();
          downloadToFile(redirected, savePath).then(resolve, reject);
          return;
        }
        if (!res.statusCode || res.statusCode >= 400) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const file = createWriteStream(savePath);
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
        });
        res.pipe(file);
        file.on("finish", () => {
          file.close(() => resolve(total));
        });
        file.on("error", (err) => {
          reject(err);
        });
      },
    );
    req.on("error", (err) => {
      reject(err);
    });
    req.setTimeout(20000, () => {
      req.destroy(new Error("download timeout"));
    });
  });
}

export async function deletePromptImage(
  groupId: string,
  filename: string,
): Promise<void> {
  if (!filename) return;
  const safe = path.basename(filename);
  if (!safe || safe !== filename) return;
  const target = getGroupPromptImagePath(groupId, safe);
  await fsp.unlink(target).catch(() => {});
}

export async function pruneGroupPromptImages(
  groupId: string,
  keep: readonly string[],
): Promise<void> {
  const dir = getGroupPromptImageDir(groupId);
  if (!existsSync(dir)) return;
  const keepSet = new Set(keep.map((name) => path.basename(name)));
  let entries: string[];
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter((name) => !keepSet.has(name))
      .map((name) => fsp.unlink(path.join(dir, name)).catch(() => {})),
  );
}