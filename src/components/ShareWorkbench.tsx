"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Copy,
  Check,
  Upload,
  X,
  File as FileIcon,
} from "lucide-react";
import { formatBytes, type RuntimeConfig } from "@/lib/config";
import { encryptPayload, type SecretMetadata } from "@/lib/crypto";

interface ShareWorkbenchProps {
  config: RuntimeConfig;
}

const PREFS_STORAGE_KEY = "envshare_prefs_v2";

type TtlUnit = 60 | 3600 | 86400; // Minutes, Hours, Days

export function ShareWorkbench({ config }: ShareWorkbenchProps) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Classic envshare inputs: Reads + TTL (value + unit)
  const [reads, setReads] = useState<number>(1);
  const [ttlValue, setTtlValue] = useState<number>(1);
  const [ttlUnit, setTtlUnit] = useState<TtlUnit>(3600); // Default: 1 Hour
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  const [status, setStatus] = useState<"idle" | "encrypting" | "uploading">(
    "idle"
  );
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed.reads === "number" && parsed.reads >= 0) {
          setReads(parsed.reads);
        }
        if (typeof parsed.ttlValue === "number" && parsed.ttlValue >= 1) {
          setTtlValue(parsed.ttlValue);
        }
        if (
          parsed.ttlUnit === 60 ||
          parsed.ttlUnit === 3600 ||
          parsed.ttlUnit === 86400
        ) {
          setTtlUnit(parsed.ttlUnit);
        }
      }
    } catch {
      // ignore
    } finally {
      setPrefsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!prefsLoaded) return;
    try {
      localStorage.setItem(
        PREFS_STORAGE_KEY,
        JSON.stringify({ reads, ttlValue, ttlUnit })
      );
    } catch {
      // ignore
    }
  }, [reads, ttlValue, ttlUnit, prefsLoaded]);

  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) {
      setImagePreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const handleFile = useCallback((picked: File) => {
    setError(null);
    setFile(picked);
  }, []);

  // Support global Ctrl+V / Cmd+V for screenshots and files
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (shareLink) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === "file") {
          const pastedFile = items[i].getAsFile();
          if (pastedFile) {
            e.preventDefault();
            handleFile(pastedFile);
            return;
          }
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [handleFile, shareLink]);

  const currentBytes = React.useMemo(() => {
    if (file) return file.size;
    return new TextEncoder().encode(text).byteLength;
  }, [file, text]);

  const isEmpty = !file && text.trim().length === 0;
  const isOverLimit = currentBytes > config.maxSizeBytes;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isEmpty || isOverLimit) return;

    setError(null);
    setStatus("encrypting");
    setProgress(0);

    try {
      let rawBytes: Uint8Array;
      let metadata: SecretMetadata;

      if (file) {
        rawBytes = new Uint8Array(await file.arrayBuffer());
        metadata = {
          v: 1,
          kind: file.type.startsWith("image/") ? "image" : "file",
          name: file.name,
          mime: file.type || "application/octet-stream",
          size: rawBytes.byteLength,
          createdAt: Date.now(),
        };
      } else {
        rawBytes = new TextEncoder().encode(text);
        metadata = {
          v: 1,
          kind: "text",
          name: "secret.env",
          mime: "text/plain;charset=utf-8",
          size: rawBytes.byteLength,
          createdAt: Date.now(),
        };
      }

      const { encryptedBytes, keyString } = await encryptPayload(
        metadata,
        rawBytes
      );

      setStatus("uploading");
      const ttlSeconds = Math.max(60, ttlValue * ttlUnit);

      const res = await new Promise<{ id: string }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/v1/store", true);
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.setRequestHeader("x-envshare-ttl", String(ttlSeconds));
        xhr.setRequestHeader("x-envshare-reads", String(reads));
        xhr.setRequestHeader("x-envshare-raw-size", String(rawBytes.byteLength));

        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) {
            setProgress(Math.round((ev.loaded / ev.total) * 100));
          }
        };

        xhr.onload = () => {
          try {
            const data = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(data);
            } else {
              reject(new Error(data.error || `Error ${xhr.status}`));
            }
          } catch {
            reject(new Error(`Upload failed (${xhr.status})`));
          }
        };

        xhr.onerror = () => reject(new Error("Network error"));

        xhr.send(
          new Blob([encryptedBytes as unknown as BlobPart], {
            type: "application/octet-stream",
          })
        );
      });

      setShareLink(`${window.location.origin}/s/${res.id}#${keyString}`);
      setStatus("idle");
    } catch (err) {
      setStatus("idle");
      setError(err instanceof Error ? err.message : "Failed to encrypt/upload");
    }
  };

  const copyLink = async () => {
    if (!shareLink) return;
    await navigator.clipboard.writeText(shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (shareLink) {
    return (
      <div className="mx-auto max-w-xl space-y-6 pt-4">
        <h1 className="text-center text-2xl font-bold tracking-tight text-zinc-100 sm:text-3xl">
          Share this link
        </h1>

        <div className="flex items-center gap-2 rounded border border-zinc-700 bg-zinc-900 px-3 py-2">
          <input
            type="text"
            readOnly
            value={shareLink}
            onClick={(e) => (e.target as HTMLInputElement).select()}
            className="w-full bg-transparent font-mono text-xs text-zinc-100 focus:outline-none sm:text-sm"
          />
          <button
            type="button"
            onClick={copyLink}
            className="inline-flex shrink-0 items-center gap-1.5 rounded bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 transition hover:bg-zinc-200"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>

        {/* Minimal QR Code */}
        <div className="flex flex-col items-center justify-center rounded border border-zinc-800 bg-zinc-900/50 py-6">
          <div className="rounded-lg bg-white p-3">
            <QRCodeSVG value={shareLink} size={176} level="M" />
          </div>
          <span className="mt-3 text-xs text-zinc-500">
            Scan with phone to open directly
          </span>
        </div>

        <button
          type="button"
          onClick={() => {
            setShareLink(null);
            setText("");
            setFile(null);
            setCopied(false);
          }}
          className="w-full rounded border border-zinc-800 bg-zinc-900 py-2.5 text-sm font-medium text-zinc-300 transition hover:border-zinc-700 hover:text-white"
        >
          Share another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-2xl space-y-4 pt-2">
      <h1 className="text-center text-2xl font-bold tracking-tight text-zinc-100 sm:text-3xl">
        Encrypt and Share
      </h1>

      {error && (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Unified Input Box (Text + Paste Image + Drag/Upload File) */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const dropped = e.dataTransfer.files?.[0];
          if (dropped) handleFile(dropped);
        }}
        className={`relative rounded border transition ${
          isDragging
            ? "border-zinc-300 bg-zinc-900"
            : isOverLimit
            ? "border-red-500/60 bg-zinc-900/60"
            : "border-zinc-700 bg-zinc-900/60 focus-within:border-zinc-400"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
          className="hidden"
        />

        {!file ? (
          <textarea
            rows={10}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="DATABASE_URL=postgres://... (or paste screenshot / drop file here)"
            className="w-full resize-y bg-transparent p-4 font-mono text-xs leading-relaxed text-zinc-100 placeholder-zinc-600 focus:outline-none sm:text-sm"
          />
        ) : (
          <div className="flex min-h-[220px] flex-col items-center justify-center p-6 text-center">
            {imagePreview ? (
              <img
                src={imagePreview}
                alt={file.name}
                className="max-h-48 rounded border border-zinc-800 object-contain"
              />
            ) : (
              <FileIcon className="h-10 w-10 text-zinc-400" />
            )}
            <p className="mt-3 max-w-md truncate font-mono text-sm text-zinc-200">
              {file.name}
            </p>
            <p className="mt-1 font-mono text-xs text-zinc-500">
              {formatBytes(file.size)}
            </p>
            <button
              type="button"
              onClick={() => setFile(null)}
              className="mt-4 inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
            >
              <X className="h-3.5 w-3.5" />
              <span>Remove</span>
            </button>
          </div>
        )}

        {/* Subtle bottom bar inside editor */}
        <div className="flex items-center justify-between border-t border-zinc-800/80 px-3 py-2 text-xs text-zinc-500">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 text-zinc-400 transition hover:text-zinc-200"
          >
            <Upload className="h-3.5 w-3.5" />
            <span>Upload file</span>
          </button>

          <span className={isOverLimit ? "text-red-400" : "font-mono"}>
            {formatBytes(currentBytes)} / {config.maxSizeLabel}
          </span>
        </div>
      </div>

      {/* Classic 2-column Reads & TTL row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex items-center justify-between rounded border border-zinc-700 bg-zinc-900/60 px-3 py-2 focus-within:border-zinc-400">
          <label className="text-xs font-medium uppercase tracking-wider text-zinc-400">
            Reads
          </label>
          <input
            type="number"
            min={0}
            max={9999}
            value={reads}
            onChange={(e) =>
              setReads(Math.max(0, parseInt(e.target.value || "0", 10)))
            }
            className="w-24 bg-transparent text-right font-mono text-sm text-zinc-100 focus:outline-none"
          />
        </div>

        <div className="flex items-center justify-between rounded border border-zinc-700 bg-zinc-900/60 px-3 py-2 focus-within:border-zinc-400">
          <label className="text-xs font-medium uppercase tracking-wider text-zinc-400">
            TTL
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={999}
              value={ttlValue}
              onChange={(e) =>
                setTtlValue(Math.max(1, parseInt(e.target.value || "1", 10)))
              }
              className="w-16 bg-transparent text-right font-mono text-sm text-zinc-100 focus:outline-none"
            />
            <select
              value={ttlUnit}
              onChange={(e) =>
                setTtlUnit(Number(e.target.value) as TtlUnit)
              }
              className="bg-zinc-900 text-xs font-medium text-zinc-300 focus:outline-none"
            >
              <option value={60}>Minutes</option>
              <option value={3600}>Hours</option>
              <option value={86400}>Days</option>
            </select>
          </div>
        </div>
      </div>

      <button
        type="submit"
        disabled={isEmpty || isOverLimit || status !== "idle"}
        className="w-full rounded bg-zinc-100 py-2.5 text-sm font-semibold text-zinc-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        {status === "encrypting"
          ? "Encrypting..."
          : status === "uploading"
          ? `Uploading ${progress}%...`
          : "Share"}
      </button>
    </form>
  );
}
