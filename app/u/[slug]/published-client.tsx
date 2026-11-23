"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PortfolioProfile } from "../../../lib/schema";
import { PortfolioHome } from "../../portfolio-client";

export function PublishedProfileClient({ slug }: { slug: string }) {
  const [profile, setProfile] = useState<PortfolioProfile | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "not_found">("loading");

  useEffect(() => {
    let active = true;
    fetch(`/api/profiles/${encodeURIComponent(slug)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("not found");
        return (await res.json()) as { profile: PortfolioProfile };
      })
      .then((data) => {
        if (!active) return;
        setProfile(data.profile);
        setStatus("ready");
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

  if (status === "not_found" || !profile) {
    return (
      <main className="af-shell af-not-found">
        <p className="af-eyebrow">404 · NOT PUBLISHED</p>
        <h1>No TalkCV found at /u/{slug}</h1>
        <p className="af-intro">
          This handle hasn&apos;t been published yet. Claim it and create your interactive AI resume in 10 seconds.
        </p>
        <Link className="af-btn af-btn-primary" href="/create">
          Claim /u/{slug} →
        </Link>
      </main>
    );
  }

  return <PortfolioHome initialProfile={profile} profileSlug={slug} />;
}
