"use client";
import { useEffect, useState } from "react";
import { Lock, RefreshCw } from "lucide-react";
import type { Lang } from "../../lib/schema";
import type { RecentQuestion } from "../../worker/insights";

export function SiteInsights({ slug, lang, onUpgrade }: { slug: string; lang: Lang; onUpgrade: () => void }) {
  const [stats, setStats] = useState<{ views: number; today: number; questions: number; recent?: RecentQuestion[] }>();
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState(false);
  const zh = lang === "zh";
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/profiles/${encodeURIComponent(slug)}/insights`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error();
        setStats(await res.json());
        setError(false);
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [slug, revision]);
  return <section className="af-shell af-insights">
    <header><div><h2>{zh ? "访客洞察" : "Visitor insights"}</h2><small>/u/{slug}</small></div>
      <button type="button" className="af-icon-pill" onClick={() => setRevision(revision + 1)}><RefreshCw size={13}/>{zh ? "刷新" : "Refresh"}</button></header>
    {error ? <p role="alert">{zh ? "无法读取访客洞察，请刷新重试。" : "Could not load insights. Refresh to retry."}</p> : stats ? <>
      <dl>{[[zh ? "总浏览量" : "Total views", stats.views], [zh ? "今日浏览（北京时间）" : "Views today (UTC+8)", stats.today],
        [zh ? "AI 提问次数" : "AI questions", stats.questions]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {stats.recent ? <>
        <h3>{zh ? "近期提问摘要" : "Recent question summaries"}</h3>
        {stats.recent.length === 0 ? <p>{zh ? "还没有访客提问。" : "No visitor questions yet."}</p> :
          <ul>{stats.recent.map((q, i) => <li key={q.at + i}><span>{q.summary[lang]}</span>
            <time dateTime={q.at}>{new Date(q.at).toLocaleString(zh ? "zh-CN" : "en-US")}</time></li>)}</ul>}
      </> : <button type="button" className="af-btn af-btn-secondary" onClick={onUpgrade}><Lock size={14}/>
        {zh ? "升级 Pro 或 Max，查看近期提问摘要" : "Upgrade to Pro or Max to see question summaries"}</button>}
    </> : <p>{zh ? "正在读取…" : "Loading…"}</p>}
  </section>;
}
