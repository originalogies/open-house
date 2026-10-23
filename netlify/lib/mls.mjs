import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";
import { SITE } from "./email.mjs";
import { chicagoToUtc, fmtHour } from "./time.mjs";
import { isMlsNumber } from "./homes.mjs";

// ---- MLS sync: "desired state" model ---------------------------------------
// Each request carries r.sync = {   (r.mls is the MLS number, so sync state lives in r.sync)
//   current: { iso, from, to, type } | null   what the bot last verified is on the MLS
//   state:   "idle" | "booking" | "synced" | "failed" | "needs_login" | "dry_run_ok" | "manual"
//   job:     { id, action, key, from, to, sentAt, done } | null   the most recent job sent to the bot
//   delivery: { attempts, nextTryAt }          webhook delivery retries (not bot failures)
//   message: last message from the bot
// }
// The app never edits the MLS itself. When what the MLS *should* show (desired) differs from what
// the bot last confirmed (current), the sync job sends one webhook to the bot.

export const MODES = ["off", "dry_run", "live"];
// off: nothing is sent; the team enters the MLS by hand (approve page keeps the "entered on MLS" box).
// dry_run: webhooks are sent with dry_run: true (bot validates, then cancels). live: bot submits.
export const mode = () => (MODES.includes(process.env.MLS_BOOKING_MODE) ? process.env.MLS_BOOKING_MODE : "off");
// The AI agent (the MLS bot) can take jobs only when automation is on, its webhook is set, and there's
// a secret to make each job's callback token with.
export const agentReady = () => mode() !== "off" && !!process.env.GROKBOT_WEBHOOK_URL && (process.env.MLS_WEBHOOK_SECRET || "").length >= 32;
// On the approve page the team chooses, per request, to enter the open house on the MLS by hand
// (r.mlsMethod "manual") or to schedule it with the AI agent ("agent"). With automation off, all by hand.
export const byHand = (r) => mode() === "off" || r.mlsMethod === "manual";

export const OH_TYPE = "Public";
const STALL_MS = 30 * 60 * 1000;       // no result from the bot in 30 minutes = stalled
const MAX_DELIVERY = 3;                 // webhook delivery attempts before giving up

// What the MLS should show for this request: an open house while approved or being approved with the
// AI agent (r.approving: the request waits until the AI agent reports it's on the MLS), nothing otherwise.
export const desiredFor = (r) => (r.status === "approved" || (r.status === "pending" && r.approving)
  ? { iso: r.iso, from: r.from, to: r.to, type: OH_TYPE } : null);
export const keyOf = (e) => (e ? `${e.iso}|${e.from}|${e.to}|${e.type}` : "none");

// Job needed to make the MLS match, or null when it already matches.
export function nextAction(r) {
  const cur = r.sync?.current || null, want = desiredFor(r);
  if (keyOf(cur) === keyOf(want)) return null;
  if (!cur) return "add";
  if (!want) return "cancel";
  return "update";
}

const hh = (h) => `${String(h).padStart(2, "0")}:00`;
const ended = (e, now) => !!e && now >= chicagoToUtc(e.iso, e.to).getTime();

// Should the sync job send something for this request right now?
export function needsDispatch(r, now = Date.now(), runMode = mode()) {
  if (runMode === "off") return null;
  if (!isMlsNumber(r.mls)) return null; // a team-added home not linked to its MLS listing yet
  if (r.mlsMethod === "manual") return null; // the team keeps this one in step on the MLS by hand
  const action = nextAction(r);
  if (!action) return null;
  const m = r.sync || {};
  const want = desiredFor(r), cur = m.current || null;
  // Nothing to do for open houses that are already over.
  if (action === "add" && ended(want, now)) return null;
  if (action === "cancel" && ended(cur, now)) return null;
  if (action === "update" && ended(want, now) && ended(cur, now)) return null;
  const key = `${runMode}:${action}:${keyOf(cur)}>${keyOf(want)}`; // switching dry_run -> live re-sends
  if (m.job && !m.job.done && m.job.key === key) return null;              // already in flight
  // A finished job for this exact change that failed, needed a login, or was a dry run waits for the team.
  if (m.job && m.job.done && m.job.key === key && ["failed", "needs_login", "dry_run_ok"].includes(m.state)) return null;
  if (m.delivery?.key === key && m.delivery.nextTryAt && now < m.delivery.nextTryAt) return null;
  return { action, key, from: cur, to: want };
}

// One job for the bot (postWebhook sends it as { items: [job] }). Documented in docs/MLS_AUTOMATION.md.
// `d` is what needsDispatch returned: { action, from (MLS now), to (MLS wanted) }.
// Times go both as 24-hour "13:00" (start/end) and as the "1:00 PM" Grokbot reads (start_time/end_time).
// The bot calls back the site the request was made on, so a local copy gets its own callbacks;
// MLS_CALLBACK_URL overrides that (e.g. a tunnel to a local copy, since a remote bot can't reach localhost).
export function buildPayload(r, d, jobId, { dryRun = mode() !== "live", site = r.site || SITE } = {}) {
  const l = r.listing, { action, from: cur, to: want } = d;
  const target = action === "cancel" ? cur : want;
  const body = {
    request_id: r.id, job_id: jobId, action,
    mls_number: String(r.mls), address: `${l.addr}, ${l.city}, TX ${l.zip}`,
    type: target.type, date: target.iso, start: hh(target.from), end: hh(target.to),
    start_time: fmtHour(target.from), end_time: fmtHour(target.to), timezone: "America/Chicago",
    approved_by: r.decidedBy || null, approved_at: r.decidedAt ? new Date(r.decidedAt).toISOString() : null,
    dry_run: dryRun, callback_url: process.env.MLS_CALLBACK_URL || `${site}/api/mls/callback`, callback_token: callbackToken(jobId),
  };
  if (action !== "add") Object.assign(body, { original_date: cur.iso, original_start: hh(cur.from), original_end: hh(cur.to),
    original_start_time: fmtHour(cur.from), original_end_time: fmtHour(cur.to), original_type: cur.type });
  if (action === "cancel") body.remove_method = "cancel"; // set the entry to Canceled, keep the record
  return body;
}

// Result from the bot -> new MLS state for the request.
const OK = ["booked", "updated", "cancelled", "already_done"];
export const RESULTS = [...OK, "dry_run", "needs_login", "failed"];
export function applyResult(r, { job_id, result, message }, now = Date.now()) {
  const m = r.sync || (r.sync = {});
  if (!m.job || m.job.id !== job_id || m.job.done) return { ignored: true }; // stale, unknown, or repeated
  m.job.done = true; m.job.finishedAt = now; m.job.result = result; m.message = String(message || "").slice(0, 1000);
  // If the request changed while the bot was working, it is "idle" until the next job catches up.
  if (OK.includes(result)) { m.current = m.job.to || null; m.state = keyOf(m.current) === keyOf(desiredFor(r)) ? "synced" : "idle"; }
  else if (result === "dry_run") m.state = "dry_run_ok";
  else if (result === "needs_login") m.state = "needs_login";
  else m.state = "failed";
  // Being approved with the AI agent: it's approved only now that it's on the MLS. A dry run submits
  // nothing, so it doesn't count; the request keeps waiting for a retry, entry by hand, or a decline.
  if (r.status === "pending" && r.approving && m.state === "synced") {
    Object.assign(r, { status: "approved", decidedAt: now, decidedBy: r.approving.by, decidedByName: r.approving.byName });
    delete r.approving;
    return { state: m.state, approved: true };
  }
  return { state: m.state };
}

// ---- webhook signing ------------------------------------------------------
// Header X-OH-Signature: hex HMAC-SHA256 of `${timestamp}.${body}` with MLS_WEBHOOK_SECRET.
// Header X-OH-Timestamp: Unix seconds. Receivers reject anything older than 5 minutes.
function webhookSecret() {
  const s = process.env.MLS_WEBHOOK_SECRET;
  if (!s || s.length < 32) throw new Error("MLS_WEBHOOK_SECRET must be set to a random string of 32+ characters");
  return s;
}
export const sign = (ts, body) => crypto.createHmac("sha256", webhookSecret()).update(`${ts}.${body}`).digest("hex");

export function verify(ts, sig, body, now = Date.now()) {
  if (!/^\d+$/.test(String(ts || "")) || !/^[a-f0-9]{64}$/.test(String(sig || ""))) return false;
  if (Math.abs(now / 1000 - Number(ts)) > 300) return false;
  const good = sign(ts, body);
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}

// A bot that can't sign (Grokbot in Cursor holds no secret) proves its callback instead by sending back
// the callback_token that came with the job. It's made from the secret and the job ID, so it only fits
// that one job, and once the job has a result the portal ignores further callbacks for it.
export const callbackToken = (jobId) => crypto.createHmac("sha256", webhookSecret()).update(`callback:${jobId}`).digest("hex");
export function verifyCallbackToken(jobId, token) {
  if (!jobId || !/^[a-f0-9]{64}$/.test(String(token || ""))) return false;
  return crypto.timingSafeEqual(Buffer.from(String(token)), Buffer.from(callbackToken(String(jobId))));
}

// Grokbot runs as a Cursor automation: its webhook takes { items: [...] } and a Bearer token
// (GROKBOT_WEBHOOK_TOKEN), and answers { success, runUuid }. The signature headers are sent as well,
// for a receiver that can check them. Returns Cursor's run ID, if any, so the job can be traced there.
export async function postWebhook(payload, now = Date.now(), timeoutMs = 15000) {
  // The token alone ("crsr_…"): if Cursor's whole "Bearer crsr_…" header was pasted into Netlify, the prefix is dropped.
  const url = process.env.GROKBOT_WEBHOOK_URL, token = String(process.env.GROKBOT_WEBHOOK_TOKEN || "").trim().replace(/^bearer\s+/i, "");
  if (!url) throw new Error("GROKBOT_WEBHOOK_URL is not set");
  const body = JSON.stringify({ items: [payload] }), ts = String(Math.floor(now / 1000));
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json", "x-oh-timestamp": ts, "x-oh-signature": sign(ts, body), "idempotency-key": payload.job_id,
      ...(token && { authorization: `Bearer ${token}` }),
    },
    body, signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`webhook ${res.status}: ${text.slice(0, 200)}`);
  const data = (() => { try { return JSON.parse(text); } catch { return {}; } })();
  if (data.success === false) throw new Error(`webhook refused the job: ${text.slice(0, 200)}`);
  return { runId: typeof data.runUuid === "string" ? data.runUuid.slice(0, 100) : null };
}

export const deliveryBackoff = (attempts) => Math.min(30, 2 ** attempts) * 60000; // 2, 4, 8 ... minutes
export { STALL_MS, MAX_DELIVERY };

// ---- stores -----------------------------------------------------------------
const syncStore = () => getStore({ name: "open-house-mls", consistency: "strong" });
const auditStore = () => getStore({ name: "open-house-audit", consistency: "strong" }); // a request's history shows what just happened
const shotStore = () => getStore("open-house-screenshots");

// One job in flight at a time across all requests, so parallel runs never share the MLS login.
export const getInflight = () => syncStore().get("inflight", { type: "json" }).catch(() => null);
export const setInflight = (v) => syncStore().setJSON("inflight", v);
export const clearInflight = () => syncStore().delete("inflight");

// Append-only audit log: one blob per event. Never put secrets or access codes in `data`.
export async function logEvent(requestId, type, data = {}, by = null) {
  const at = new Date().toISOString();
  const key = `evt/${requestId}/${at}-${crypto.randomBytes(3).toString("hex")}`;
  await auditStore().setJSON(key, { requestId, type, at, by, ...data }).catch((e) => console.error("audit write failed", e.message));
}
export async function listEvents(requestId) {
  const s = auditStore();
  const { blobs } = await s.list({ prefix: `evt/${requestId}/` });
  const all = await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })));
  return all.filter(Boolean).sort((a, b) => a.at.localeCompare(b.at));
}

export const MAX_SHOT_BYTES = 4 * 1024 * 1024; // 4 MB of image is about 5.4 MB as base64, under Netlify's 6 MB request limit
export async function saveScreenshot(requestId, jobId, base64) {
  const buf = Buffer.from(String(base64 || ""), "base64");
  if (!buf.length || buf.length > MAX_SHOT_BYTES) return null;
  const isPng = buf.subarray(0, 4).toString("hex") === "89504e47", isJpg = buf.subarray(0, 2).toString("hex") === "ffd8";
  if (!isPng && !isJpg) return null;
  const key = `shot/${requestId}/${jobId}.${isPng ? "png" : "jpg"}`;
  await shotStore().set(key, buf, { metadata: { type: isPng ? "image/png" : "image/jpeg" } });
  return key;
}
export const getScreenshot = (key) => shotStore().getWithMetadata(key, { type: "arrayBuffer" });
