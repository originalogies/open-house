import { json } from "../lib/shared.mjs";
import { getRequest, saveRequest } from "../lib/requests.mjs";
import { sendTeamAlert, sendConfirmed } from "../lib/email.mjs";
import { verify, verifyCallbackToken, applyResult, RESULTS, getInflight, clearInflight, logEvent, saveScreenshot } from "../lib/mls.mjs";

// POST /api/mls/callback, called by the MLS bot when a job finishes.
// Body: { request_id, job_id, callback_token, result, message?, screenshot_base64? }
// result: booked | updated | cancelled | already_done | dry_run | needs_login | failed
// Proven either by callback_token (sent with the job; how Grokbot does it) or by signing like our
// webhooks: X-OH-Timestamp + X-OH-Signature (HMAC-SHA256 of `${ts}.${body}`).
export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  const raw = await req.text();
  if (raw.length > 6 * 1024 * 1024) return json(413, { error: "too_large" }); // Netlify rejects request bodies over 6 MB anyway

  const b = (() => { try { return JSON.parse(raw); } catch { return null; } })();
  const proven = verifyCallbackToken(b?.job_id, b?.callback_token) || verify(req.headers.get("x-oh-timestamp"), req.headers.get("x-oh-signature"), raw);
  if (!proven) return json(401, { error: "unauthorized", message: "Send the job's callback_token with the result." });
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
  // Approved with the AI agent: now that it's on the MLS, it's approved and the agent gets the confirmation.
  if (out.approved) {
    await logEvent(r.id, "approved", { note: `On the MLS, so it's approved. ${r.agent.name} was emailed the confirmation.` }, r.decidedBy);
    try { await sendConfirmed(r); }
    catch (e) {
      console.error("email failed", e.message);
      r.confirmEmailFailed = true; await saveRequest(r); // the request page tells the team to let the agent know
      await sendTeamAlert(r, "confirmation email failed", `It's on the MLS and approved, but the email to ${r.agent.name} didn't send. Let them know directly.`).catch(() => {});
    }
  }
  if (out.state === "failed" || out.state === "needs_login") {
    await sendTeamAlert(r, out.state === "needs_login" ? "sign-in needed" : "booking failed", r.sync.message || b.result)
      .catch((e) => console.error("alert failed", e.message));
  }
  return json(200, { ok: true, state: out.state });
};
export const config = { path: "/api/mls/callback" };
