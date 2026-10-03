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
  const a = { mls: "1", day: "sat", from: 10, to: 12 };
  assert.ok(overlaps(a, { mls: "1", day: "sat", from: 11, to: 13 }));
  assert.ok(!overlaps(a, { mls: "1", day: "sat", from: 12, to: 14 }));   // back to back is fine
  assert.ok(!overlaps(a, { mls: "1", day: "sun", from: 10, to: 12 }));
  assert.ok(!overlaps(a, { mls: "2", day: "sat", from: 10, to: 12 }));
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
