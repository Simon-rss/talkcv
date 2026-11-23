"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PortfolioProfile } from "../../lib/schema";
import { PortfolioHome } from "../portfolio-client";

export default function PreviewDraftPage() {
  const [draft, setDraft] = useState<PortfolioProfile | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const raf = window.requestAnimationFrame(() => {
      try {
        const raw = window.sessionStorage.getItem("talkcv-draft-profile");
        if (raw) {
          setDraft(JSON.parse(raw) as PortfolioProfile);
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
        <p>Loading your generated site…</p>
      </main>
    );
  }

  if (!draft) {
    return (
      <main className="af-shell af-not-found">
        <p className="af-eyebrow">TALKCV PREVIEW</p>
        <h1>No draft found in this tab</h1>
        <p className="af-intro">Generate a TalkCV profile first, then click Fullscreen Preview.</p>
        <Link className="af-btn af-btn-primary" href="/create">
          Go to TalkCV Studio
        </Link>
      </main>
    );
  }

  return (
    <>
      <div className="af-preview-strip">
        <span>Fullscreen draft preview · Not published yet</span>
        <Link href="/create">Back to Studio to Publish →</Link>
      </div>
      <PortfolioHome initialProfile={draft} profileSlug="__draft__" />
    </>
  );
}
