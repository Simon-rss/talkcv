import type { LocalizedText, PortfolioProfile } from "../lib/schema";
import { getSessionUser } from "./auth";
import { getUserPlan } from "./billing";
import { loadStoredRecord, withSiteWrite, type PublishEnv, type StoredProfileRecord } from "./publish";

export interface RecentQuestion {
  at: string;
  summary: LocalizedText;
}

interface SiteInsights {
  views: number;
  day: string;
  today: number;
  questions: number;
  recent: RecentQuestion[];
}

const memory = new Map<string, SiteInsights>();
const memSiteChatUsage = new Map<string, number>();

function todayDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function removeSiteChatUsage(slug: string, env: PublishEnv) {
  const prefix = `chat_usage:${slug}:`;
  if (!env.PROFILES_KV) {
    for (const key of memSiteChatUsage.keys()) if (key.startsWith(prefix)) memSiteChatUsage.delete(key);
  } else if (env.PROFILES_KV.list) {
    // Native KV pages its keys. PostgreSQL removes this prefix with the profile in its transaction.
    let cursor: string | undefined;
    do {
      const batch = await env.PROFILES_KV.list({ prefix, cursor });
      await Promise.all(batch.keys.map(({ name }) => env.PROFILES_KV!.delete(name)));
      cursor = batch.list_complete ? undefined : batch.cursor;
    } while (cursor);
  }
}

export async function consumeSiteDailyChatQuota(
  slug: string,
  env: PublishEnv,
  dailyLimit: number,
): Promise<boolean> {
  const key = `chat_usage:${slug}:${todayDateKey()}`;
  let current = 0;
  if (env.PROFILES_KV) {
    const raw = await env.PROFILES_KV.get(key);
    const parsed = Number(raw ?? "0");
    current = Number.isFinite(parsed) ? parsed : 0;
  } else {
    current = memSiteChatUsage.get(key) ?? 0;
  }
  if (current >= dailyLimit) return false;
  const next = current + 1;
  if (env.PROFILES_KV) {
    await env.PROFILES_KV.put(key, String(next));
  } else {
    memSiteChatUsage.set(key, next);
  }
  return true;
}

const today = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const topics: [RegExp, string, string][] = [
  [/project|portfolio|案例|项目|作品/i, "projects", "项目经历"],
  [/experien|career|履历|经验|经历|年限/i, "work experience", "工作经验"],
  [/skill|technolog|stack|技术|能力|技能/i, "skills", "技能"],
  [/architect|design|系统|架构|设计/i, "design decisions", "设计决策"],
  [/performanc|impact|latency|成果|指标|性能/i, "measurable results", "项目成效"],
  [/lead|team|collaborat|团队|带人|协作/i, "teamwork and leadership", "协作与管理"],
  [/location|remote|relocat|工作地|地点|远程|搬迁/i, "work location", "工作地点"],
  [/start date|availab|notice period|到岗|入职|离职/i, "availability", "到岗时间"],
  [/salary|pay range|compensation|薪资|薪酬|工资/i, "compensation", "薪酬"],
  [/educat|degree|university|学校|学历|毕业/i, "education", "教育背景"],
  [/language|fluen|英语|语言/i, "language proficiency", "语言能力"],
  [/contact|interview|reach|联系|面试/i, "contact or interview arrangements", "联系或面试安排"],
];

function summarizeQuestion(text: string, profile: PortfolioProfile): LocalizedText {
  const jd = /\bJD\b|job description|岗位匹配|职位描述|岗位描述/i.test(text);
  const matches = topics.filter(([pattern]) => pattern.test(text)).slice(0, 3);
  // Only vocabulary already supplied by the owner and fixed topic labels can enter the log.
  const query = text.toLowerCase();
  const skills = profile.skills.filter((skill) => skill && query.includes(skill.toLowerCase())).slice(0, 4);
  const project = profile.projects.find(({ title }) => [title.en, title.zh].some((name) => name && query.includes(name.toLowerCase())));
  function describe(lang: "en" | "zh") {
    const zh = lang === "zh";
    const details = [...matches.map((entry) => entry[zh ? 2 : 1]), ...skills];
    if (project) details.push(project.title[lang]);
    const subject = details.join(zh ? "、" : ", ");
    if (jd) return zh ? `岗位匹配${subject ? " · " + subject : ""}` : `Job fit${subject ? " · " + subject : ""}`;
    return zh ? `询问了${subject || "简历中的其他信息"}` : `Asked about ${subject || "other résumé details"}`;
  }
  return { en: describe("en"), zh: describe("zh") };
}

async function readInsights(slug: string, env: PublishEnv): Promise<SiteInsights> {
  const stored = env.PROFILES_KV
    ? JSON.parse(await env.PROFILES_KV.get(`insights:${slug}`) ?? "null")
    : memory.get(slug);
  const current: SiteInsights = stored ?? { views: 0, questions: 0, recent: [] };
  const day = today();
  return { ...current, day, today: current.day === day ? current.today : 0 };
}

export async function recordVisit(slug: string, record: StoredProfileRecord, env: PublishEnv, question?: string) {
  await withSiteWrite(slug, "", env, async (locked) => {
    const live = await loadStoredRecord(slug, locked);
    if (!live || live.ownerEmail !== record.ownerEmail || (live.ownerEmail && live.createdAt !== record.createdAt)) return;
    const stats = await readInsights(slug, locked);
    if (question !== undefined) {
      stats.questions++;
      stats.recent = [{ at: new Date().toISOString(), summary: summarizeQuestion(question, record.profile) }, ...stats.recent].slice(0, 12);
    } else {
      stats.views++;
      stats.today++;
    }
    if (locked.PROFILES_KV) await locked.PROFILES_KV.put(`insights:${slug}`, JSON.stringify(stats));
    else memory.set(slug, stats);
  });
}

export async function deleteSiteTraffic(slug: string, env: PublishEnv) {
  if (env.PROFILES_KV) await env.PROFILES_KV.delete(`insights:${slug}`);
  else memory.delete(slug);
  await removeSiteChatUsage(slug, env);
}

export async function getSiteInsights(request: Request, slug: string, env: PublishEnv) {
  const headers = { "cache-control": "private, no-store" };
  const user = await getSessionUser(request, env);
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401, headers });
  return withSiteWrite(slug, "", env, async (locked) => {
    const record = await loadStoredRecord(slug, locked);
    if (!record) return Response.json({ error: "Site not found." }, { status: 404, headers });
    if (record.ownerEmail !== user.email) return Response.json({ error: "Owner access required." }, { status: 403, headers });
    const [{ views, today, questions, recent }, { isPro }] = await Promise.all([readInsights(slug, locked), getUserPlan(user.email, locked)]);
    return Response.json({ views, today, questions, ...(isPro ? { recent } : {}) }, { headers });
  });
}
