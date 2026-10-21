import { json } from "../lib/shared.mjs";
import { getRequest, saveRequest } from "../lib/requests.mjs";
import { sendTeamAlert } from "../lib/email.mjs";
import { verify, applyResult, RESULTS, getInflight, clearInflight, logEvent, saveScreenshot } from "../lib/mls.mjs";

// POST /api/mls/callback, called by the MLS bot when a job finishes.
// Signed like our webhooks: X-OH-Timestamp + X-OH-Signature (HMAC-SHA256 of `${ts}.${body}`).
// Body: { request_id, job_id, result, message?, screenshot_base64? }
// result: booked | updated | cancelled | already_done | dry_run | needs_login | failed
export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  const raw = await req.text();
  if (raw.length > 6 * 1024 * 1024) return json(413, { error: "too_large" }); // Netlify rejects request bodies over 6 MB anyway
  if (!verify(req.headers.get("x-oh-timestamp"), req.headers.get("x-oh-signature"), raw)) return json(401, { error: "bad_signature" });

  const b = (() => { try { return JSON.parse(raw); } catch { return null; } })();
  if (!b || !RESULTS.includes(b.result)) return json(400, { error: "invalid_body" });
  const r = await getRequest(String(b.request_id || ""));
  if (!r) return json(404, { error: "not_found" });

  const out = applyResult(r, b);
  if (out.ignored) return json(200, { ok: true, ignored: true }); // stale or repeated callback; nothing to do
  if (b.screenshot_base64) {
    const key = await saveScreenshot(r.id, b.job_id, b.screenshot_base64).catch(() => null);
    if (key) r.sync.job.screenshot = key;
  }
  await saveRequest(r);

  const inflight = await getInflight();
  if (inflight?.jobId === b.job_id) await clearInflight(); // lets the next job go out

  await logEvent(r.id, `mls_${b.result}`, { jobId: b.job_id, action: r.sync.job.action, screenshot: r.sync.job.screenshot || null, note: r.sync.message });
  if (out.state === "failed" || out.state === "needs_login") {
    await sendTeamAlert(r, out.state === "needs_login" ? "sign-in needed" : "booking failed", r.sync.message || b.result)
      .catch((e) => console.error("alert failed", e.message));
  }
  return json(200, { ok: true, state: out.state });
};
export const config = { path: "/api/mls/callback" };
