import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { objectStorageConfig, objectStorageMode } from "./objectStorageConfig";

const UPLOAD_DIR = path.join(process.cwd(), "server", "uploads");
function normalizeKey(relKey: string) { return relKey.replace(/^\/+/, "").replace(/\.\.+/g, "."); }
function appendHashSuffix(relKey: string) { const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8); const lastDot = relKey.lastIndexOf("."); return lastDot === -1 ? `${relKey}_${hash}` : `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`; }
function toBuffer(data: Buffer | Uint8Array | string) { return typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data); }
async function ensureUploadDir() { await fs.mkdir(UPLOAD_DIR, { recursive: true }); }
function s3() { const config = objectStorageConfig(); if (!config) throw new Error("Object storage is required but incomplete. Configure OBJECT_STORAGE_ENDPOINT, bucket, access key, secret, and public base URL."); return { config, client: new S3Client({ endpoint: config.endpoint, region: config.region, forcePathStyle: true, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }) }; }
function localUrl(key: string) { return `/uploads/${key}`; }
export async function storagePut(relKey: string, data: Buffer | Uint8Array | string, contentType = "application/octet-stream"): Promise<{ key: string; url: string }> { const key = appendHashSuffix(normalizeKey(relKey)); if (objectStorageMode() === "s3") { const { client, config } = s3(); await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: toBuffer(data), ContentType: contentType, ServerSideEncryption: "AES256" })); return { key, url: `${config.publicBaseUrl}/${key}` }; } await ensureUploadDir(); const targetPath = path.join(UPLOAD_DIR, key); await fs.mkdir(path.dirname(targetPath), { recursive: true }); await fs.writeFile(targetPath, toBuffer(data)); return { key, url: localUrl(key) }; }
export async function storageGet(relKey: string): Promise<{ key: string; url: string }> { const key = normalizeKey(relKey); if (objectStorageMode() === "s3") { const { config } = s3(); return { key, url: `${config.publicBaseUrl}/${key}` }; } return { key, url: localUrl(key) }; }
export async function storageGetSignedUrl(relKey: string): Promise<string> { const key = normalizeKey(relKey); if (objectStorageMode() === "s3") { const { client, config } = s3(); return getSignedUrl(client, new GetObjectCommand({ Bucket: config.bucket, Key: key }), { expiresIn: 300 }); } return localUrl(key); }
