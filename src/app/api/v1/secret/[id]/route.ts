import { NextRequest, NextResponse } from "next/server";
import { consumeSecret, peekSecretMeta } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/secret/[id]
 * Pre-flight metadata check (does NOT consume a read count).
 */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const meta = await peekSecretMeta(id);
  if (!meta) {
    return NextResponse.json(
      { error: "该分享链接不存在、已过期或已达到最大读取次数（阅后即焚已销毁）" },
      { status: 404 }
    );
  }
  return NextResponse.json({
    id: meta.id,
    expiresAt: meta.expiresAt,
    remainingReads: meta.remainingReads,
    maxReads: meta.maxReads,
    sizeBytes: meta.sizeBytes,
  });
}

/**
 * POST /api/v1/secret/[id]
 * Atomically consumes 1 read count and returns the encrypted binary stream.
 */
export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const result = await consumeSecret(id);

  if (!result) {
    return NextResponse.json(
      { error: "该分享链接不存在、已过期或已达到最大读取次数（阅后即焚已销毁）" },
      { status: 404 }
    );
  }

  const { meta, encryptedBytes } = result;
  const bodyBuffer = encryptedBytes.buffer.slice(
    encryptedBytes.byteOffset,
    encryptedBytes.byteOffset + encryptedBytes.byteLength
  ) as ArrayBuffer;

  return new NextResponse(bodyBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(encryptedBytes.byteLength),
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "x-envshare-remaining-reads": String(meta.remainingReads),
      "x-envshare-max-reads": String(meta.maxReads),
      "x-envshare-expires-at": String(meta.expiresAt),
    },
  });
}
