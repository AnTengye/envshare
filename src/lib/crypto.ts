import { gcm } from "@noble/ciphers/aes.js";

export type SecretKind = "text" | "image" | "file";

export interface SecretMetadata {
  v: 1;
  kind: SecretKind;
  name?: string;
  mime?: string;
  size: number;
  createdAt: number;
}

export interface DecryptedPayload {
  metadata: SecretMetadata;
  bytes: Uint8Array;
  text?: string;
}

const ENVELOPE_VERSION = 1;
const IV_BYTE_LENGTH = 12;
const KEY_BYTE_LENGTH = 16; // 128-bit AES-GCM (22 chars in base64url, keeps QR codes compact)

function getRandomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    return globalThis.crypto.getRandomValues(out);
  }
  for (let i = 0; i < length; i++) {
    out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  const base64 = padded + "=".repeat(padLen);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Pack metadata header + raw payload bytes into a single binary envelope:
 * [4-byte Uint32BE headerLength] [UTF-8 JSON header] [raw payload bytes]
 */
export function packEnvelope(
  metadata: SecretMetadata,
  payloadBytes: Uint8Array
): Uint8Array {
  const headerJson = JSON.stringify(metadata);
  const headerBytes = new TextEncoder().encode(headerJson);
  const totalLength = 4 + headerBytes.byteLength + payloadBytes.byteLength;

  const envelope = new Uint8Array(totalLength);
  const view = new DataView(envelope.buffer);
  view.setUint32(0, headerBytes.byteLength, false);
  envelope.set(headerBytes, 4);
  envelope.set(payloadBytes, 4 + headerBytes.byteLength);
  return envelope;
}

/**
 * Unpack binary envelope into metadata + raw payload bytes
 */
export function unpackEnvelope(envelope: Uint8Array): DecryptedPayload {
  if (envelope.byteLength < 4) {
    throw new Error("密文数据包损坏或格式无效");
  }
  const view = new DataView(
    envelope.buffer,
    envelope.byteOffset,
    envelope.byteLength
  );
  const headerLength = view.getUint32(0, false);
  if (headerLength <= 0 || 4 + headerLength > envelope.byteLength) {
    throw new Error("密文头部长度异常");
  }

  const headerBytes = envelope.subarray(4, 4 + headerLength);
  const payloadBytes = envelope.subarray(4 + headerLength);
  const metadata = JSON.parse(
    new TextDecoder().decode(headerBytes)
  ) as SecretMetadata;

  let text: string | undefined;
  if (metadata.kind === "text") {
    text = new TextDecoder().decode(payloadBytes);
  }

  return {
    metadata,
    bytes: payloadBytes,
    text,
  };
}

/**
 * Encrypt metadata + raw bytes in browser using Web Crypto API (AES-GCM)
 * with automatic fallback to @noble/ciphers/aes in non-HTTPS contexts.
 */
export async function encryptPayload(
  metadata: SecretMetadata,
  rawBytes: Uint8Array
): Promise<{ encryptedBytes: Uint8Array; keyString: string }> {
  const rawKey = getRandomBytes(KEY_BYTE_LENGTH);
  const iv = getRandomBytes(IV_BYTE_LENGTH);
  const envelope = packEnvelope(metadata, rawBytes);

  let cipherBytes: Uint8Array;
  if (typeof globalThis.crypto?.subtle?.importKey === "function") {
    const cryptoKey = await globalThis.crypto.subtle.importKey(
      "raw",
      rawKey as unknown as BufferSource,
      { name: "AES-GCM" },
      false,
      ["encrypt"]
    );
    const cipherBuffer = await globalThis.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as unknown as BufferSource },
      cryptoKey,
      envelope as unknown as BufferSource
    );
    cipherBytes = new Uint8Array(cipherBuffer);
  } else {
    cipherBytes = gcm(rawKey, iv).encrypt(envelope);
  }

  const output = new Uint8Array(1 + IV_BYTE_LENGTH + cipherBytes.byteLength);
  output[0] = ENVELOPE_VERSION;
  output.set(iv, 1);
  output.set(cipherBytes, 1 + IV_BYTE_LENGTH);

  return {
    encryptedBytes: output,
    keyString: toBase64Url(rawKey),
  };
}

/**
 * Decrypt binary ciphertext using the Base64URL key string.
 */
export async function decryptPayload(
  encryptedBytes: Uint8Array,
  keyString: string
): Promise<DecryptedPayload> {
  if (encryptedBytes.byteLength <= 1 + IV_BYTE_LENGTH + 16) {
    throw new Error("加密数据长度不足或已损坏");
  }

  const version = encryptedBytes[0];
  if (version !== ENVELOPE_VERSION) {
    throw new Error(`不支持的加密协议版本: v${version}`);
  }

  const iv = encryptedBytes.subarray(1, 1 + IV_BYTE_LENGTH);
  const cipherBytes = encryptedBytes.subarray(1 + IV_BYTE_LENGTH);
  const rawKey = fromBase64Url(keyString.trim());

  let decryptedBytes: Uint8Array;
  try {
    if (typeof globalThis.crypto?.subtle?.importKey === "function") {
      const cryptoKey = await globalThis.crypto.subtle.importKey(
        "raw",
        rawKey as unknown as BufferSource,
        { name: "AES-GCM" },
        false,
        ["decrypt"]
      );
      const decryptedBuffer = await globalThis.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv as unknown as BufferSource },
        cryptoKey,
        cipherBytes as unknown as BufferSource
      );
      decryptedBytes = new Uint8Array(decryptedBuffer);
    } else {
      decryptedBytes = gcm(rawKey, iv).decrypt(cipherBytes);
    }
  } catch {
    throw new Error("解密失败：密钥不正确或密文已被篡改");
  }

  return unpackEnvelope(decryptedBytes);
}
