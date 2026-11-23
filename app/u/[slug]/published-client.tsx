"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PortfolioProfile } from "../../../lib/schema";
import { PortfolioHome } from "../../portfolio-client";

export function PublishedProfileClient({ slug }: { slug: string }) {
  const [profile, setProfile] = useState<PortfolioProfile | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "expired" | "not_found">("loading");

  useEffect(() => {
    let active = true;
    fetch(`/api/profiles/${encodeURIComponent(slug)}`)
      .then(async (res) => {
        if (res.status === 410) {
          if (active) setStatus("expired");
          return null;
        }
        if (!res.ok) throw new Error("not found");
        return (await res.json()) as { profile: PortfolioProfile };
      })
      .then((data) => {
        if (!active || !data) return;
        setProfile(data.profile);
        setStatus("ready");
        const name = data.profile.basics?.name?.zh || data.profile.basics?.name?.en || slug;
        document.title = `${name} · 个人交互简历`;
      })
      .catch(() => {
        if (active) setStatus("not_found");
      });
    return () => {
      active = false;
    };
  }, [slug]);

  if (status === "loading") {
    return (
      <main className="af-shell af-not-found">
        <p className="af-eyebrow">TALKCV</p>
        <p>Loading @{slug}…</p>
      </main>
    );
  }

  if (status === "expired") {
    return (
      <main className="af-shell af-not-found">
        <p className="af-eyebrow">HOSTING EXPIRED</p>
        <h1>/u/{slug} free hosting period has ended</h1>
        <p className="af-intro">
          The 30-day free hosting period for this TalkCV has expired. If you are the owner, sign in at TalkCV Studio to republish.
        </p>
        <Link className="af-btn af-btn-primary" href={`/create?handle=${encodeURIComponent(slug)}`}>
          Open TalkCV Studio →
        </Link>
      </main>
    );
  }

  if (status === "not_found" || !profile) {
    return (
      <main className="af-shell af-not-found">
        <p className="af-eyebrow">404 · NOT PUBLISHED</p>
        <h1>No TalkCV found at /u/{slug}</h1>
        <p className="af-intro">
          This handle hasn&apos;t been published yet. Claim it and create your interactive AI resume in 10 seconds.
        </p>
        <Link className="af-btn af-btn-primary" href={`/create?handle=${encodeURIComponent(slug)}`}>
          Claim /u/{slug} →
        </Link>
      </main>
    );
  }

  return <PortfolioHome initialProfile={profile} profileSlug={slug} />;
}
