import { getStore } from "@netlify/blobs";
import { previewBox, SITE } from "./email.mjs";
import { fmtRange } from "./time.mjs";
import { logEvent } from "./mls.mjs";

// Text messages to the hosting agent, sent through Quo (formerly OpenPhone) from the team's Quo number alongside
// the Reminder email and the feedback emails. Off until QUO_API_KEY is set in Netlify (Quo: Settings > API).
// Quo needs the number's US carrier registration approved, or every text fails ("A2P Registration Not Approved").
// An agent who replies STOP is opted out by Quo, and texts to them fail from then on; their emails still go.
// Replies land in the team's Quo inbox.
export const QUO_FROM = process.env.QUO_FROM_NUMBER || "+18174108769";
const QUO_URL = "https://api.quo.com/v1/messages";
// The key as pasted into Netlify can bring a space, quotes or "Bearer " along from wherever it was copied; Quo
// wants the key alone.
const quoKey = () => String(process.env.QUO_API_KEY || "").trim().replace(/^["']+|["']+$/g, "").replace(/^Bearer\s+/i, "").trim();
export const textsOn = () => !!quoKey();

// "(817) 555-0100", "817.555.0100", "+1 817 555 0100" -> "+18175550100". Anything else isn't a US mobile: null.
export function toE164(s) {
  const d = String(s || "").replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d[0] === "1") return `+${d}`;
  return null;
}
export const fmtPhone = (e) => String(e || "").replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3");

// ---- agents' mobile numbers --------------------------------------------------------------------------------
// The agent roster: active agents with a mobile number, from the AGENTS tab of the team's "SYNERGY Database"
// Google Sheet (Full Name, Synergy Status, Phone, Work Email, Personal Email). It's loaded by hand into the
// open-house-agents store as "roster": { updatedAt, source, agents: [{ name, phone, emails }] }.
const agentStore = () => getStore({ name: "open-house-agents", consistency: "strong" });
export const getRoster = async () => (await agentStore().get("roster", { type: "json" })) || { agents: [] };
export const saveRoster = (roster) => agentStore().setJSON("roster", roster);

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
// The roster agent for someone who signed in as { email, name }: by work or personal email, else by full name when
// exactly one agent has it (an agent may sign in with an email the roster doesn't list).
export function rosterMatch(roster, who) {
  const email = String(who?.email || "").trim().toLowerCase();
  const byEmail = roster.agents.find((a) => a.emails.includes(email));
  if (byEmail) return byEmail;
  const named = roster.agents.filter((a) => norm(a.name) && norm(a.name) === norm(who?.name));
  return named.length === 1 ? named[0] : null;
}
export const phoneFor = async (who) => rosterMatch(await getRoster(), who)?.phone || null;

// ---- the texts ----------------------------------------------------------------------------------------------
// Short and plain (no curly quotes or emoji) so each stays one or two segments. They name the sender, as carriers
// expect, and end with the opt-out. Access details are never texted: they stay in the emails.
const feedbackUrl = (r) => `${r.site || SITE}/feedback/?id=${r.id}`;
export const TEXTS = {
  reminder: {
    label: "reminder",
    body: (r) => `George & Noonan: Reminder, you're hosting the open house at ${r.listing.addr} tomorrow, ${fmtRange(r.from, r.to)}. Your access details are in your email. Reply STOP to opt out.`,
  },
  feedbackAsk: {
    label: "feedback request",
    body: (r) => `George & Noonan: Thanks for hosting the open house at ${r.listing.addr}! Tell us how it went: ${feedbackUrl(r)} Reply STOP to opt out.`,
  },
  feedbackRemind: {
    label: "feedback reminder",
    body: (r) => `George & Noonan: We haven't had your feedback on the open house at ${r.listing.addr} yet. It takes a couple of minutes: ${feedbackUrl(r)} Reply STOP to opt out.`,
  },
};

// Sends one text through Quo. Inside capture() (previews) it's kept instead of sent. Throws with Quo's reason.
export async function sendText(to, content) {
  const box = previewBox();
  if (box) { box.sent.push({ text: true, to, content }); return null; }
  const key = quoKey();
  if (!key) throw new Error("QUO_API_KEY is not set");
  const res = await fetch(QUO_URL, {
    method: "POST",
    headers: { authorization: key, "content-type": "application/json" },
    body: JSON.stringify({ content, from: QUO_FROM, to: [to] }),
  });
  if (!res.ok) {
    // Quo answers {"error": {"message": ...}} (a wrong key) or {"title", "message", "code"} (an opted-out number).
    const j = await res.json().catch(() => ({}));
    const why = j.error?.message || j.title || j.message || "";
    throw Object.assign(new Error(`Quo ${res.status}${why ? `: ${why}` : ""}`), { status: res.status });
  }
  return (await res.json().catch(() => ({}))).data || null;
}

// Texts the agent hosting this open house, when texts are on and the roster has their number. Never throws: a text
// that fails is written to the request's history (and the console), and the email it goes with has already gone.
// Returns "sent", "failed", or null when there was nothing to send.
export async function textAgent(r, kind) {
  if (!textsOn()) return null;
  const t = TEXTS[kind];
  const to = await phoneFor(r.agent).catch(() => null);
  if (!to) return null;
  try {
    await sendText(to, t.body(r));
    await logEvent(r.id, "text_sent", { note: `Texted ${r.agent.name} the ${t.label} at ${fmtPhone(to)}` });
    return "sent";
  } catch (e) {
    console.error("text failed", r.id, kind, e.message);
    await logEvent(r.id, "text_failed", { note: `The ${t.label} text to ${r.agent.name} at ${fmtPhone(to)} didn't send (${e.message})` });
    return "failed";
  }
}
