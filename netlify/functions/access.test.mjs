import test from "node:test";
import assert from "node:assert/strict";
import { isAllowed, normalizeEmail, normalizeDomain, makeSession, readSession } from "./_lib.mjs";

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
