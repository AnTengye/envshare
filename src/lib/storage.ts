import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Redis } from "@upstash/redis";
import { getRuntimeConfig } from "./config";

export interface StoredSecretMeta {
  id: string;
  createdAt: number;
  expiresAt: number;
  /** 0 means unlimited reads; > 0 means remaining reads */
  remainingReads: number;
  maxReads: number;
  sizeBytes: number;
}

export interface LoadSecretResult {
  meta: StoredSecretMeta;
  encryptedBytes: Uint8Array;
}

const ID_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function generateShortId(length = 10): string {
  const randomBytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ID_ALPHABET[randomBytes[i] % ID_ALPHABET.length];
  }
  return out;
}

function getDataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

function getMetaPath(id: string): string {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(getDataDir(), "meta", `${safeId}.json`);
}

function getBlobPath(id: string): string {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(getDataDir(), "blobs", `${safeId}.bin`);
}

// In-memory mutex for atomic read-decrement on local filesystem
const idLocks = new Map<string, Promise<unknown>>();

async function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = idLocks.get(id) || Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  idLocks.set(id, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (idLocks.get(id) === next) {
      idLocks.delete(id);
    }
  }
}

// Fallback ephemeral in-memory store when running in Vercel mode without Upstash configured yet
const memoryStore = new Map<
  string,
  { meta: StoredSecretMeta; data: Uint8Array }
>();

let lastCleanupTime = 0;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // Every 5 minutes

async function maybeCleanupExpiredLocalFiles(): Promise<void> {
  const now = Date.now();
  if (now - lastCleanupTime < CLEANUP_INTERVAL_MS) return;
  lastCleanupTime = now;

  try {
    const metaDir = path.join(getDataDir(), "meta");
    const files = await fs.readdir(metaDir).catch(() => [] as string[]);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const fullPath = path.join(metaDir, file);
      try {
        const raw = await fs.readFile(fullPath, "utf-8");
        const meta = JSON.parse(raw) as StoredSecretMeta;
        if (
          now >= meta.expiresAt ||
          (meta.maxReads > 0 && meta.remainingReads <= 0)
        ) {
          await fs.unlink(fullPath).catch(() => {});
          await fs.unlink(getBlobPath(meta.id)).catch(() => {});
        }
      } catch {
        // Ignore individual file errors during background sweep
      }
    }
  } catch {
    // Ignore directory read errors
  }
}

function getUpstashClient(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export async function storeSecret(
  encryptedBytes: Uint8Array,
  options: { ttlSeconds: number; reads: number }
): Promise<StoredSecretMeta> {
  const config = getRuntimeConfig();
  const id = generateShortId(10);
  const now = Date.now();
  const ttlSeconds = Math.max(60, Math.min(options.ttlSeconds, 30 * 86400));
  const maxReads = Math.max(0, options.reads);

  const meta: StoredSecretMeta = {
    id,
    createdAt: now,
    expiresAt: now + ttlSeconds * 1000,
    remainingReads: maxReads,
    maxReads,
    sizeBytes: encryptedBytes.byteLength,
  };

  if (config.storageBackend === "upstash") {
    const redis = getUpstashClient();
    if (!redis) {
      throw new Error(
        "当前处于 Vercel 模式，但未配置 UPSTASH_REDIS_REST_URL 与 UPSTASH_REDIS_REST_TOKEN 环境变量"
      );
    }
    const payloadB64 = Buffer.from(encryptedBytes).toString("base64");
    const key = `envshare:${id}`;
    await redis.hset(key, {
      meta: JSON.stringify(meta),
      data: payloadB64,
      remainingReads: maxReads,
    });
    await redis.expire(key, ttlSeconds);
    return meta;
  }

  if (config.storageBackend === "memory-ephemeral") {
    memoryStore.set(id, { meta, data: new Uint8Array(encryptedBytes) });
    return meta;
  }

  // Self-hosted local-fs storage
  const dataDir = getDataDir();
  await fs.mkdir(path.join(dataDir, "meta"), { recursive: true });
  await fs.mkdir(path.join(dataDir, "blobs"), { recursive: true });

  await fs.writeFile(getBlobPath(id), encryptedBytes);
  await fs.writeFile(getMetaPath(id), JSON.stringify(meta), "utf-8");

  // Trigger non-blocking cleanup of old expired files
  void maybeCleanupExpiredLocalFiles();

  return meta;
}

/**
 * Peek metadata without consuming a read count (safe for pre-check / UI prompt).
 */
export async function peekSecretMeta(
  id: string
): Promise<StoredSecretMeta | null> {
  const config = getRuntimeConfig();
  const now = Date.now();

  if (config.storageBackend === "upstash") {
    const redis = getUpstashClient();
    if (!redis) return null;
    const key = `envshare:${id}`;
    const [metaRaw, remainingRaw] = await Promise.all([
      redis.hget<string | StoredSecretMeta>(key, "meta"),
      redis.hget<number>(key, "remainingReads"),
    ]);
    if (!metaRaw) return null;
    const meta: StoredSecretMeta =
      typeof metaRaw === "string" ? JSON.parse(metaRaw) : metaRaw;
    const remainingReads =
      typeof remainingRaw === "number" ? remainingRaw : meta.remainingReads;
    if (now >= meta.expiresAt || (meta.maxReads > 0 && remainingReads <= 0)) {
      await redis.del(key);
      return null;
    }
    return { ...meta, remainingReads };
  }

  if (config.storageBackend === "memory-ephemeral") {
    const entry = memoryStore.get(id);
    if (!entry) return null;
    if (
      now >= entry.meta.expiresAt ||
      (entry.meta.maxReads > 0 && entry.meta.remainingReads <= 0)
    ) {
      memoryStore.delete(id);
      return null;
    }
    return { ...entry.meta };
  }

  try {
    const raw = await fs.readFile(getMetaPath(id), "utf-8");
    const meta = JSON.parse(raw) as StoredSecretMeta;
    if (
      now >= meta.expiresAt ||
      (meta.maxReads > 0 && meta.remainingReads <= 0)
    ) {
      await fs.unlink(getMetaPath(id)).catch(() => {});
      await fs.unlink(getBlobPath(id)).catch(() => {});
      return null;
    }
    return meta;
  } catch {
    return null;
  }
}

/**
 * Consume 1 read (if maxReads > 0) and return the encrypted binary payload.
 * Automatically deletes the secret when remainingReads reaches 0 or expired.
 */
export async function consumeSecret(
  id: string
): Promise<LoadSecretResult | null> {
  const config = getRuntimeConfig();
  const now = Date.now();

  if (config.storageBackend === "upstash") {
    const redis = getUpstashClient();
    if (!redis) return null;
    const key = `envshare:${id}`;
    const record = await redis.hgetall<{
      meta?: string | StoredSecretMeta;
      data?: string;
      remainingReads?: number | string;
    }>(key);

    if (!record || !record.meta || !record.data) {
      return null;
    }

    const meta: StoredSecretMeta =
      typeof record.meta === "string" ? JSON.parse(record.meta) : record.meta;

    if (now >= meta.expiresAt) {
      await redis.del(key);
      return null;
    }

    if (meta.maxReads > 0) {
      const newRemaining = await redis.hincrby(key, "remainingReads", -1);
      if (newRemaining < 0) {
        await redis.del(key);
        return null;
      }
      meta.remainingReads = newRemaining;
      if (newRemaining === 0) {
        await redis.del(key);
      }
    }

    const encryptedBytes = new Uint8Array(Buffer.from(record.data, "base64"));
    return { meta, encryptedBytes };
  }

  if (config.storageBackend === "memory-ephemeral") {
    const entry = memoryStore.get(id);
    if (!entry) return null;
    if (now >= entry.meta.expiresAt) {
      memoryStore.delete(id);
      return null;
    }
    if (entry.meta.maxReads > 0) {
      if (entry.meta.remainingReads <= 0) {
        memoryStore.delete(id);
        return null;
      }
      entry.meta.remainingReads -= 1;
      const resultMeta = { ...entry.meta };
      const dataCopy = new Uint8Array(entry.data);
      if (entry.meta.remainingReads === 0) {
        memoryStore.delete(id);
      }
      return { meta: resultMeta, encryptedBytes: dataCopy };
    }
    return {
      meta: { ...entry.meta },
      encryptedBytes: new Uint8Array(entry.data),
    };
  }

  // Self-hosted local-fs storage with atomic lock
  return withLock(id, async () => {
    const metaPath = getMetaPath(id);
    const blobPath = getBlobPath(id);

    let meta: StoredSecretMeta;
    try {
      const raw = await fs.readFile(metaPath, "utf-8");
      meta = JSON.parse(raw) as StoredSecretMeta;
    } catch {
      return null;
    }

    if (
      now >= meta.expiresAt ||
      (meta.maxReads > 0 && meta.remainingReads <= 0)
    ) {
      await fs.unlink(metaPath).catch(() => {});
      await fs.unlink(blobPath).catch(() => {});
      return null;
    }

    let blobBuffer: Buffer;
    try {
      blobBuffer = await fs.readFile(blobPath);
    } catch {
      await fs.unlink(metaPath).catch(() => {});
      return null;
    }

    if (meta.maxReads > 0) {
      meta.remainingReads -= 1;
      if (meta.remainingReads <= 0) {
        // Burn after reading: delete immediately from disk
        await fs.unlink(metaPath).catch(() => {});
        await fs.unlink(blobPath).catch(() => {});
      } else {
        await fs.writeFile(metaPath, JSON.stringify(meta), "utf-8");
      }
    }

    return {
      meta,
      encryptedBytes: new Uint8Array(
        blobBuffer.buffer,
        blobBuffer.byteOffset,
        blobBuffer.byteLength
      ),
    };
  });
}
