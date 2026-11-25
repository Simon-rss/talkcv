"use client";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Lock, RefreshCw } from "lucide-react";
import type { Lang } from "../../lib/schema";
import type { RecentQuestion } from "../../worker/insights";
import type { LeadView } from "../../worker/leads";

export function SiteInsights({ slug, lang, onUpgrade }: { slug: string; lang: Lang; onUpgrade: () => void }) {
  const [stats, setStats] = useState<{ views: number; today: number; questions: number; recent?: RecentQuestion[] }>();
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState(false);
  const [leads, setLeads] = useState<LeadView | null>();
  const [copyStatus, setCopyStatus] = useState("");
  const [expanded, setExpanded] = useState(false);
  const zh = lang === "zh";

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/profiles/${encodeURIComponent(slug)}/leads`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const data: LeadView = await res.json();
        if (!controller.signal.aborted) setLeads(data);
      })
      .catch(() => { if (!controller.signal.aborted) setLeads(null); });
    fetch(`/api/profiles/${encodeURIComponent(slug)}/insights`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error();
        setStats(await res.json());
        setError(false);
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [slug, revision]);

  const isZeroActivity = Boolean(
    !error &&
    stats &&
    leads !== undefined &&
    stats.questions === 0 &&
    (leads?.count ?? 0) === 0,
  );

  if (isZeroActivity && !expanded) {
    return (
      <section className="af-shell af-insights af-insights-compact">
        <div className="af-insights-compact-row">
          <span>
            📊 {zh ? "访客洞察" : "Visitor insights"} · <code>/u/{slug}</code> ·{" "}
            {zh
              ? `浏览 ${stats?.views ?? 0} 次 · 暂无提问与约面线索`
              : `${stats?.views ?? 0} views · No questions or recruiter leads yet`}
          </span>
          <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <button type="button" className="af-icon-pill" onClick={() => setRevision(revision + 1)}>
              <RefreshCw size={12} /> {zh ? "刷新" : "Refresh"}
            </button>
            <button type="button" className="af-icon-pill" onClick={() => setExpanded(true)}>
              {zh ? "展开详情" : "Expand"} <ChevronDown size={12} />
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="af-shell af-insights">
      <header>
        <div>
          <h2>{zh ? "访客洞察" : "Visitor insights"}</h2>
          <small>/u/{slug}</small>
        </div>
        <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          {isZeroActivity && (
            <button type="button" className="af-icon-pill" onClick={() => setExpanded(false)}>
              {zh ? "收起" : "Collapse"} <ChevronUp size={12} />
            </button>
          )}
          <button type="button" className="af-icon-pill" onClick={() => setRevision(revision + 1)}>
            <RefreshCw size={13} /> {zh ? "刷新" : "Refresh"}
          </button>
        </div>
      </header>
      {error ? (
        <p role="alert">{zh ? "无法读取访客洞察，请刷新重试。" : "Could not load insights. Refresh to retry."}</p>
      ) : stats ? (
        <>
          <dl>
            {[
              [zh ? "总浏览量" : "Total views", stats.views],
              [zh ? "今日浏览（北京时间）" : "Views today (UTC+8)", stats.today],
              [zh ? "AI 提问次数" : "AI questions", stats.questions],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {stats.recent ? (
            <>
              <h3>{zh ? "近期提问摘要" : "Recent question summaries"}</h3>
              {stats.recent.length === 0 ? (
                <p>{zh ? "还没有访客提问。" : "No visitor questions yet."}</p>
              ) : (
                <ul>
                  {stats.recent.map((q, i) => (
                    <li key={q.at + i}>
                      <span>{q.summary[lang]}</span>
                      <time dateTime={q.at}>{new Date(q.at).toLocaleString(zh ? "zh-CN" : "en-US")}</time>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <button type="button" className="af-btn af-btn-secondary" onClick={onUpgrade}>
              <Lock size={14} />
              {zh ? "升级 Pro 或 Max，查看近期提问摘要" : "Upgrade to Pro or Max to see question summaries"}
            </button>
          )}
        </>
      ) : (
        <p>{zh ? "正在读取…" : "Loading…"}</p>
      )}
      <h3>
        {zh ? "约面线索" : "Recruiter leads"}
        {leads && ` · ${leads.count}`}
      </h3>
      {leads === undefined ? (
        <p>{zh ? "正在读取…" : "Loading…"}</p>
      ) : leads === null ? (
        <p role="alert">{zh ? "线索加载失败，请刷新重试。" : "Could not load leads. Refresh to retry."}</p>
      ) : (
        <>
          {leads.count === 0 && (
            <p>{zh ? "还没有招聘方留下联系方式。" : "No recruiter has left contact details yet."}</p>
          )}
          {leads.locked ? (
            <>
              <ul>
                {leads.preview.map((lead, i) => (
                  <li key={lead.createdAt + i}>
                    <span>{lead.company || (zh ? "招聘访客" : "Recruiter")}</span>
                    <time dateTime={lead.createdAt}>{new Date(lead.createdAt).toLocaleString(zh ? "zh-CN" : "en-US")}</time>
                  </li>
                ))}
              </ul>
              <div className="af-lead-upgrade">
                <button type="button" className="af-btn af-btn-primary" onClick={onUpgrade}>
                  <Lock size={14} />
                  {zh ? "解锁查看 HR 联系方式（冲刺卡 $4.9 起）" : "Unlock recruiter contacts (Starter Pass from $4.9)"}
                </button>
                <a className="af-icon-pill" href="#studio-referral">
                  {zh ? "邀请好友，体验 Pro" : "Invite a friend for a Pro trial"}
                </a>
              </div>
            </>
          ) : (
            <ul>
              {leads.leads.map((lead) => (
                <li key={lead.id}>
                  <div>
                    <strong>{[lead.name, lead.company].filter(Boolean).join(" · ") || (zh ? "招聘访客" : "Recruiter")}</strong>
                    <div>{lead.contact}</div>
                    {lead.note && <p>{lead.note}</p>}
                    <time dateTime={lead.createdAt}>{new Date(lead.createdAt).toLocaleString(zh ? "zh-CN" : "en-US")}</time>
                  </div>
                  <button
                    type="button"
                    className="af-icon-pill"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(lead.contact);
                        setCopyStatus(lead.id);
                      } catch {
                        setCopyStatus("failed");
                      }
                    }}
                  >
                    {copyStatus === lead.id ? (zh ? "已复制" : "Copied") : zh ? "复制联系方式" : "Copy contact"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {copyStatus === "failed" && (
            <small role="status">{zh ? "请手动选择并复制联系方式。" : "Select the contact to copy it manually."}</small>
          )}
        </>
      )}
    </section>
  );
}
