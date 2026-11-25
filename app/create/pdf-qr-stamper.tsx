"use client";

import { FileCheck2, QrCode, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { stampPdfWithTalkCvQr, type StampPosition } from "../../lib/pdf-qr-stamp";
import type { Lang } from "../../lib/schema";

export function PdfQrStamper({ slug, lang }: { slug: string; lang: Lang }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<StampPosition>("top-right");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const zh = lang === "zh";

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      setError(zh ? "请选择 PDF 格式的原版简历文件。" : "Please select a PDF résumé file.");
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const inputBytes = new Uint8Array(await file.arrayBuffer());
      const stamped = await stampPdfWithTalkCvQr(inputBytes, slug, position);
      const outBytes = new Uint8Array(stamped.byteLength);
      outBytes.set(stamped);
      const blob = new Blob([outBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const base = file.name.replace(/\.pdf$/i, "") || slug;
      a.download = `${base}-talkcv.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      setStatus(
        zh
          ? `已生成 ${base}-talkcv.pdf（原版排版 100% 保留，全程本地处理未上传服务器）`
          : `Downloaded ${base}-talkcv.pdf (100% original layout preserved locally)`,
      );
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : zh
            ? "PDF 盖章失败，请确认文件未损坏或未加密码保护。"
            : "Failed to stamp PDF. Make sure the file is not encrypted or corrupted.",
      );
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <>
      <button
        type="button"
        className="af-icon-pill"
        title={zh ? "把『扫码问 AI』二维码无损盖到你自己的原版 PDF 简历上" : "Stamp a clickable AI QR badge onto your original PDF résumé"}
        onClick={() => {
          setOpen(true);
          setStatus(null);
          setError(null);
        }}
      >
        <QrCode size={12} />
        <span>{zh ? "给原版 PDF 盖 AI 码" : "Stamp QR on Original PDF"}</span>
      </button>

      {open && (
        <div
          className="af-case-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={zh ? "给原版 PDF 盖 AI 二维码角标" : "Stamp AI QR badge onto original PDF"}
          onClick={() => setOpen(false)}
        >
          <div className="af-lead-modal" onClick={(e) => e.stopPropagation()}>
            <header className="af-lead-modal-head">
              <div>
                <p className="af-eyebrow">LOSSLESS PDF QR STAMP</p>
                <h3>{zh ? "给原版 PDF 无损盖上「扫码问 AI」角标" : "Stamp AI QR Badge on Original PDF"}</h3>
              </div>
              <button type="button" className="af-icon-pill" onClick={() => setOpen(false)} aria-label="Close">
                <X size={15} />
              </button>
            </header>
            <p className="af-admin-muted" style={{ fontSize: 13, lineHeight: 1.6, margin: "0 0 12px" }}>
              {zh
                ? `不改动你原版简历的任何排版，仅在第一页盖上一枚可点击的二维码徽章（直达 mytalkcv.com/u/${slug}）。全程在浏览器本地完成，原 PDF 不会上传服务器。`
                : `Keeps your original résumé layout 100% untouched and adds a clickable QR badge linking to mytalkcv.com/u/${slug} on page 1. Processed locally in your browser.`}
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              {(
                [
                  ["top-right", zh ? "右上角（推荐）" : "Top-right (Recommended)"],
                  ["bottom-right", zh ? "右下角" : "Bottom-right"],
                  ["header-bar", zh ? "顶部宽徽章" : "Header bar"],
                ] as const
              ).map(([pos, label]) => (
                <button
                  key={pos}
                  type="button"
                  className={`af-icon-pill ${position === pos ? "af-login-pill" : ""}`}
                  onClick={() => setPosition(pos)}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
            <button
              type="button"
              className="af-btn af-btn-primary"
              disabled={busy}
              style={{ width: "100%", justifyContent: "center" }}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={15} />
              <span>
                {busy
                  ? zh ? "正在本地盖章生成…" : "Stamping locally…"
                  : zh ? "选择我的原版 PDF 并立即生成下载" : "Choose original PDF & download stamped copy"}
              </span>
            </button>
            {status && (
              <p role="status" style={{ marginTop: 10, fontSize: 12.5, color: "#0f766e", display: "flex", alignItems: "center", gap: 6 }}>
                <FileCheck2 size={14} /> {status}
              </p>
            )}
            {error && (
              <p role="alert" style={{ marginTop: 10, fontSize: 12.5, color: "#dc2626" }}>
                {error}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
