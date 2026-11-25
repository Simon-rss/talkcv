import { normalizeContacts } from "../lib/contacts.mjs";
import { getSiteUrl } from "../lib/profile";
import { getClientIp } from "../lib/request-ip";
import { getSessionUser, hmacHex, sendEmail, type AuthEnv } from "./auth";
import { getUserPlan } from "./billing";
import { getEncryptionMasterKey, loadStoredRecord, withSiteWrite } from "./publish";
import { siteUnlocked } from "./site-access";

export interface RecruiterLead {
  id: string;
  name: string;
  company: string;
  contact: string;
  note: string;
  createdAt: string;
}

export type LeadView =
  | { count: number; locked: true; preview: Pick<RecruiterLead, "company" | "createdAt">[] }
  | { count: number; locked: false; leads: RecruiterLead[] };

interface Inbox {
  count: number;
  recent: RecruiterLead[];
  window: number;
  submissions: Record<string, number>;
}

const memory = new Map<string, Inbox>();
const headers = { "cache-control": "private, no-store" };
const error = (status: number, message: string) => Response.json({ error: message }, { status, headers });

async function readInbox(slug: string, env: AuthEnv): Promise<Inbox> {
  const saved = env.PROFILES_KV ? JSON.parse(await env.PROFILES_KV.get(`leads:${slug}`) ?? "null") : memory.get(slug);
  return saved ?? { count: 0, recent: [], window: 0, submissions: {} };
}

export async function deleteLeads(slug: string, env: AuthEnv) {
  if (env.PROFILES_KV) await env.PROFILES_KV.delete(`leads:${slug}`);
  else memory.delete(slug);
}

export async function countLeads(env: AuthEnv) {
  const store = env.PROFILES_KV;
  if (!store) return Array.from(memory.values()).reduce((sum, inbox) => sum + inbox.count, 0);
  if (store.listPrefix) {
    const rows = await store.listPrefix("leads:", 50000);
    return rows.reduce((sum, row) => sum + (JSON.parse(row.value) as Inbox).count, 0);
  }
  let total = 0;
  let cursor: string | undefined;
  if (store.list) do {
    const page = await store.list({ prefix: "leads:", cursor });
    const counts = await Promise.all(page.keys.map(async ({ name }) => (await readInbox(name.slice(6), env)).count));
    total += counts.reduce((sum, n) => sum + n, 0);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return total;
}

function parseLead(body: Record<string, unknown> | null) {
  if (!body || typeof body !== "object") return null;
  const limits = { name: 80, company: 120, contact: 160, note: 1000 };
  const fields = { name: "", company: "", contact: "", note: "" };
  for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
    const value = body[key] ?? "";
    if (typeof value !== "string" || value.length > limits[key]) return null;
    fields[key] = value.trim();
  }
  const contact = fields.contact;
  if (!normalizeContacts({ email: contact }).email && !/^[a-z0-9_-]+$/i.test(contact)) return null;
  return fields;
}

export async function handleLeads(request: Request, slug: string, env: AuthEnv, ctx?: { waitUntil(task: Promise<unknown>): void }) {
  if (request.method === "GET") {
    const user = await getSessionUser(request, env);
    if (!user) return error(401, "Sign in first.");
    return withSiteWrite(slug, "", env, async (locked) => {
      const record = await loadStoredRecord(slug, locked);
      if (!record) return error(404, "Site not found.");
      if (record.ownerEmail !== user.email) return error(403, "Owner access required.");
      const [{ count, recent }, { isPro }] = await Promise.all([readInbox(slug, locked), getUserPlan(user.email, locked)]);
      const view: LeadView = isPro ? { count, locked: false, leads: recent } :
        { count, locked: true, preview: recent.map(({ company, createdAt }) => ({ company, createdAt })) };
      return Response.json(view, { headers });
    });
  }
  if (request.method !== "POST") return error(405, "Method not allowed.");
  const fields = parseLead(await request.json().catch(() => null));
  const result = await withSiteWrite(slug, "", env, async (locked) => {
    const record = await loadStoredRecord(slug, locked, { includeMedia: false });
    if (!record) return error(404, "Site not found.");
    if (!await siteUnlocked(request, slug, record.passcode)) return error(401, "Unlock the site first.");
    if (!fields) return error(400, "Enter a valid WeChat ID or email and check field lengths.");
    const inbox = await readInbox(slug, locked);
    const window = Math.floor(Date.now() / 600_000);
    const ip = getClientIp(request, locked);
    const sender = await hmacHex(getEncryptionMasterKey(locked), `lead:${slug}:${window}:${ip}`);
    const submissions = inbox.window === window ? inbox.submissions : {};
    if ((submissions[sender] ?? 0) >= 3) return error(429, "Too many submissions. Try again in 10 minutes.");
    const lead: RecruiterLead = { ...fields, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    const next: Inbox = { count: inbox.count + 1, recent: [lead, ...inbox.recent.slice(0, 49)],
      window, submissions: { ...submissions, [sender]: (submissions[sender] ?? 0) + 1 } };
    if (locked.PROFILES_KV) await locked.PROFILES_KV.put(`leads:${slug}`, JSON.stringify(next));
    else memory.set(slug, next);
    return { owner: record.ownerEmail, lead };
  });
  if (result instanceof Response) return result;
  if (result.owner && env.RESEND_API_KEY?.trim()) {
    const from = [result.lead.name, result.lead.company].filter(Boolean).join(" · ") || "招聘访客 / Recruiter";
    const notification = sendEmail(env, result.owner, `TalkCV · 新的约面线索 / New recruiter lead · ${slug}`,
      `${from} 给你留下了一条约面线索。\n${from} left you a recruiter lead.\n\n前往工作台查看 / View in Studio: ${getSiteUrl()}/create?handle=${slug}`)
      .then((sent) => { if (!sent) console.warn("TalkCV recruiter lead notification delivery failed."); });
    if (ctx) ctx.waitUntil(notification);
    else await notification;
  }
  return Response.json({ ok: true }, { status: 201, headers });
}
