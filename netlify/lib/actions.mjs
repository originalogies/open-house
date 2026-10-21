import { saveRequest, listRequests } from "./requests.mjs";
import { sendUpdated, sendCancelled, sendWithdrawn } from "./email.mjs";
import { checkChange, checkCancel, dayKeyOf } from "./changes.mjs";
import { logEvent, mode, desiredFor } from "./mls.mjs";

// Cancel a pending or approved request. The MLS entry (if any) is cancelled by the sync job,
// because the request's desired MLS state becomes "nothing".
export async function cancelRequest(r, user) {
  const err = checkCancel(r, user);
  if (err) return { status: 409, error: "cannot_cancel", message: err };
  const wasApproved = r.status === "approved", byAgent = r.agent.email === user.email;
  r.status = "cancelled"; r.cancelledAt = Date.now(); r.cancelledBy = user.email; r.cancelledByName = user.name;
  r.seq = (r.seq || 0) + 1;
  // Manual mode: the team removes it from the MLS by hand, so record the MLS as matching.
  const manualMls = wasApproved && mode() === "off";
  if (manualMls) r.sync = { ...(r.sync || {}), current: null, state: "manual" };
  else if (r.sync && r.sync.state !== "booking") r.sync.state = "idle"; // MLS change pending
  await saveRequest(r);
  await logEvent(r.id, "cancelled", { note: manualMls ? "Remove it from the MLS by hand" : wasApproved ? "Queued MLS cancellation" : "Withdrawn before approval" }, user.email);
  try { await (wasApproved ? sendCancelled(r, user.name, byAgent) : sendWithdrawn(r)); }
  catch (e) { console.error("email failed", e.message); return { status: 502, error: "email_failed", message: "Cancelled, but the email failed to send." }; }
  return { status: 200, ok: true, manualMls: !!manualMls };
}

// Team moves an approved open house to a new date or hours. The sync job then sends an "update".
export async function changeRequest(r, user, next) {
  const all = await listRequests();
  const err = checkChange(r, next, all);
  if (err) return { status: 409, error: "cannot_change", message: err };
  const before = { iso: r.iso, from: r.from, to: r.to };
  Object.assign(r, { iso: next.iso, day: dayKeyOf(next.iso), from: next.from, to: next.to });
  r.seq = (r.seq || 0) + 1;
  r.reminderSent = false; // the reminder goes out again for the new date
  (r.history ||= []).push({ at: Date.now(), by: user.email, before, after: { iso: r.iso, from: r.from, to: r.to } });
  // Manual mode: the team updates the MLS by hand, so record the MLS as matching.
  const manualMls = mode() === "off";
  if (manualMls) r.sync = { ...(r.sync || {}), current: desiredFor(r), state: "manual" };
  else if (r.sync && r.sync.state !== "booking") r.sync.state = "idle"; // MLS change pending
  await saveRequest(r);
  await logEvent(r.id, "changed", { before, after: { iso: r.iso, from: r.from, to: r.to }, note: manualMls ? "Update the MLS by hand" : "Queued MLS update" }, user.email);
  try { await sendUpdated(r, before, user.name); }
  catch (e) { console.error("email failed", e.message); return { status: 502, error: "email_failed", message: "Changed, but the email failed to send." }; }
  return { status: 200, ok: true, manualMls };
}
