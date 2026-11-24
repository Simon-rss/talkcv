"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { normalizeSlug, type PortfolioProfile } from "../../lib/schema";
import { PortfolioHome } from "../portfolio-client";

export default function PreviewDraftPage() {
  const [draft, setDraft] = useState<PortfolioProfile | null>(null);
  const [handle, setHandle] = useState<string>();
  const [zh, setZh] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const raf = window.requestAnimationFrame(() => {
      try {
        const params = new URLSearchParams(window.location.search);
        const slug = normalizeSlug(params.get("handle") ?? "");
        if (slug.length >= 3) setHandle(slug);
        setZh(params.get("lang") !== "en");
        const raw = window.localStorage.getItem("talkcv-draft-profile");
        if (raw) {
          const parsed = JSON.parse(raw) as PortfolioProfile;
          setDraft(parsed);
          const name = parsed.basics?.name?.zh || parsed.basics?.name?.en || "Preview";
          const role = parsed.basics?.role?.zh || parsed.basics?.role?.en || "TalkCV";
          document.title = `${name} | ${role}`;
        }
      } catch {
        setDraft(null);
      } finally {
        setLoaded(true);
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, []);

  if (!loaded) {
    return (
      <main className="af-shell af-not-found">
        <p className="af-eyebrow">TALKCV PREVIEW</p>
        <p>{zh ? "正在载入草稿…" : "Loading your draft…"}</p>
      </main>
    );
  }

  if (!draft) {
    return (
      <main className="af-shell af-not-found">
        <p className="af-eyebrow">TALKCV PREVIEW</p>
        <h1>{zh ? "尚未找到预览草稿" : "No draft found"}</h1>
        <p className="af-intro">{zh ? "先在工作台创建简历，再打开全屏预览。" : "Create a résumé in Studio and open Fullscreen Preview."}</p>
        <Link className="af-btn af-btn-primary" href="/create">
          {zh ? "打开工作台" : "Go to TalkCV Studio"}
        </Link>
      </main>
    );
  }

  return <PortfolioHome initialProfile={draft} profileSlug="__draft__" draftHandle={handle} initialLang={zh ? "zh" : "en"} />;
}
