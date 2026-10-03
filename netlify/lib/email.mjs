import Handlebars from "handlebars";
import * as T from "./templates.generated.mjs";
import { getInfo } from "./listings.mjs";
import { dayMeta } from "./week.mjs";
import { fmtRange, fmtArrival, fmtReceived, chicagoToUtc } from "./time.mjs";

export const SITE = "https://open-house.synergyrealtors.com";
// Links in emails point back to the site the request was made on, so local tests link to localhost.
// Only the production site and localhost are trusted.
export const siteFor = (origin) => (origin === SITE || /^http:\/\/localhost:\d+$/.test(origin) ? origin : SITE);
const FROM = "George & Noonan Open Houses <openhouse@synergyrealtors.com>";
export const TEAM_TO = () => (process.env.TEAM_EMAIL || "team@georgeandnoonan.com").split(",").map((s) => s.trim());

const money = (n) => "$" + n.toLocaleString("en-US");
const compile = Object.fromEntries(Object.entries(T).map(([k, v]) => [k, Handlebars.compile(v)]));

const site = (req) => req.site || SITE;

export function fields(req, extra = {}) {
  const l = req.listing;
  const d = dayMeta(req.iso);
  return {
    address: l.addr, city: l.city, zip: l.zip, mls_number: l.mls, list_price: money(l.price),
    photo_url: `https://cdn.repliers.io/${l.img}?class=medium`,
    map_url: `https://www.google.com/maps/search/?api=1&query=${l.lat},${l.lng}`,
    listing_url: site(req),
    request_id: req.id, day_name: d.label, date: d.date, time_range: fmtRange(req.from, req.to),
    received_at: fmtReceived(req.createdAt), agent_notes: req.notes || "",
    relative_day: "tomorrow", arrival_time: fmtArrival(req.from),
    agent_name: req.agent.name, agent_first_name: (req.agent.name || "").split(" ")[0] || req.agent.name,
    agent_phone: req.phone || "", agent_email: req.agent.email,
    approver_name: req.decidedByName || "", approved_at: req.decidedAt ? fmtReceived(req.decidedAt) : "",
    ics_url: `${site(req)}/api/ics?id=${req.id}`,
    instructions: [],
    ...extra,
  };
}

// RFC 5545 calendar file for an approved request.
export function ics(req) {
  const l = req.listing;
  const iso = req.iso;
  const z = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s) => String(s).replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//George & Noonan//Open House//EN", "METHOD:PUBLISH", "BEGIN:VEVENT",
    `UID:${req.id}@open-house.synergyrealtors.com`, `DTSTAMP:${z(new Date())}`,
    `DTSTART:${z(chicagoToUtc(iso, req.from))}`, `DTEND:${z(chicagoToUtc(iso, req.to))}`,
    `SUMMARY:${esc("Open house: " + l.addr)}`, `LOCATION:${esc(`${l.addr}, ${l.city}, TX ${l.zip}`)}`,
    "BEGIN:VALARM", "TRIGGER:-PT30M", "ACTION:DISPLAY", "DESCRIPTION:Open house starts soon", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n") + "\r\n";
}

async function send({ to, subject, html, replyTo, attachments }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject, html, reply_to: replyTo, attachments }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

// Request Received -> team (never contains access details).
export const sendRequestReceived = (req, others) =>
  send({
    to: TEAM_TO(), replyTo: req.agent.email,
    subject: `Open house request: ${req.listing.addr}, ${dayMeta(req.iso).label} ${dayMeta(req.iso).date}, ${fmtRange(req.from, req.to)}`,
    html: compile.requestReceived(fields(req, {
      other_requests: others, // plain text list
      approve_url: `${site(req)}/respond/?id=${req.id}&action=approve`,
      decline_url: `${site(req)}/respond/?id=${req.id}&action=decline`,
    })),
  });

// Request Sent -> agent (never contains access details).
export const sendRequestSent = (req) =>
  send({
    to: req.agent.email, replyTo: TEAM_TO()[0],
    subject: `Request sent: open house at ${req.listing.addr}, ${dayMeta(req.iso).label} ${dayMeta(req.iso).date}`,
    html: compile.requestSent(fields(req)),
  });

// Confirmed -> agent + team, with calendar invite and access details.
export const sendConfirmed = async (req) => {
  const l = req.listing, d = dayMeta(req.iso), info = await getInfo(req.mls);
  return send({
    to: [req.agent.email, ...TEAM_TO()], replyTo: TEAM_TO()[0],
    subject: `Confirmed: open house at ${l.addr}, ${d.label} ${d.date}, ${fmtRange(req.from, req.to)}`,
    html: compile.requestConfirmed(fields(req, { access_details: info.access || "No access details were provided. Ask the George & Noonan team.", instructions: info.instr })),
    attachments: [{ filename: "open-house.ics", content: Buffer.from(ics(req)).toString("base64") }],
  });
};

// Reminder -> agent + team, day before at 9:00 AM CT.
export const sendReminder = async (req) => {
  const l = req.listing, info = await getInfo(req.mls);
  return send({
    to: [req.agent.email, ...TEAM_TO()], replyTo: TEAM_TO()[0],
    subject: `Reminder: open house at ${l.addr} tomorrow, ${fmtRange(req.from, req.to)}`,
    html: compile.reminder(fields(req, { access_details: info.access || "No access details were provided. Ask the George & Noonan team.", instructions: info.instr })),
  });
};

// Declines have no template yet: short plain note to the agent.
export const sendDeclined = (req) => {
  const l = req.listing, d = dayMeta(req.iso);
  const esc = Handlebars.escapeExpression;
  return send({
    to: req.agent.email, replyTo: TEAM_TO()[0],
    subject: `Update on your open house request: ${l.addr}, ${d.label} ${d.date}`,
    html: `<p style="font-family:Arial,sans-serif;font-size:15px;line-height:23px;color:#16202A;">Hi ${esc((req.agent.name || "").split(" ")[0])},<br><br>The George &amp; Noonan team couldn't confirm your open house request for ${esc(l.addr)} on ${d.label}, ${d.date}, ${fmtRange(req.from, req.to)}. Reply to this email if you'd like to try a different day or time.</p>`,
  });
};
