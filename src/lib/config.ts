export type DeployMode = "vercel" | "self-hosted";

export interface RuntimeConfig {
  mode: DeployMode;
  maxSizeBytes: number;
  maxSizeLabel: string;
  defaultTtlSeconds: number;
  defaultReads: number;
  storageBackend: "upstash" | "local-fs" | "memory-ephemeral";
}

export const VERCEL_MAX_BYTES = 16 * 1024; // 16 KB

export function getDeployMode(): DeployMode {
  const explicit = process.env.ENVSHARE_MODE?.toLowerCase();
  if (explicit === "vercel") return "vercel";
  if (explicit === "self-hosted" || explicit === "self_hosted" || explicit === "pro") {
    return "self-hosted";
  }
  if (process.env.VERCEL === "1") {
    return "vercel";
  }
  return "self-hosted";
}

export function getRuntimeConfig(): RuntimeConfig {
  const mode = getDeployMode();

  const maxFileSizeMb = Math.max(
    1,
     Number(process.env.MAX_FILE_SIZE_MB || "100") || 100
  );

  const maxSizeBytes =
    mode === "vercel" ? VERCEL_MAX_BYTES : maxFileSizeMb * 1024 * 1024;

  const defaultTtlSeconds = Math.max(
    60,
    Number(process.env.DEFAULT_TTL_SECONDS || "3600") || 3600
  );

  const defaultReads =
    process.env.DEFAULT_READS !== undefined
      ? Math.max(0, Number(process.env.DEFAULT_READS))
      : 1; // 默认 1 次（阅后即焚）

  const hasUpstash = Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  );

  let storageBackend: RuntimeConfig["storageBackend"] = "local-fs";
  if (mode === "vercel") {
    storageBackend = hasUpstash ? "upstash" : "memory-ephemeral";
  } else {
    storageBackend = "local-fs";
  }

  return {
    mode,
    maxSizeBytes,
    maxSizeLabel: formatBytes(maxSizeBytes),
    defaultTtlSeconds,
    defaultReads,
    storageBackend,
  };
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const val = bytes / Math.pow(k, i);
  return `${parseFloat(val.toFixed(dm))} ${sizes[i]}`;
}
