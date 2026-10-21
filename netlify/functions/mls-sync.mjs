import crypto from "node:crypto";
import { listRequests, getRequest, saveRequest } from "../lib/requests.mjs";
import { sendTeamAlert } from "../lib/email.mjs";
import { chicagoToUtc } from "../lib/time.mjs";
import {
  mode, needsDispatch, buildPayload, postWebhook, deliveryBackoff, STALL_MS, MAX_DELIVERY,
  getInflight, setInflight, clearInflight, logEvent,
} from "../lib/mls.mjs";

// Runs every minute. Sends at most one MLS job to the bot at a time, so parallel runs never
// share the NTREIS login. A job is needed whenever what the MLS should show for a request
// differs from what the bot last confirmed (see lib/mls.mjs).
export default async () => {
  if (mode() === "off") return;
  const now = Date.now();

  // 1. A job is already out. Wait for its callback, unless it has stalled.
  const inflight = await getInflight();
  if (inflight) {
    if (now - inflight.sentAt < STALL_MS) return;
    const r = await getRequest(inflight.requestId);
    if (r?.sync?.job?.id === inflight.jobId && !r.sync.job.done) {
      Object.assign(r.sync.job, { done: true, finishedAt: now, result: "stalled" });
      r.sync.state = "failed"; r.sync.message = "No result from the MLS bot within 30 minutes.";
      await saveRequest(r);
      await logEvent(r.id, "mls_stalled", { jobId: inflight.jobId, note: r.sync.message });
      await sendTeamAlert(r, "booking stalled", r.sync.message).catch((e) => console.error("alert failed", e.message));
    }
    await clearInflight();
  }

  // 2. Pick the request whose open house starts soonest among those that need a job.
  const due = (await listRequests())
    .map((r) => ({ r, d: needsDispatch(r, now) }))
    .filter((x) => x.d)
    .sort((a, b) => chicagoToUtc(a.r.iso, a.r.from) - chicagoToUtc(b.r.iso, b.r.from));
  if (!due.length) return;
  const { r, d } = due[0];

  // 3. Record the job before sending, so a fast callback finds it.
  const jobId = `job_${crypto.randomBytes(8).toString("hex")}`;
  r.sync = { ...(r.sync || {}), state: "booking", job: { id: jobId, action: d.action, key: d.key, from: d.from, to: d.to, sentAt: now, done: false } };
  await saveRequest(r);
  await setInflight({ requestId: r.id, jobId, sentAt: now });

  const payload = buildPayload(r, d, jobId);
  try {
    await postWebhook(payload, now);
    r.sync.delivery = null;
    await saveRequest(r);
    await logEvent(r.id, "mls_job_sent", { jobId, action: d.action, dryRun: payload.dry_run, note: `${d.action}${payload.dry_run ? " (dry run)" : ""} sent to the MLS bot` });
  } catch (e) {
    // Delivery failed: nothing reached the bot, so it is safe to send again later.
    const attempts = (r.sync.delivery?.key === d.key ? r.sync.delivery.attempts : 0) + 1;
    r.sync.delivery = { key: d.key, attempts, nextTryAt: now + deliveryBackoff(attempts) };
    if (attempts >= MAX_DELIVERY) {
      Object.assign(r.sync.job, { done: true, finishedAt: now, result: "delivery_failed" });
      r.sync.state = "failed"; r.sync.message = `Could not reach the MLS bot after ${attempts} tries: ${e.message}`;
    } else {
      r.sync.job = null; r.sync.state = "idle";
    }
    await saveRequest(r);
    await clearInflight();
    await logEvent(r.id, "mls_delivery_failed", { attempts, note: e.message.slice(0, 300) });
    if (attempts >= MAX_DELIVERY) await sendTeamAlert(r, "bot unreachable", r.sync.message).catch((x) => console.error("alert failed", x.message));
  }
};
export const config = { schedule: "* * * * *" };
