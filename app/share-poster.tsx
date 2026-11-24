"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Share2, X } from "lucide-react";
import { localize, type Lang, type PortfolioProfile } from "../lib/schema";
import { siteQrDataUrl } from "../lib/site-qr.mjs";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, leading: number, maxLines: number) {
  let line = "";
  let row = 0;
  for (const char of text.trim().replace(/\s+/g, " ")) {
    if (line && ctx.measureText(line + char).width > width) {
      if (row === maxLines - 1) {
        while (line && ctx.measureText(line + "…").width > width) line = line.slice(0, -1);
        ctx.fillText(line.trimEnd() + "…", x, y + row * leading);
        return;
      }
      const space = line.lastIndexOf(" ");
      const cut = space > line.length / 2 ? space : line.length;
      ctx.fillText(line.slice(0, cut), x, y + row++ * leading);
      line = line.slice(cut).trimStart();
    }
    line += char;
  }
  ctx.fillText(line.trim(), x, y + row * leading);
}

async function makePoster(profile: PortfolioProfile, slug: string, lang: Lang) {
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 1280;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  const { basics } = profile;
  const [qr, avatar] = await Promise.all([
    siteQrDataUrl(slug).then(loadImage),
    basics.avatar ? loadImage(basics.avatar).catch(() => null) : null,
  ]);
  const sans = 'system-ui, "PingFang SC", sans-serif';
  const name = localize(basics.name, lang);
  ctx.fillStyle = "#f7f5ed";
  ctx.fillRect(0, 0, 960, 1280);
  ctx.fillStyle = "#103f36";
  ctx.fillRect(0, 0, 960, 486);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, 960, 486); ctx.clip();
  ctx.strokeStyle = "#286053";
  ctx.lineWidth = 2;
  for (let r = 160; r <= 570; r += 37) {
    ctx.beginPath(); ctx.arc(985, -70, r, 0, 2 * Math.PI); ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.beginPath(); ctx.arc(138, 138, 70, 0, Math.PI * 2); ctx.clip();
  if (avatar) {
    const side = Math.min(avatar.naturalWidth, avatar.naturalHeight);
    ctx.drawImage(avatar, (avatar.naturalWidth - side) / 2, (avatar.naturalHeight - side) / 2, side, side, 68, 68, 140, 140);
  } else {
    ctx.fillStyle = "#dbedb4"; ctx.fillRect(68, 68, 140, 140);
    ctx.fillStyle = "#173d32"; ctx.font = `700 51px ${sans}`; ctx.textAlign = "center";
    ctx.fillText((basics.initials || name).slice(0, 2), 138, 156, 114);
  }
  ctx.restore();
  ctx.fillStyle = "#ffffff"; ctx.font = `700 66px ${sans}`;
  drawText(ctx, name, 68, 296, 824, 69, 2);
  ctx.fillStyle = "#d7e8dc"; ctx.font = `500 33px ${sans}`;
  drawText(ctx, localize(basics.role, lang), 70, 438, 816, 43, 1);

  ctx.fillStyle = "#152f29"; ctx.font = `600 48px ${sans}`;
  drawText(ctx, localize(basics.headline, lang), 68, 596, 824, 64, 3);
  ctx.font = `500 26px ${sans}`;
  let x = 68, y = 785;
  for (const skill of profile.skills.slice(0, 6)) {
    const width = Math.min(ctx.measureText(skill).width + 46, 824);
    if (x + width > 892) { x = 68; y += 62; }
    if (y > 850) break;
    ctx.beginPath(); ctx.roundRect(x, y, width, 48, 24); ctx.fillStyle = "#e1e9db"; ctx.fill();
    ctx.fillStyle = "#193c32"; ctx.fillText(skill, x + 23, y + 33, width - 46);
    x += width + 12;
  }

  ctx.fillStyle = "#c7d1c4"; ctx.fillRect(68, 937, 824, 2);
  ctx.fillStyle = "#173e33"; ctx.font = `650 36px ${sans}`;
  drawText(ctx, lang === "zh" ? "扫码与我的 AI 助手对话" : "Scan to chat with my AI assistant", 68, 1050, 523, 48, 2);
  ctx.fillStyle = "#455e52"; ctx.font = `400 23px ${sans}`;
  drawText(ctx, `talkcv.renss.top/u/${slug}`, 68, 1181, 535, 30, 2);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(qr, 648, 987, 244, 244);
  return canvas.toDataURL("image/png");
}

export function SharePoster({ profile, slug, lang }: { profile: PortfolioProfile; slug: string; lang: Lang }) {
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState("");
  const [failed, setFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const zh = lang === "zh";
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    element?.showModal();
    let active = true;
    makePoster(profile, slug, lang).then((url) => { if (active) setImage(url); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [open, profile, slug, lang]);
  return <>
    <button type="button" className="af-btn af-btn-secondary" onClick={() => { setImage(""); setFailed(false); setOpen(true); }}>
      <Share2 size={15}/>{zh ? "生成分享名片海报" : "Create share poster"}
    </button>
    {open && <dialog className="af-poster-dialog" aria-label={zh ? "分享名片海报" : "Share poster"}
      ref={dialog} onClose={() => setOpen(false)}>
      <header><strong>{zh ? "分享名片海报" : "Share poster"}</strong>
        <button type="button" className="af-icon-pill" onClick={() => dialog.current?.close()} aria-label={zh ? "关闭" : "Close"}><X size={16}/></button>
      </header>
      {image ? <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} width={960} height={1280} alt={zh ? "个人名片海报预览" : "Personal share poster preview"} />
        <a className="af-btn af-btn-primary" href={image} download={`${slug}-${lang}-poster.png`}><Download size={15}/>{zh ? "下载 PNG" : "Download PNG"}</a>
      </> : <p role="status">{failed ? (zh ? "海报生成失败，请关闭后重试。" : "Could not create the poster. Close and try again.") :
        (zh ? "正在生成海报…" : "Creating poster…")}</p>}
    </dialog>}
  </>;
}
