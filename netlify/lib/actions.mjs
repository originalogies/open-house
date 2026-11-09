import { saveRequest, listRequests, holdsSlot, overlaps } from "./requests.mjs";
import { sendUpdated, sendCancelled, sendWithdrawn, sendCancelRequested, sendCancelKept, sendConfirmed } from "./email.mjs";
import { checkChange, checkCancel, checkCancelRequest, openCancelRequest, dayKeyOf } from "./changes.mjs";
import { logEvent, mode, byHand, desiredFor, agentReady } from "./mls.mjs";
import { mlsOpenHouses, getInfo, saveInfo } from "./listings.mjs";
import { saveHome, mergeInfo, isMlsNumber } from "./homes.mjs";
import { dayMeta } from "./week.mjs";
import { fmtRange, chicagoToUtc } from "./time.mjs";

// Team approves a pending request: from its request page (POST /api/respond), or as it's added for an agent
// (team-new-request.mjs, with `all` already read and an `added` note). To approve a home that's on the MLS the
// team picks how it goes on the MLS: method "manual" (they entered it by hand and tick mlsEntered) or "agent" (the
// AI agent enters it). With the AI agent the request keeps waiting, its hours held, until the AI agent reports the
// open house is on the MLS; then it's approved and the agent emailed (mls-callback.mjs). A team-added home that
// isn't on the MLS yet has nothing to enter. Returns { status, body } for the response.
export async function approveRequest(r, user, { method: how, mlsEntered } = {}, { all = null, added = "" } = {}) {
  const fail = (status, error, message) => ({ status, body: { error, message } });
  const onMls = isMlsNumber(r.mls);
  const method = how === "agent" ? "agent" : how === "manual" || mlsEntered === true ? "manual" : null;
  if (onMls && !method) return fail(400, "method_required", "Choose how this open house goes on the MLS first.");
  if (onMls && method === "manual" && mlsEntered !== true) return fail(400, "mls_required", "Confirm the open house is entered on the MLS first.");
  if (onMls && method === "agent" && !agentReady()) return fail(409, "agent_unavailable", "The AI agent isn't connected yet. Enter this open house on the MLS by hand.");
  if (onMls && method === "agent" && r.approving) return fail(409, "already_approving", "This request is already being approved with the AI agent.");
  if ((all || (await listRequests())).some((x) => x.id !== r.id && holdsSlot(x) && overlaps(x, r))) {
    return fail(409, "taken", "Another request already holds those hours.");
  }
  const note = (s) => [added, s].filter(Boolean).join(". ");
  const quiet = r.sendEmails === false; // the team turned off email confirmations when adding it (team-new-request.mjs)
  if (onMls && method === "agent") {
    r.mlsMethod = "agent"; r.approving = { at: Date.now(), by: user.email, byName: user.name };
    r.sync = { current: null, state: "idle" };
    await saveRequest(r);
    await logEvent(r.id, "approving", { note: note(`Approved once the AI agent has it on the MLS${mode() === "dry_run" ? ". Dry run: it fills in the form but doesn't submit, so it won't be approved this way" : ""}. ${quiet ? "Nobody is emailed: email confirmations are off" : `${r.agent.name} is emailed then`}`) }, user.email);
    return { status: 200, body: { ok: true, status: "pending", approving: true } };
  }
  r.status = "approved";
  r.decidedAt = Date.now(); r.decidedBy = user.email; r.decidedByName = user.name;
  const wasApproving = !!r.approving; delete r.approving; // entered by hand after trying the AI agent
  // By hand: the team already entered it, so the MLS matches. A home not on the MLS yet has nothing to enter.
  if (onMls) r.mlsMethod = method;
  r.sync = !onMls ? { current: null, state: "not_on_mls" } : { current: desiredFor(r), state: "manual" };
  await saveRequest(r); // single use: status is no longer pending
  const entered = !onMls ? "Home isn't on the MLS yet" : wasApproving ? "Entered on the MLS by hand instead of the AI agent" : "Entered on the MLS by hand";
  await logEvent(r.id, "approved", { note: note(quiet ? `${entered}. No emails were sent` : entered) }, user.email);
  if (quiet) return { status: 200, body: { ok: true, status: r.status } };
  try { await sendConfirmed(r); }
  catch (e) { console.error("email failed", e.message); return fail(502, "email_failed", "Saved, but the email to the agent failed to send."); }
  return { status: 200, body: { ok: true, status: r.status } };
}

// Team cancels a pending or approved request, on its own or because the agent asked. The MLS entry
// (if any) is cancelled by the sync job, because the request's desired MLS state becomes "nothing".
export async function cancelRequest(r, user) {
  const err = checkCancel(r, user);
  if (err) return { status: 409, error: "cannot_cancel", message: err };
  const wasApproved = r.status === "approved", asked = openCancelRequest(r);
  r.status = "cancelled"; r.cancelledAt = Date.now(); r.cancelledBy = user.email; r.cancelledByName = user.name;
  if (asked) Object.assign(r.cancelRequest, { outcome: "approved", decidedAt: r.cancelledAt, decidedBy: user.email, decidedByName: user.name });
  r.seq = (r.seq || 0) + 1;
  // Entered by hand: the team removes it from the MLS by hand, so record the MLS as matching.
  // A team-added home that isn't on the MLS yet has nothing to remove.
  const onMls = isMlsNumber(r.mls), manualMls = wasApproved && onMls && byHand(r);
  if (!onMls) r.sync = { ...(r.sync || {}), current: null, state: "not_on_mls" };
  else if (manualMls) r.sync = { ...(r.sync || {}), current: null, state: "manual" };
  else if (r.sync && r.sync.state !== "booking") r.sync.state = "idle"; // MLS change pending
  await saveRequest(r);
  const note = [asked && "At the agent's request", manualMls ? "Remove it from the MLS by hand" : wasApproved ? "Queued MLS cancellation" : "Withdrawn before approval"].filter(Boolean).join(". ");
  await logEvent(r.id, "cancelled", { note }, user.email);
  try { await (wasApproved ? sendCancelled(r, user.name, asked) : sendWithdrawn(r, user.name, asked)); }
  catch (e) { console.error("email failed", e.message); return { status: 502, error: "email_failed", message: "Cancelled, but the email failed to send." }; }
  return { status: 200, ok: true, manualMls: !!manualMls };
}

// Agent asks the team to cancel. Nothing changes until the team approves it (cancelRequest)
// or keeps the open house (keepRequest); the team gets an email like a new booking request.
export async function requestCancellation(r, user, reason = "") {
  const err = checkCancelRequest(r, user);
  if (err) return { status: 409, error: "cannot_request_cancel", message: err };
  r.cancelRequest = { at: Date.now(), by: user.email, byName: user.name, reason: String(reason || "").trim().slice(0, 500) };
  await saveRequest(r);
  await logEvent(r.id, "cancel_requested", { note: r.cancelRequest.reason }, user.email);
  try { await sendCancelRequested(r); }
  catch (e) { console.error("email failed", e.message); return { status: 502, error: "email_failed", message: "Your request was saved, but the email to the team failed to send. Let them know directly." }; }
  return { status: 200, ok: true };
}

// Link a team-added home to its MLS listing once it's on the MLS. The team's settings (published,
// Priority, days, instructions, access details) and the home's requests move to the MLS number.
// Approved open houses then go to the MLS bot; with automation off, the team is told which ones
// to enter on the MLS by hand.
export async function linkHome(home, mls, user) {
  const [homeInfo, mlsInfo] = await Promise.all([getInfo(home.id), getInfo(mls)]);
  await saveInfo(mls, mergeInfo(homeInfo, mlsInfo));
  const manual = mode() === "off", now = Date.now(), enterByHand = [];
  let moved = 0;
  for (const r of (await listRequests()).filter((x) => x.mls === home.id)) {
    r.mls = mls; r.listing = { ...r.listing, mls }; delete r.listing.teamAdded;
    const upcoming = r.status === "approved" && chicagoToUtc(r.iso, r.to).getTime() > now;
    if (r.status === "approved") r.sync = manual ? { current: desiredFor(r), state: "manual" } : { current: null, state: "idle" }; // idle: the bot adds it
    if (upcoming && manual) enterByHand.push(`${dayMeta(r.iso).label}, ${dayMeta(r.iso).date}, ${fmtRange(r.from, r.to)} (${r.agent.name})`);
    await saveRequest(r);
    await logEvent(r.id, "linked", { note: `Home linked to MLS# ${mls}${upcoming ? (manual ? ". Enter this open house on the MLS by hand" : ". Queued for the MLS bot") : ""}` }, user.email);
    moved++;
  }
  Object.assign(home, { linkedMls: mls, linkedAt: now, linkedBy: user.email });
  await saveHome(home);
  return { status: 200, ok: true, moved, enterByHand };
}

// Team turns down the agent's cancellation request; the open house stays as it is.
export async function keepRequest(r, user) {
  if (!openCancelRequest(r)) return { status: 409, error: "no_cancel_request", message: "There's no cancellation request to answer." };
  Object.assign(r.cancelRequest, { outcome: "kept", decidedAt: Date.now(), decidedBy: user.email, decidedByName: user.name });
  await saveRequest(r);
  await logEvent(r.id, "cancel_kept", {}, user.email);
  try { await sendCancelKept(r, user.name); }
  catch (e) { console.error("email failed", e.message); return { status: 502, error: "email_failed", message: "Kept, but the email to the agent failed to send." }; }
  return { status: 200, ok: true };
}

// Team moves an approved open house to a new date or hours. The sync job then sends an "update".
export async function changeRequest(r, user, next) {
  const all = await listRequests();
  // Open houses entered on the MLS outside the portal. If Repliers can't be reached the change still
  // goes through (the MLS bot also stops on an overlapping entry), but the team is told it wasn't checked.
  let external = [], warning = null;
  try { external = await mlsOpenHouses(r.mls); }
  catch (e) { console.error("Repliers check failed", e.message); warning = "Couldn't check the MLS for other open houses at that time. Double-check the listing."; }
  const err = checkChange(r, next, all, Date.now(), external);
  if (err) return { status: 409, error: "cannot_change", message: err };
  const before = { iso: r.iso, from: r.from, to: r.to };
  Object.assign(r, { iso: next.iso, day: dayKeyOf(next.iso), from: next.from, to: next.to });
  r.seq = (r.seq || 0) + 1;
  r.reminderSent = false; // the reminder goes out again for the new date
  (r.history ||= []).push({ at: Date.now(), by: user.email, before, after: { iso: r.iso, from: r.from, to: r.to } });
  // Entered by hand: the team updates the MLS by hand, so record the MLS as matching.
  // A team-added home that isn't on the MLS yet has nothing to update there.
  const onMls = isMlsNumber(r.mls), manualMls = onMls && byHand(r);
  if (!onMls) r.sync = { ...(r.sync || {}), current: null, state: "not_on_mls" };
  else if (manualMls) r.sync = { ...(r.sync || {}), current: desiredFor(r), state: "manual" };
  else if (r.sync && r.sync.state !== "booking") r.sync.state = "idle"; // MLS change pending
  await saveRequest(r);
  await logEvent(r.id, "changed", { before, after: { iso: r.iso, from: r.from, to: r.to }, note: [manualMls ? "Update the MLS by hand" : "Queued MLS update", warning].filter(Boolean).join(". ") }, user.email);
  try { await sendUpdated(r, before, user.name); }
  catch (e) { console.error("email failed", e.message); return { status: 502, error: "email_failed", message: ["Changed, but the email failed to send.", warning].filter(Boolean).join(" ") }; }
  return { status: 200, ok: true, manualMls, ...(warning && { message: warning }) };
}
