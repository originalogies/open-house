import test from "node:test";
import assert from "node:assert/strict";
import { isAllowed, normalizeEmail, normalizeDomain, makeSession, readSession } from "../netlify/lib/shared.mjs";

process.env.ADMIN_EMAILS = "boss@synergyrealtors.com";
process.env.SESSION_SECRET = "x".repeat(40);
const access = { emails: ["guest@gmail.com"], domains: ["synergyrealtors.com"] };

test("allowlist rules", () => {
  assert.ok(isAllowed("Agent@SynergyRealtors.com", access));      // domain, case-insensitive
  assert.ok(isAllowed("guest@gmail.com", access));                  // exact email
  assert.ok(isAllowed("boss@synergyrealtors.com", { emails: [], domains: [] })); // admin
  assert.ok(!isAllowed("other@gmail.com", access));
  assert.ok(!isAllowed("a@evil-synergyrealtors.com", access));      // no suffix tricks
  assert.ok(!isAllowed("a@sub.synergyrealtors.com", access));       // exact domain only
  assert.ok(!isAllowed("a@synergyrealtors.com", { emails: [], domains: [] })); // deny by default
});

test("normalizers", () => {
  assert.equal(normalizeEmail(" A@B.com "), "a@b.com");
  assert.equal(normalizeEmail("nope"), null);
  assert.equal(normalizeDomain("@Synergyrealtors.com"), "synergyrealtors.com");
  assert.equal(normalizeDomain("bad domain"), null);
});

test("session cookie signing", () => {
  const v = makeSession({ email: "a@b.com", name: "A" });
  const req = (c) => new Request("https://x.test/", { headers: { cookie: `oh_session=${c}` } });
  assert.equal(readSession(req(v)).email, "a@b.com");
  assert.equal(readSession(req(v.slice(0, -2) + "xx")), null);       // tampered
  assert.equal(readSession(req("e30." + v.split(".")[1])), null);    // body swapped
});

import { overlaps } from "../netlify/lib/requests.mjs";
import { fmtArrival, fmtRange, addDays, chicagoToUtc, fmtReceived } from "../netlify/lib/time.mjs";

test("overlap rules", () => {
  const a = { mls: "1", iso: "2026-10-10", from: 10, to: 12 };
  assert.ok(overlaps(a, { mls: "1", iso: "2026-10-10", from: 11, to: 13 }));
  assert.ok(!overlaps(a, { mls: "1", iso: "2026-10-10", from: 12, to: 14 }));   // back to back is fine
  assert.ok(!overlaps(a, { mls: "1", iso: "2026-10-11", from: 10, to: 12 }));
  assert.ok(!overlaps(a, { mls: "2", iso: "2026-10-10", from: 10, to: 12 }));
});

test("time helpers", () => {
  assert.equal(fmtRange(10, 12), "10:00 AM to 12:00 PM");
  assert.equal(fmtArrival(10), "9:30 AM");
  assert.equal(fmtArrival(13), "12:30 PM");
  assert.equal(addDays("2026-10-09", 1), "2026-10-10");
  assert.equal(chicagoToUtc("2026-10-10", 10).toISOString(), "2026-10-10T15:00:00.000Z"); // CDT
  assert.equal(chicagoToUtc("2026-11-07", 10).toISOString(), "2026-11-07T16:00:00.000Z"); // CST
  assert.match(fmtReceived(Date.UTC(2026, 9, 3, 19, 15)), /^Oct 3, 2026 at 2:15 PM CT$/);
});

import { getWeek } from "../netlify/lib/week.mjs";
import { normalize, openHouseBlocks } from "../netlify/lib/listings.mjs";

test("weekend rolls over at Friday 5 PM Central", () => {
  assert.equal(getWeek(new Date("2026-10-05T17:00:00Z")).satIso, "2026-10-10");   // Monday
  assert.equal(getWeek(new Date("2026-10-09T21:59:00Z")).satIso, "2026-10-10");   // Fri 4:59 PM CDT
  assert.equal(getWeek(new Date("2026-10-09T22:01:00Z")).satIso, "2026-10-17");   // Fri 5:01 PM CDT
  assert.equal(getWeek(new Date("2026-10-10T18:00:00Z")).satIso, "2026-10-17");   // Saturday
  const w = getWeek(new Date("2026-10-05T17:00:00Z"));
  assert.equal(w.days.sun.date, "Oct 11");
  assert.equal(w.closesLabel, "Friday, Oct 9 at 5:00 PM");
});

test("Repliers listing mapping", () => {
  const n = normalize({ mlsNumber: 123, listPrice: 5950000, daysOnMarket: 50, images: ["ntreismls/IMG-1.jpg"],
    address: { streetNumber: "2006", streetName: "Nighthawk", streetSuffix: "Court", city: "Westlake", zip: "76262-1234" },
    map: { latitude: 32.97, longitude: -97.18 }, details: { numBedrooms: 4, numBathrooms: 6, sqft: "6,331" } });
  assert.deepEqual([n.mls, n.addr, n.zip, n.sf, n.ba, n.img], ["123", "2006 Nighthawk Court", "76262", 6331, 6, "ntreismls/IMG-1.jpg"]);
  const w = getWeek(new Date("2026-10-05T17:00:00Z"));
  const oh = openHouseBlocks({ openHouse: [{ startTime: "2026-10-10 10:00:00", endTime: "2026-10-10 12:30:00" }, { startTime: "2026-10-03 10:00:00", endTime: "2026-10-03 12:00:00" }] }, w);
  assert.deepEqual(oh, [{ day: "sat", from: 10, to: 13 }]);
});

import { cutoffInfo, normalizeCutoff } from "../netlify/lib/week.mjs";

test("configurable cutoff", () => {
  const wed = { enabled: true, day: 3, time: "12:30" };
  const w = getWeek(new Date("2026-10-05T17:00:00Z"), wed);                 // Monday: still before Wed noon
  assert.equal(w.satIso, "2026-10-10");
  assert.equal(w.closesLabel, "Wednesday, Oct 7 at 12:30 PM");
});

test("cutoff rolls the weekend, and turning it off keeps the weekend open", () => {
  const wed = { enabled: true, day: 3, time: "12:30" };
  assert.equal(getWeek(new Date("2026-10-07T18:00:00Z"), wed).satIso, "2026-10-17");
  const off = { enabled: false, day: 5, time: "17:00" };
  assert.equal(getWeek(new Date("2026-10-09T23:00:00Z"), off).satIso, "2026-10-10"); // Friday evening, still this weekend
  assert.equal(getWeek(new Date("2026-10-10T20:00:00Z"), off).satIso, "2026-10-10"); // Saturday, weekend in progress
  assert.equal(getWeek(new Date("2026-10-11T20:00:00Z"), off).satIso, "2026-10-10"); // Sunday afternoon
  assert.equal(getWeek(new Date("2026-10-12T01:00:00Z"), off).satIso, "2026-10-17"); // Sunday 8 PM CDT, over
  assert.equal(cutoffInfo("2026-10-10", off).label, "Sunday, Oct 11 at 7:00 PM");
  assert.equal(cutoffInfo("2026-10-10", { enabled: true, day: 0, time: "08:00" }).label, "Sunday, Oct 11 at 8:00 AM");
  assert.equal(normalizeCutoff({ day: 9, time: "17:00" }), null);
  assert.equal(normalizeCutoff({ day: 5, time: "5pm" }), null);
});

import { sessionCookie, clearCookie } from "../netlify/lib/shared.mjs";

test("session cookie is Secure on https only", () => {
  const https = new Request("https://open-house.synergyrealtors.com/api/auth/google");
  const local = new Request("http://localhost:8888/api/auth/google");
  assert.match(sessionCookie("v", https), /; Secure;/);
  assert.doesNotMatch(sessionCookie("v", local), /Secure/);
  assert.match(sessionCookie("v", local), /HttpOnly; SameSite=Lax/);
  assert.match(clearCookie(https), /Secure/);
  assert.doesNotMatch(clearCookie(local), /Secure/);
});

import { siteFor, SITE } from "../netlify/lib/email.mjs";

test("email links only point at trusted sites", () => {
  assert.equal(siteFor("http://localhost:8888"), "http://localhost:8888");
  assert.equal(siteFor(SITE), SITE);
  assert.equal(siteFor("https://evil.example.com"), SITE);
  assert.equal(siteFor("http://localhost.evil.com"), SITE);
});
