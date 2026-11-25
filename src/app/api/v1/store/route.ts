import { NextRequest, NextResponse } from "next/server";
import { formatBytes, getRuntimeConfig, VERCEL_MAX_BYTES } from "@/lib/config";
import { storeSecret } from "@/lib/storage";

export const dynamic = "force-dynamic";

const ENVELOPE_OVERHEAD_ALLOWANCE = 1024; // Allow up to 1KB overhead for AES-GCM IV + Tag + encrypted metadata header

export async function POST(req: NextRequest) {
  try {
    const config = getRuntimeConfig();

    const ttlHeader = req.headers.get("x-envshare-ttl");
    const readsHeader = req.headers.get("x-envshare-reads");
    const rawSizeHeader = req.headers.get("x-envshare-raw-size");

    const ttlSeconds = ttlHeader
      ? parseInt(ttlHeader, 10)
      : config.defaultTtlSeconds;
    const reads =
      readsHeader !== null ? parseInt(readsHeader, 10) : config.defaultReads;
    const declaredRawSize = rawSizeHeader ? parseInt(rawSizeHeader, 10) : 0;

    if (isNaN(ttlSeconds) || ttlSeconds < 60) {
      return NextResponse.json(
        { error: "过期时间至少为 60 秒" },
        { status: 400 }
      );
    }

    if (isNaN(reads) || reads < 0) {
      return NextResponse.json(
        { error: "可读取次数参数无效" },
        { status: 400 }
      );
    }

    const arrayBuffer = await req.arrayBuffer();
    const encryptedBytes = new Uint8Array(arrayBuffer);

    if (encryptedBytes.byteLength === 0) {
      return NextResponse.json(
        { error: "加密数据不能为空" },
        { status: 400 }
      );
    }

    const effectiveCheckSize =
      declaredRawSize > 0
        ? Math.max(
            declaredRawSize,
            encryptedBytes.byteLength - ENVELOPE_OVERHEAD_ALLOWANCE
          )
        : encryptedBytes.byteLength - ENVELOPE_OVERHEAD_ALLOWANCE;

    if (effectiveCheckSize > config.maxSizeBytes) {
      if (config.mode === "vercel") {
        return NextResponse.json(
          {
            error: `当前为 Vercel 一键部署模式，单次分享最大限制为 ${formatBytes(
              VERCEL_MAX_BYTES
            )}。大于 16 KB 的图片或大文件（如 APK）仅支持在自建模式下使用。`,
            code: "VERCEL_LIMIT_EXCEEDED",
            maxSizeBytes: config.maxSizeBytes,
          },
          { status: 413 }
        );
      }

      return NextResponse.json(
        {
          error: `文件大小超出当前自建实例上限（最大支持 ${config.maxSizeLabel}）`,
          code: "MAX_SIZE_EXCEEDED",
          maxSizeBytes: config.maxSizeBytes,
        },
        { status: 413 }
      );
    }

    const meta = await storeSecret(encryptedBytes, {
      ttlSeconds,
      reads,
    });

    return NextResponse.json({
      id: meta.id,
      expiresAt: meta.expiresAt,
      remainingReads: meta.remainingReads,
      maxReads: meta.maxReads,
      sizeBytes: meta.sizeBytes,
      mode: config.mode,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "存储加密数据时发生未知错误";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
