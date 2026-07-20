import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { ENV } from "./_core/env";

const UPLOAD_DIR = path.join(process.cwd(), "server", "uploads");

function normalizeKey(relKey: string) {
  return relKey.replace(/^\/+/, "").replace(/\.\.+/g, ".");
}

function appendHashSuffix(relKey: string) {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

async function ensureUploadDir() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

function toBuffer(data: Buffer | Uint8Array | string) {
  if (typeof data === "string") return Buffer.from(data, "utf8");
  if (Buffer.isBuffer(data)) return data;
  return Buffer.from(data);
}

function buildPublicUrl(key: string) {
  if (ENV.publicStorageBaseUrl) {
    return `${ENV.publicStorageBaseUrl.replace(/\/$/, "")}/uploads/${key}`;
  }
  return `/uploads/${key}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  _contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  await ensureUploadDir();
  const key = appendHashSuffix(normalizeKey(relKey));
  const targetPath = path.join(UPLOAD_DIR, key);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, toBuffer(data));
  return { key, url: buildPublicUrl(key) };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: buildPublicUrl(key) };
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  const key = normalizeKey(relKey);
  return buildPublicUrl(key);
}
