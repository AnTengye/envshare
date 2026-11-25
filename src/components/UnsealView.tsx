"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Copy, Check, Download, File as FileIcon } from "lucide-react";
import { formatBytes } from "@/lib/config";
import { decryptPayload, type DecryptedPayload } from "@/lib/crypto";

interface UnsealViewProps {
  initialId?: string;
}

export function UnsealView({ initialId }: UnsealViewProps) {
  const [input, setInput] = useState("");
  const [secretId, setSecretId] = useState(initialId || "");
  const [secretKey, setSecretKey] = useState("");

  const [status, setStatus] = useState<
    "idle" | "loading" | "done" | "error"
  >("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [decrypted, setDecrypted] = useState<DecryptedPayload | null>(null);
  const [remainingReads, setRemainingReads] = useState<number | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.replace(/^#/, "").trim();
    if (initialId) {
      setSecretId(initialId);
      if (hash) setSecretKey(hash);
    } else if (hash) {
      setInputFromHash(hash);
    }

    function setInputFromHash(h: string) {
      if (h.includes(".")) {
        const [idPart, keyPart] = h.split(".");
        setSecretId(idPart);
        setSecretKey(keyPart);
      } else {
        setSecretKey(h);
      }
    }
  }, [initialId]);

  useEffect(() => {
    if (!decrypted) {
      setBlobUrl(null);
      return;
    }
    const mime =
      decrypted.metadata.mime ||
      (decrypted.metadata.kind === "text"
        ? "text/plain;charset=utf-8"
        : "application/octet-stream");
    const url = URL.createObjectURL(
      new Blob([decrypted.bytes as unknown as BlobPart], { type: mime })
    );
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [decrypted]);

  const unseal = useCallback(async (id: string, key: string) => {
    if (!id || !key) {
      setError("Invalid link or missing decryption key");
      setStatus("error");
      return;
    }

    setError(null);
    setStatus("loading");
    setProgress(0);

    try {
      const { encryptedBytes, remaining } = await new Promise<{
        encryptedBytes: Uint8Array;
        remaining: number | null;
      }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `/api/v1/secret/${encodeURIComponent(id)}`, true);
        xhr.responseType = "arraybuffer";

        xhr.onprogress = (ev) => {
          if (ev.lengthComputable && ev.total > 0) {
            setProgress(Math.round((ev.loaded / ev.total) * 100));
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            const remHeader = xhr.getResponseHeader(
              "x-envshare-remaining-reads"
            );
            resolve({
              encryptedBytes: new Uint8Array(xhr.response as ArrayBuffer),
              remaining: remHeader !== null ? parseInt(remHeader, 10) : null,
            });
          } else {
            try {
              const text = new TextDecoder().decode(
                new Uint8Array(xhr.response as ArrayBuffer)
              );
              const json = JSON.parse(text);
              reject(new Error(json.error || "Secret not found or expired"));
            } catch {
              reject(new Error("Secret not found or expired"));
            }
          }
        };

        xhr.onerror = () => reject(new Error("Network error"));
        xhr.send();
      });

      const payload = await decryptPayload(encryptedBytes, key);
      setRemainingReads(remaining);
      setDecrypted(payload);
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Failed to decrypt");
    }
  }, []);

  const autoTriggered = React.useRef(false);
  useEffect(() => {
    if (
      initialId &&
      secretId &&
      secretKey &&
      !autoTriggered.current &&
      status === "idle"
    ) {
      autoTriggered.current = true;
      void unseal(secretId, secretKey);
    }
  }, [initialId, secretId, secretKey, status, unseal]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = input.trim();
    let parsedId = secretId.trim();
    let parsedKey = secretKey.trim();

    if (raw) {
      try {
        if (raw.startsWith("http://") || raw.startsWith("https://")) {
          const url = new URL(raw);
          const parts = url.pathname.split("/").filter(Boolean);
          const sIdx = parts.indexOf("s");
          parsedId =
            sIdx !== -1 && parts[sIdx + 1]
              ? parts[sIdx + 1]
              : parts[parts.length - 1] || "";
          parsedKey = url.hash.replace(/^#/, "");
        } else if (raw.includes("#")) {
          const [l, r] = raw.split("#");
          parsedId = l.split("/").pop() || l;
          parsedKey = r;
        } else if (raw.includes(".")) {
          const [l, r] = raw.split(".");
          parsedId = l;
          parsedKey = r;
        }
      } catch {
        // ignore
      }
    }

    setSecretId(parsedId);
    setSecretKey(parsedKey);
    void unseal(parsedId, parsedKey);
  };

  const handleCopy = async () => {
    if (!decrypted?.text) return;
    await navigator.clipboard.writeText(decrypted.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!blobUrl || !decrypted) return;
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download =
      decrypted.metadata.name ||
      (decrypted.metadata.kind === "text" ? "secret.env" : "download");
    a.click();
  };

  if (status === "loading") {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <p className="text-sm text-zinc-400">
          Decrypting{progress > 0 ? ` (${progress}%)` : "..."}
        </p>
      </div>
    );
  }

  if (status === "done" && decrypted) {
    const { metadata, text } = decrypted;

    return (
      <div className="mx-auto max-w-2xl space-y-4 pt-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-400">
            {remainingReads !== null
              ? `Remaining reads: ${remainingReads}`
              : "Decrypted"}
          </span>

          <div className="flex items-center gap-2">
            {metadata.kind === "text" && (
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800"
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
            )}

            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 rounded bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 transition hover:bg-white"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Download</span>
            </button>
          </div>
        </div>

        {metadata.kind === "text" && (
          <pre className="max-h-[70vh] overflow-auto rounded border border-zinc-800 bg-zinc-900/70 p-4 font-mono text-xs leading-relaxed text-zinc-100 sm:text-sm">
            {text}
          </pre>
        )}

        {metadata.kind === "image" && blobUrl && (
          <div className="flex flex-col items-center justify-center rounded border border-zinc-800 bg-zinc-900/50 p-4">
            <img
              src={blobUrl}
              alt={metadata.name || "image"}
              className="max-h-[70vh] rounded object-contain"
            />
          </div>
        )}

        {metadata.kind === "file" && (
          <div className="flex flex-col items-center justify-center rounded border border-zinc-800 bg-zinc-900/50 px-6 py-12 text-center">
            <FileIcon className="h-10 w-10 text-zinc-400" />
            <p className="mt-3 font-mono text-sm text-zinc-100">
              {metadata.name || "file"}
            </p>
            <p className="mt-1 font-mono text-xs text-zinc-500">
              {formatBytes(metadata.size)}
            </p>
            <button
              type="button"
              onClick={handleDownload}
              className="mt-6 inline-flex items-center gap-2 rounded bg-zinc-100 px-5 py-2.5 text-sm font-semibold text-zinc-900 transition hover:bg-white"
            >
              <Download className="h-4 w-4" />
              <span>Download File</span>
            </button>
          </div>
        )}

        <div className="pt-2 text-right">
          <Link
            href="/"
            className="text-xs text-zinc-500 transition hover:text-zinc-300"
          >
            Share another &rarr;
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleManualSubmit}
      className="mx-auto max-w-xl space-y-4 pt-4"
    >
      <h1 className="text-center text-2xl font-bold tracking-tight text-zinc-100 sm:text-3xl">
        Unseal a Document
      </h1>

      {error && (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="rounded border border-zinc-700 bg-zinc-900/60 px-3 py-2 focus-within:border-zinc-400">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste share link or ID#Key..."
          className="w-full bg-transparent font-mono text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none sm:text-sm"
        />
      </div>

      <button
        type="submit"
        className="w-full rounded bg-zinc-100 py-2.5 text-sm font-semibold text-zinc-900 transition hover:bg-white"
      >
        Unseal
      </button>
    </form>
  );
}
