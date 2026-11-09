import * as E from "./email.mjs";
import { listRequests } from "./requests.mjs";
import { weekSatOf, dayKeyOf } from "./week.mjs";
import { chicagoNow, addDays } from "./time.mjs";

// Every email the Open House platform sends, built by the real code in email.mjs from a sample open house, for the
// Admin Console's Settings > Emails. Nothing is sent: capture() keeps each message (email.mjs). The sample home is
// the newest one requested here, so the photo and address look real; the agent, times, notes and access details
// are made up.
const SAMPLE_HOME = { mls: "21372196", addr: "6900 Rockingham Court", city: "Colleyville", zip: "76034", price: 4350000, img: "ntreismls/IMG-21372196_4446441738281566696.jpg" };
const SAMPLE_INFO = { access: "Sample: lockbox on the front door, code 1234. The alarm is off.", instr: ["Sample: park on the street, not in the driveway."] };
const AGENT = { name: "Jordan Sample", email: "jordan.sample@example.com" };

// [group, key, name, who gets it, when it's sent, build(sample, teamMember)]. Groups follow how an open house goes.
const EMAILS = [
  ["Request", "request-team", "New request", "The team", "An agent requests an open house. Approve and Decline open the request.",
    (r) => E.sendRequestReceived(r, "Pat Lee, 3:00 PM to 5:00 PM")],
  ["Request", "request-agent", "Request sent", "The agent", "Right after they request it, so they know the team has it.", (r) => E.sendRequestSent(r)],
  ["Approved", "confirmed", "Confirmed", "The agent and the team, plus the team calendar",
    "The team approves the request (with the AI agent, once it's on the MLS). It has the access details and a calendar invite.", (r) => E.sendConfirmed(r)],
  ["Denied", "declined", "Declined", "The agent", "The team declines the request, with their reason when they give one.", (r) => E.sendDeclined(r)],
  ["Reminder", "reminder", "Reminder", "The agent and the team", "9:00 AM the day before the open house. It has the access details.", (r) => E.sendReminder(r)],
  ["Feedback requested", "feedback-ask", "Feedback request", "The agent", "About an hour after the open house ends, with a link to the feedback form.",
    (r) => E.sendFeedbackAsk(r, false)],
  ["Feedback requested", "feedback-remind", "Feedback reminder", "The agent",
    "A day after the feedback request if there's still no feedback, or when the team presses \"Email a reminder\" on a home's page.", (r) => E.sendFeedbackAsk(r, true)],
  ["Feedback received", "feedback-team", "Feedback received", "The team",
    "The agent sends their feedback. When they flag something for the broker, the subject starts with \"⚠ Flagged for broker\".", (r) => E.sendFeedbackToTeam(r)],
  ["Changes and cancellations", "updated", "Time changed", "The agent and the team, plus the team calendar",
    "The team changes the day or hours of an approved open house. The calendar invite moves the event.", (r, by) => E.sendUpdated(r, { iso: r.iso, from: 11, to: 13 }, by)],
  ["Changes and cancellations", "cancelled", "Cancelled", "The agent and the team, plus the team calendar",
    "The team cancels an approved open house. The calendar file removes the event.", (r, by) => E.sendCancelled(r, by, false)],
  ["Changes and cancellations", "withdrawn", "Withdrawn", "The agent and the team", "The team withdraws a request before it's approved.", (r, by) => E.sendWithdrawn(r, by, false)],
  ["Changes and cancellations", "cancel-requested", "Cancellation request", "The team", "An agent asks to cancel their open house or request.", (r) => E.sendCancelRequested(r)],
  ["Changes and cancellations", "cancel-kept", "Still on", "The agent", "The team keeps the open house after the agent asked to cancel.", (r, by) => E.sendCancelKept(r, by)],
  ["Alerts for the team", "team-alert", "MLS action needed", "The team",
    "The AI agent couldn't put an open house on the MLS, or needs someone to sign in to the MLS.",
    (r) => E.sendTeamAlert(r, "booking failed", "Sample: the AI agent couldn't find the listing on the MLS.")],
];

export async function emailPreviews(teamMember = "Kelly Cawyer") {
  const all = await listRequests().catch(() => []);
  const newest = all.filter((r) => r.listing?.img && r.listing?.addr).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
  const listing = newest ? newest.listing : SAMPLE_HOME;
  // Next Saturday, 1 to 3 PM.
  const today = chicagoNow().date, sat = weekSatOf(today) > today ? weekSatOf(today) : addDays(weekSatOf(today), 7);
  const now = Date.now();
  const sample = () => ({
    id: "sample0000000000000000000000000", mls: listing.mls, day: dayKeyOf(sat), iso: sat, from: 13, to: 15, listing,
    notes: "Sample: I'll bring a co-host.", phone: "(817) 555-0100", agent: AGENT, site: E.SITE, status: "approved",
    createdAt: now, decidedAt: now, decidedByName: teamMember, declineReason: "Sample: the sellers will be home that day.",
    cancelRequest: { at: now, byName: AGENT.name, reason: "Sample: a family conflict came up." },
    feedback: { at: now, visitors: 6, interest: "lots", price: "right", liked: "Sample: the open kitchen and the backyard.",
      disliked: "Sample: a couple asked about the age of the roof.", forSeller: "", teamNotes: "", brokerFlag: false, photos: [] },
  });
  const out = [];
  for (const [group, key, name, to, when, build] of EMAILS) {
    const [msg] = await E.capture(() => build(sample(), teamMember), SAMPLE_INFO);
    if (!msg) continue;
    out.push({ group, key, name, to, when, subject: msg.subject, html: msg.html, attachments: (msg.attachments || []).map((a) => a.filename) });
  }
  return { emails: out, team: E.TEAM_TO(), calendar: E.TEAM_CALENDAR.email, home: `${listing.addr}, ${listing.city}` };
}
