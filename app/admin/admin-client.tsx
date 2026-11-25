"use client";

import {
  Activity,
  Check,
  Copy,
  ExternalLink,
  Eye,
  Globe,
  KeyRound,
  Lock,
  MessageSquare,
  Monitor,
  Percent,
  RefreshCw,
  Search,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Users,
} from "lucide-react";
import Link from "next/link";
import type { CreditBalance } from "../../lib/credits";
import { useCallback, useEffect, useMemo, useState } from "react";

interface AdminUserRow {
  email: string;
  tier: "free" | "pro-trial" | "pro" | "max";
  planExpiresAt: string | null;
  planSource: string;
  sites: string[];
  credits: CreditBalance;
  consumedCredits: number;
  refCode: string;
  referredBy: string | null;
  invitedCount: number;
  lastActiveAt: string;
}

interface AdminSiteRow {
  slug: string;
  name: string;
  headline: string;
  ownerEmail: string;
  theme: string;
  noindex: boolean;
  protected: boolean;
  chatMode: "hosted" | "byok";
  hostedModel: string;
  views: number;
  questions: number;
  createdAt: string;
  expiresAt: string;
}

interface AdminCodeRow {
  code: string;
  plan: "pro" | "max" | "free";
  days: number;
  maxUses: number;
  usedCount: number;
  usedBy: string[];
  note: string;
  createdAt: string;
}

interface AdminDiscountRow {
  id: string;
  code: string;
  discountRate: number;
  percentage: number;
  duration: "once" | "forever";
  maxRedemptions: number;
  expiresAt?: string;
  note?: string;
  createdAt: string;
}

interface AdminTraffic {
  todayPv: number;
  todayUv: number;
  last7dPv: number;
  last7dUv: number;
  totalPv: number;
  totalUv: number;
  daily: Array<{ date: string; pv: number; uv: number }>;
  pages: Array<{ path: string; pv: number }>;
  referrers: Array<{ source: string; pv: number }>;
  devices: { mobile: number; desktop: number };
}

interface AdminOverview {
  adminEmail: string;
  summary: {
    totalUsers: number;
    totalSites: number;
    paidUsers: number;
    trialUsers: number;
    totalReferrals: number;
    totalViews: number;
    totalQuestions: number;
    totalLeads: number;
  };
  users: AdminUserRow[];
  sites: AdminSiteRow[];
  codes: AdminCodeRow[];
  discounts?: AdminDiscountRow[];
  traffic?: AdminTraffic;
}

const PAGE_LABELS: Record<string, string> = {
  "/": "首页 (/)",
  "/create": "工作台 (/create)",
  "/u/*": "用户个人站 (/u/*)",
  "/pricing": "定价页 (/pricing)",
  "/projects/*": "项目详情 (/projects/*)",
  "/login": "登录页 (/login)",
  "/preview": "全屏预览 (/preview)",
  "/legal": "隐私 / 条款",
  "/other": "其他页面",
};

const REFERRER_LABELS: Record<string, string> = {
  direct: "直接访问 / 书签",
  wechat: "微信内置浏览器",
  "xiaohongshu.com": "小红书",
  "v2ex.com": "V2EX",
  "github.com": "GitHub",
  "x.com": "X (Twitter)",
  "google.com": "Google 搜索",
  "zhihu.com": "知乎",
  "juejin.cn": "稀土掘金",
};

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return iso;
  return new Date(ts).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

export function AdminClient() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "unauth" | "forbidden" | "error">("loading");
  const [errMsg, setErrMsg] = useState("");
  const [tab, setTab] = useState<"users" | "sites" | "traffic" | "codes">("users");
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  // Code generator form
  const [codePlan, setCodePlan] = useState<"pro" | "max">("pro");
  const [codeDays, setCodeDays] = useState(30);
  const [codeMaxUses, setCodeMaxUses] = useState(1);
  const [codeCount, setCodeCount] = useState(1);
  const [codeNote, setCodeNote] = useState("");
  const [creatingCode, setCreatingCode] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Discount coupon generator form (Creem real discount)
  const [discountRate, setDiscountRate] = useState(8);
  const [discountCode, setDiscountCode] = useState("");
  const [discountMaxUses, setDiscountMaxUses] = useState(10);
  const [discountExpiryDays, setDiscountExpiryDays] = useState(30);
  const [discountDuration, setDiscountDuration] = useState<"once" | "forever">("once");
  const [discountNote, setDiscountNote] = useState("");
  const [creatingDiscount, setCreatingDiscount] = useState(false);
  const [discountError, setDiscountError] = useState("");

  const applyResponse = useCallback(async (res: Response) => {
    if (res.status === 401) {
      setStatus("unauth");
      return;
    }
    if (res.status === 403) {
      setStatus("forbidden");
      return;
    }
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setErrMsg(j.error || `HTTP ${res.status}`);
      setStatus("error");
      return;
    }
    const json = (await res.json()) as AdminOverview;
    setData(json);
    setStatus("ok");
  }, []);

  const loadOverview = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/admin/overview", { cache: "no-store" });
      await applyResponse(res);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "Network error");
      setStatus("error");
    } finally {
      setRefreshing(false);
    }
  }, [applyResponse]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/overview", { cache: "no-store", signal: controller.signal })
      .then((res) => applyResponse(res))
      .catch((e) => {
        if (controller.signal.aborted) return;
        setErrMsg(e instanceof Error ? e.message : "Network error");
        setStatus("error");
      });
    return () => controller.abort();
  }, [applyResponse]);

  const q = query.trim().toLowerCase();
  const filteredUsers = useMemo(() => {
    if (!data) return [];
    if (!q) return data.users;
    return data.users.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        u.tier.includes(q) ||
        u.refCode.toLowerCase().includes(q) ||
        u.sites.some((s) => s.toLowerCase().includes(q)),
    );
  }, [data, q]);

  const filteredSites = useMemo(() => {
    if (!data) return [];
    if (!q) return data.sites;
    return data.sites.filter(
      (s) =>
        s.slug.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.ownerEmail.toLowerCase().includes(q) ||
        s.theme.toLowerCase().includes(q),
    );
  }, [data, q]);

  const createCodes = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingCode(true);
    try {
      const res = await fetch("/api/admin/codes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          plan: codePlan,
          days: codeDays,
          maxUses: codeMaxUses,
          count: codeCount,
          note: codeNote.trim() || undefined,
        }),
      });
      if (res.ok) {
        setCodeNote("");
        await loadOverview();
      }
    } finally {
      setCreatingCode(false);
    }
  };

  const createDiscount = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingDiscount(true);
    setDiscountError("");
    try {
      const res = await fetch("/api/admin/discounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          discountRate,
          code: discountCode.trim() || undefined,
          maxRedemptions: discountMaxUses,
          expiryDays: discountExpiryDays,
          duration: discountDuration,
          note: discountNote.trim() || undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setDiscountError(json.error || `创建失败 (HTTP ${res.status})`);
        return;
      }
      setDiscountCode("");
      setDiscountNote("");
      await loadOverview();
    } catch {
      setDiscountError("网络错误，请稍后重试。");
    } finally {
      setCreatingDiscount(false);
    }
  };

  if (status === "loading") {
    return (
      <main className="af-admin-wrap">
        <div className="af-admin-empty">正在加载 TalkCV 运营后台…</div>
      </main>
    );
  }

  if (status === "unauth" || status === "forbidden" || status === "error") {
    return (
      <main className="af-admin-wrap">
        <div className="af-admin-empty">
          <ShieldCheck size={28} />
          <h1>{status === "unauth" ? "请先登录管理员账号" : status === "forbidden" ? "无管理员权限" : "加载失败"}</h1>
          <p>
            {status === "unauth"
              ? "使用管理员邮箱登录后，将自动返回运营后台。"
              : status === "forbidden"
                ? "当前登录邮箱不在 ADMIN_EMAILS 白名单中。"
                : errMsg}
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 12 }}>
            <Link href={status === "unauth" ? "/login?next=/admin" : "/create"} className="af-btn af-btn-primary">
              {status === "unauth" ? "使用邮箱登录" : "打开工作台"}
            </Link>
            <button type="button" className="af-btn af-btn-secondary" onClick={() => void loadOverview()}>
              重试
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (!data) return null;

  return (
    <main className="af-admin-wrap">
      <header className="af-admin-header">
        <div>
          <p className="af-eyebrow">TALKCV ADMIN</p>
          <h1>运营数据后台</h1>
          <span className="af-admin-sub">当前管理员：{data.adminEmail}</span>
        </div>
        <div className="af-admin-actions">
          <button type="button" className="af-icon-pill" onClick={() => void loadOverview()} disabled={refreshing}>
            <RefreshCw size={13} className={refreshing ? "af-spin" : ""} />
            <span>{refreshing ? "刷新中…" : "刷新数据"}</span>
          </button>
          <Link href="/create" className="af-icon-pill">
            返回 Studio
          </Link>
        </div>
      </header>

      <section className="af-admin-kpis">
        <div className="af-admin-kpi">
          <span className="af-admin-kpi-label"><Activity size={13} /> 今日访客 (UV)</span>
          <strong>{data.traffic?.todayUv ?? 0}</strong>
          <small>今日 PV {data.traffic?.todayPv ?? 0} · 近 7 天 {data.traffic?.last7dPv ?? 0}</small>
        </div>
        <div className="af-admin-kpi">
          <span className="af-admin-kpi-label"><Users size={13} /> 总用户</span>
          <strong>{data.summary.totalUsers}</strong>
          <small>付费 {data.summary.paidUsers} · 体验 {data.summary.trialUsers}</small>
        </div>
        <div className="af-admin-kpi">
          <span className="af-admin-kpi-label"><Globe size={13} /> 已发布简历站</span>
          <strong>{data.summary.totalSites}</strong>
          <small>有效拉新 {data.summary.totalReferrals} 人</small>
        </div>
        <div className="af-admin-kpi">
          <span className="af-admin-kpi-label"><Eye size={13} /> 个人站浏览</span>
          <strong>{data.summary.totalViews}</strong>
          <small>所有 /u/* 站点合计</small>
        </div>
        <div className="af-admin-kpi">
          <span className="af-admin-kpi-label"><MessageSquare size={13} /> 访客 AI 提问</span>
          <strong>{data.summary.totalQuestions}</strong>
          <small>约面线索 · {data.summary.totalLeads}</small>
        </div>
      </section>

      <div className="af-admin-toolbar">
        <div className="af-admin-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "users"} className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>
            用户 ({data.users.length})
          </button>
          <button type="button" role="tab" aria-selected={tab === "sites"} className={tab === "sites" ? "active" : ""} onClick={() => setTab("sites")}>
            已发布站点 ({data.sites.length})
          </button>
          <button type="button" role="tab" aria-selected={tab === "traffic"} className={tab === "traffic" ? "active" : ""} onClick={() => setTab("traffic")}>
            流量分析 ({data.traffic?.todayPv ?? 0} 今日PV)
          </button>
          <button type="button" role="tab" aria-selected={tab === "codes"} className={tab === "codes" ? "active" : ""} onClick={() => setTab("codes")}>
            兑换码 &amp; 打折券 ({data.codes.length + (data.discounts?.length ?? 0)})
          </button>
        </div>
        {(tab === "users" || tab === "sites") && (
          <label className="af-admin-search">
            <Search size={14} />
            <input
              type="search"
              placeholder={tab === "users" ? "搜索邮箱 / 站点 / 邀请码…" : "搜索 slug / 姓名 / 邮箱 / 主题…"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        )}
      </div>

      {tab === "users" && (
        <div className="af-admin-table-wrap">
          <table className="af-admin-table">
            <thead>
              <tr>
                <th>用户邮箱</th>
                <th>套餐 / 到期</th>
                <th>已发布站点</th>
                <th>创作点数</th>
                <th>邀请码 / 拉新</th>
                <th>最近活跃</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((u) => (
                <tr key={u.email}>
                  <td>
                    <strong>{u.email}</strong>
                    {u.referredBy && <div className="af-admin-muted">受邀自 {u.referredBy}</div>}
                  </td>
                  <td>
                    <span className={`af-admin-badge tier-${u.tier}`}>
                      {u.tier === "max" ? "MAX" : u.tier === "pro" ? "PRO" : u.tier === "pro-trial" ? "PRO 体验" : "FREE"}
                    </span>
                    {u.planExpiresAt && <div className="af-admin-muted">至 {fmtDate(u.planExpiresAt)}</div>}
                  </td>
                  <td>
                    {u.sites.length === 0 ? (
                      <span className="af-admin-muted">未发布</span>
                    ) : (
                      <div className="af-admin-site-pills">
                        {u.sites.map((slug) => (
                          <a key={slug} href={`/u/${slug}`} target="_blank" rel="noreferrer" className="af-admin-link">
                            /u/{slug} <ExternalLink size={11} />
                          </a>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>
                    <strong>剩余 {u.credits.remaining} 点</strong>
                    <div className="af-admin-muted">基础 {u.credits.remaining - u.credits.bonusRemaining} · 奖励 {u.credits.bonusRemaining}</div>
                    <div className="af-admin-muted">累计已用 {u.consumedCredits} 点</div>
                  </td>
                  <td>
                    <code>{u.refCode || "—"}</code>
                    <div className="af-admin-muted">已邀 {u.invitedCount} 人</div>
                  </td>
                  <td className="af-admin-muted">{fmtTime(u.lastActiveAt)}</td>
                </tr>
              ))}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={6} className="af-admin-muted" style={{ textAlign: "center", padding: 28 }}>
                    没有匹配的用户
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "sites" && (
        <div className="af-admin-table-wrap">
          <table className="af-admin-table">
            <thead>
              <tr>
                <th>站点 & 候选人</th>
                <th>所属邮箱</th>
                <th>主题 / 模型</th>
                <th>访问 / 提问</th>
                <th>状态</th>
                <th>发布 / 到期</th>
              </tr>
            </thead>
            <tbody>
              {filteredSites.map((s) => (
                <tr key={s.slug}>
                  <td>
                    <a href={`/u/${s.slug}`} target="_blank" rel="noreferrer" className="af-admin-link">
                      <strong>/u/{s.slug}</strong> <ExternalLink size={11} />
                    </a>
                    <div className="af-admin-muted">{s.name}{s.headline ? ` · ${s.headline.slice(0, 40)}` : ""}</div>
                  </td>
                  <td>{s.ownerEmail || <span className="af-admin-muted">匿名</span>}</td>
                  <td>
                    <span>{s.theme}</span>
                    <div className="af-admin-muted">{s.chatMode === "byok" ? "BYOK" : s.hostedModel}</div>
                  </td>
                  <td>
                    <strong>{s.views}</strong> 浏览 · <strong>{s.questions}</strong> 问
                  </td>
                  <td>
                    {s.protected ? (
                      <span className="af-admin-badge"><Lock size={11} /> 口令</span>
                    ) : s.noindex ? (
                      <span className="af-admin-badge">隐藏索引</span>
                    ) : (
                      <span className="af-admin-badge tier-pro">公开</span>
                    )}
                  </td>
                  <td className="af-admin-muted">
                    <div>发 {fmtTime(s.createdAt)}</div>
                    <div>止 {fmtDate(s.expiresAt)}</div>
                  </td>
                </tr>
              ))}
              {filteredSites.length === 0 && (
                <tr>
                  <td colSpan={6} className="af-admin-muted" style={{ textAlign: "center", padding: 28 }}>
                    没有匹配的站点
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "traffic" && (
        <section className="af-admin-traffic">
          {(() => {
            const t = data.traffic ?? {
              todayPv: 0,
              todayUv: 0,
              last7dPv: 0,
              last7dUv: 0,
              totalPv: 0,
              totalUv: 0,
              daily: [],
              pages: [],
              referrers: [],
              devices: { mobile: 0, desktop: 0 },
            };
            const maxPv = Math.max(1, ...t.daily.map((d) => d.pv));
            const totalPagePv = Math.max(1, t.pages.reduce((sum, p) => sum + p.pv, 0));
            const totalRefPv = Math.max(1, t.referrers.reduce((sum, r) => sum + r.pv, 0));
            const totalDev = t.devices.mobile + t.devices.desktop;
            const mobilePct = totalDev > 0 ? Math.round((t.devices.mobile / totalDev) * 100) : 0;
            const desktopPct = totalDev > 0 ? 100 - mobilePct : 0;

            return (
              <>
                <div className="af-admin-traffic-card">
                  <div className="af-admin-traffic-head">
                    <div>
                      <h2>近 14 天全站访问趋势</h2>
                      <p className="af-admin-muted">
                        已自动过滤爬虫与探测请求（按北京时间 UTC+8 统计）· 累计 {t.totalPv} PV / {t.totalUv} 日均去重 UV
                      </p>
                    </div>
                    <div className="af-admin-traffic-legend">
                      <span><i className="is-pv" /> PV 浏览量</span>
                      <span><i className="is-uv" /> UV 独立访客</span>
                    </div>
                  </div>
                  <div className="af-admin-chart" role="img" aria-label="近 14 天全站 PV 与 UV 趋势图">
                    {t.daily.map((d) => {
                      const pvH = Math.max(d.pv > 0 ? 6 : 2, Math.round((d.pv / maxPv) * 100));
                      const uvH = Math.max(d.uv > 0 ? 6 : 2, Math.round((d.uv / maxPv) * 100));
                      return (
                        <div
                          key={d.date}
                          className="af-admin-chart-col"
                          title={`${d.date} · ${d.pv} PV · ${d.uv} UV`}
                        >
                          <div className="af-admin-chart-bars">
                            <span className="af-admin-bar is-pv" style={{ height: `${pvH}%` }} />
                            <span className="af-admin-bar is-uv" style={{ height: `${uvH}%` }} />
                          </div>
                          <span className="af-admin-chart-val">{d.uv > 0 ? d.uv : ""}</span>
                          <span className="af-admin-chart-label">{d.date.slice(5)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="af-admin-traffic-grid">
                  <div className="af-admin-traffic-card">
                    <h3>近 7 天热门页面</h3>
                    {t.pages.length === 0 ? (
                      <p className="af-admin-muted">暂无访问记录，打开首页或 Studio 后刷新即可看到实时统计。</p>
                    ) : (
                      <ul className="af-admin-rank-list">
                        {t.pages.map((p) => {
                          const pct = Math.max(2, Math.round((p.pv / totalPagePv) * 100));
                          return (
                            <li key={p.path}>
                              <div className="af-admin-rank-row">
                                <span>{PAGE_LABELS[p.path] ?? p.path}</span>
                                <strong>{p.pv} PV <small>({pct}%)</small></strong>
                              </div>
                              <div className="af-admin-rank-track">
                                <span style={{ width: `${pct}%` }} />
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>

                  <div className="af-admin-traffic-card">
                    <h3>近 7 天来源渠道</h3>
                    {t.referrers.length === 0 ? (
                      <p className="af-admin-muted">暂无来源记录</p>
                    ) : (
                      <ul className="af-admin-rank-list">
                        {t.referrers.map((r) => {
                          const pct = Math.max(2, Math.round((r.pv / totalRefPv) * 100));
                          return (
                            <li key={r.source}>
                              <div className="af-admin-rank-row">
                                <span>{REFERRER_LABELS[r.source] ?? r.source}</span>
                                <strong>{r.pv} PV <small>({pct}%)</small></strong>
                              </div>
                              <div className="af-admin-rank-track">
                                <span className="is-ref" style={{ width: `${pct}%` }} />
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    <div className="af-admin-device-box">
                      <h4>近 7 天设备分布</h4>
                      {totalDev === 0 ? (
                        <p className="af-admin-muted">暂无设备数据</p>
                      ) : (
                        <>
                          <div className="af-admin-device-bar">
                            <span className="is-mobile" style={{ width: `${mobilePct}%` }} />
                            <span className="is-desktop" style={{ width: `${desktopPct}%` }} />
                          </div>
                          <div className="af-admin-device-labels">
                            <span><Smartphone size={13} /> 手机端 {mobilePct}% ({t.devices.mobile})</span>
                            <span><Monitor size={13} /> 电脑端 {desktopPct}% ({t.devices.desktop})</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </>
            );
          })()}
        </section>
      )}

      {tab === "codes" && (
        <div className="af-admin-codes-section">
          <form className="af-admin-code-form" onSubmit={createDiscount}>
            <span className="af-admin-form-title"><Percent size={14} /> 一键生成打折券</span>
            <label>
              折扣（折）
              <input
                type="number"
                min={0.1}
                max={9.9}
                step={0.1}
                value={discountRate}
                onChange={(e) => setDiscountRate(Number(e.target.value))}
              />
            </label>
            <span className="af-admin-muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
              减免 {Math.min(99, Math.max(1, Math.round((10 - (Number(discountRate) || 8)) * 10)))}% · Pro ${(20 * ((Number(discountRate) || 8) / 10)).toFixed(2)}
            </span>
            <label>
              可用次数
              <input type="number" min={1} max={10000} value={discountMaxUses} onChange={(e) => setDiscountMaxUses(Number(e.target.value))} />
            </label>
            <label>
              有效天数
              <input
                type="number"
                min={0}
                max={3650}
                value={discountExpiryDays}
                title="填 0 表示长期有效"
                onChange={(e) => setDiscountExpiryDays(Number(e.target.value))}
              />
            </label>
            <select value={discountDuration} onChange={(e) => setDiscountDuration(e.target.value as "once" | "forever")}>
              <option value="once">首单/单次生效</option>
              <option value="forever">续费永久生效</option>
            </select>
            <input
              type="text"
              placeholder="自定义券码（可选，如 XHS80）"
              value={discountCode}
              onChange={(e) => setDiscountCode(e.target.value)}
            />
            <input
              type="text"
              placeholder="备注（可选，如：小红书 8 折）"
              value={discountNote}
              onChange={(e) => setDiscountNote(e.target.value)}
            />
            <button type="submit" className="af-btn af-btn-primary" disabled={creatingDiscount}>
              <Sparkles size={13} /> {creatingDiscount ? "创建中…" : "生成打折券"}
            </button>
          </form>
          {discountError && (
            <p style={{ color: "#dc2626", fontSize: 13, margin: "4px 0 8px" }}>{discountError}</p>
          )}

          {(data.discounts?.length ?? 0) > 0 && (
            <div className="af-admin-table-wrap" style={{ marginBottom: 18 }}>
              <table className="af-admin-table">
                <thead>
                  <tr>
                    <th>打折券码（Creem 结账输入）</th>
                    <th>折扣力度</th>
                    <th>适用规则</th>
                    <th>上限次数</th>
                    <th>有效期至</th>
                    <th>备注</th>
                    <th>创建时间</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.discounts ?? []).map((d) => (
                    <tr key={d.code}>
                      <td>
                        <button
                          type="button"
                          className="af-admin-code-btn"
                          onClick={() => {
                            void navigator.clipboard?.writeText(d.code);
                            setCopiedCode(d.code);
                            window.setTimeout(() => setCopiedCode(null), 1500);
                          }}
                        >
                          <code>{d.code}</code>
                          {copiedCode === d.code ? <Check size={12} /> : <Copy size={12} />}
                        </button>
                      </td>
                      <td>
                        <span className="af-admin-badge tier-pro">{d.discountRate} 折</span>{" "}
                        <span className="af-admin-muted">(-{d.percentage}%)</span>
                      </td>
                      <td className="af-admin-muted">{d.duration === "forever" ? "续费永久" : "首单/单次"}</td>
                      <td>{d.maxRedemptions} 次</td>
                      <td className="af-admin-muted">{d.expiresAt ? fmtDate(d.expiresAt) : "长期有效"}</td>
                      <td className="af-admin-muted">{d.note || "—"}</td>
                      <td className="af-admin-muted">{fmtTime(d.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <form className="af-admin-code-form" onSubmit={createCodes}>
            <span className="af-admin-form-title"><KeyRound size={14} /> 一键生成兑换码</span>
            <select value={codePlan} onChange={(e) => setCodePlan(e.target.value as "pro" | "max")}>
              <option value="pro">Pro</option>
              <option value="max">Max</option>
            </select>
            <label>
              天数
              <input type="number" min={1} max={3650} value={codeDays} onChange={(e) => setCodeDays(Number(e.target.value))} />
            </label>
            <label>
              可用次数
              <input type="number" min={1} max={1000} value={codeMaxUses} onChange={(e) => setCodeMaxUses(Number(e.target.value))} />
            </label>
            <label>
              数量
              <input type="number" min={1} max={20} value={codeCount} onChange={(e) => setCodeCount(Number(e.target.value))} />
            </label>
            <input
              type="text"
              placeholder="备注（可选，如：小红书内测）"
              value={codeNote}
              onChange={(e) => setCodeNote(e.target.value)}
            />
            <button type="submit" className="af-btn af-btn-primary" disabled={creatingCode}>
              <Sparkles size={13} /> {creatingCode ? "生成中…" : "生成"}
            </button>
          </form>

          <div className="af-admin-table-wrap">
            <table className="af-admin-table">
              <thead>
                <tr>
                  <th>兑换码</th>
                  <th>等级 / 时长</th>
                  <th>使用进度</th>
                  <th>已兑换用户</th>
                  <th>备注</th>
                  <th>创建时间</th>
                </tr>
              </thead>
              <tbody>
                {data.codes.map((c) => (
                  <tr key={c.code}>
                    <td>
                      <button
                        type="button"
                        className="af-admin-code-btn"
                        onClick={() => {
                          void navigator.clipboard?.writeText(c.code);
                          setCopiedCode(c.code);
                          window.setTimeout(() => setCopiedCode(null), 1500);
                        }}
                      >
                        <code>{c.code}</code>
                        {copiedCode === c.code ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                    </td>
                    <td>
                      <span className={`af-admin-badge tier-${c.plan}`}>{c.plan.toUpperCase()}</span> {c.days} 天
                    </td>
                    <td>{c.usedCount} / {c.maxUses}</td>
                    <td className="af-admin-muted">{c.usedBy.length > 0 ? c.usedBy.join(", ") : "未使用"}</td>
                    <td className="af-admin-muted">{c.note || "—"}</td>
                    <td className="af-admin-muted">{fmtTime(c.createdAt)}</td>
                  </tr>
                ))}
                {data.codes.length === 0 && (
                  <tr>
                    <td colSpan={6} className="af-admin-muted" style={{ textAlign: "center", padding: 28 }}>
                      暂无兑换码
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
