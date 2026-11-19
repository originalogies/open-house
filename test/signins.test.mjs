import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BlobsServer } from "@netlify/blobs/server";
import { deviceOf } from "../netlify/lib/signins.mjs";

// The sign-in log (signins.mjs) behind the Admin Console's Sign-ins page, and sign-ins that last 90 days and renew
// on each visit (shared.mjs, me.mjs). Run against a local Blobs server and a stand-in for Google's token check.

test("the device and browser, from the browser's user agent", () => {
  const ua = {
    iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
    iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1",
    iphoneApp: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    iphoneFacebook: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/490.0]",
    macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
    macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    windowsEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    windowsFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
    androidChrome: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    androidSamsung: "Mozilla/5.0 (Linux; Android 14; SM-S921U) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
    androidApp: "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36",
  };
  assert.equal(deviceOf(ua.iphoneSafari), "iPhone · Safari");
  assert.equal(deviceOf(ua.iphoneChrome), "iPhone · Chrome");
  assert.equal(deviceOf(ua.iphoneApp), "iPhone · In-app browser"); // Gmail, Messages previews and other apps' browsers
  assert.equal(deviceOf(ua.iphoneFacebook), "iPhone · Facebook app");
  assert.equal(deviceOf(ua.macSafari), "Mac · Safari");
  assert.equal(deviceOf(ua.macChrome), "Mac · Chrome");
  assert.equal(deviceOf(ua.windowsEdge), "Windows · Edge");
  assert.equal(deviceOf(ua.windowsFirefox), "Windows · Firefox");
  assert.equal(deviceOf(ua.androidChrome), "Android · Chrome");
  assert.equal(deviceOf(ua.androidSamsung), "Android · Samsung Internet");
  assert.equal(deviceOf(ua.androidApp), "Android · In-app browser");
  assert.equal(deviceOf(""), "Unknown device");
  assert.equal(deviceOf(null), "Unknown device");
});

// ---- end to end, through the API handlers ----
process.env.SESSION_SECRET = "x".repeat(40);
process.env.ADMIN_EMAILS = "boss@synergyrealtors.com";
process.env.TEAM_EMAILS = "";
process.env.ALLOWED_DOMAINS = "synergyrealtors.com";
process.env.GOOGLE_CLIENT_ID = "client-123";
delete process.env.DOCUSEAL_API_KEY;

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "oh-signins-"));
const blobs = new BlobsServer({ directory: dir, token: "t" });
const { port } = await blobs.start();
const edge = `http://localhost:${port}`;
process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify({ edgeURL: edge, uncachedEdgeURL: edge, siteID: "test", token: "t" })).toString("base64");
after(async () => { await blobs.stop(); await fs.rm(dir, { recursive: true, force: true }); });

// Google's token check: a "token" here is just the account it stands for, or "bad".
const ACCOUNTS = {
  pat: { email: "Pat@SynergyRealtors.com", name: "Pat Agent" },
  stranger: { email: "someone@gmail.com", name: "Some One" },
  unverified: { email: "new@synergyrealtors.com", name: "New Person", email_verified: "false" },
};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = new URL(String(url));
  if (u.hostname === "localhost") return realFetch(url, init); // the Blobs server
  if (u.hostname !== "oauth2.googleapis.com") throw new Error(`no network in tests: ${u.hostname}`);
  const a = ACCOUNTS[u.searchParams.get("id_token")];
  if (!a) return Response.json({ error: "invalid_token" }, { status: 400 });
  return Response.json({ aud: "client-123", iss: "https://accounts.google.com", exp: String(Math.floor(Date.now() / 1000) + 3600), email_verified: "true", ...a });
};

const { makeSession, readSession, renewedSession } = await import("../netlify/lib/shared.mjs");
const { recordSignIn, listSignIns } = await import("../netlify/lib/signins.mjs");
const fn = async (name) => (await import(`../netlify/functions/${name}.mjs`)).default;
const [authApi, logoutApi, signinsApi, meApi] = await Promise.all(["auth-google", "logout", "admin-signins", "me"].map(fn));
const SITE = "https://open-house.synergyrealtors.com";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const BOSS = `oh_session=${makeSession({ email: "boss@synergyrealtors.com", name: "Boss Person" })}`;
const call = (handler, method, url, { cookie = "", body, page = "/" } = {}) => handler(new Request(`${SITE}${url}`, {
  method, body: body && JSON.stringify(body),
  headers: { cookie, origin: SITE, referer: `${SITE}${page}`, "user-agent": IPHONE, ...(body && { "content-type": "application/json" }) } }));
const signIn = (token, page) => call(authApi, "POST", "/api/auth/google", { body: { credential: token }, page });
const tick = () => new Promise((r) => setTimeout(r, 3)); // keeps the log's times apart, so its order is certain

test("each sign-in, turn-away and sign-out is logged, newest first, for admins only", async () => {
  const ok = await signIn("pat", "/my-open-houses/");
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get("set-cookie").split(";")[0];
  await tick();
  assert.equal((await signIn("stranger")).status, 403);
  await tick();
  assert.equal((await signIn("unverified")).status, 401);
  await tick();
  assert.equal((await signIn("bad")).status, 401);
  await tick();
  assert.equal((await call(logoutApi, "POST", "/api/auth/logout", { cookie, page: "/admin/" })).status, 200);
  await tick();
  assert.equal((await call(logoutApi, "POST", "/api/auth/logout")).status, 200); // not signed in: nothing to log

  assert.equal((await call(signinsApi, "GET", "/api/admin/signins")).status, 401);
  assert.equal((await call(signinsApi, "GET", "/api/admin/signins", { cookie })).status, 403, "agents can't see the log");
  const res = await call(signinsApi, "GET", "/api/admin/signins", { cookie: BOSS });
  assert.equal(res.status, 200);
  const { signins, keepDays } = await res.json();
  assert.equal(keepDays, 365);
  assert.deepEqual(signins.map((e) => [e.result, e.email]), [
    ["signed_out", "pat@synergyrealtors.com"],
    ["invalid_token", null],
    ["email_not_verified", "new@synergyrealtors.com"],
    ["not_allowed", "someone@gmail.com"],
    ["signed_in", "pat@synergyrealtors.com"],
  ]);
  const first = signins.at(-1);
  assert.equal(first.name, "Pat Agent");
  assert.equal(first.device, "iPhone · Safari");
  assert.equal(first.page, "/my-open-houses/");
  assert.equal(signins[1].name, null);
});

test("the page is only kept when it's on this site", async () => {
  const req = (referer) => new Request(`${SITE}/api/auth/google`, { headers: { referer, "user-agent": "" } });
  assert.equal((await recordSignIn(req("https://evil.example/admin/"), { result: "signed_in", email: "x@y.com" })).page, null);
  assert.equal((await recordSignIn(req("not a url"), { result: "signed_in", email: "x@y.com" })).page, null);
  assert.equal((await recordSignIn(req(`${SITE}/respond/?id=1`), { result: "signed_in", email: "x@y.com" })).page, "/respond/");
});

test("sign-ins older than a year are dropped from the log and deleted", async () => {
  const req = new Request(`${SITE}/api/auth/google`);
  const day = 24 * 60 * 60 * 1000;
  await recordSignIn(req, { result: "signed_in", email: "old@synergyrealtors.com" }, Date.now() - 400 * day);
  await recordSignIn(req, { result: "signed_in", email: "lastyear@synergyrealtors.com" }, Date.now() - 300 * day);
  const emails = (await listSignIns()).map((e) => e.email);
  assert.ok(!emails.includes("old@synergyrealtors.com"));
  assert.ok(emails.includes("lastyear@synergyrealtors.com"));
  assert.ok(!(await listSignIns()).some((e) => e.email === "old@synergyrealtors.com"), "it stays gone");
});

test("a sign-in lasts 90 days and starts over at 90 days on a visit after a day", async () => {
  const DAY = 24 * 60 * 60, NINETY = 90 * DAY;
  const at = (cookie) => new Request(`${SITE}/api/me`, { headers: { cookie } });
  // Sessions made "earlier" by moving the clock back while they're signed.
  const madeAgo = (days) => {
    const real = Date.now;
    Date.now = () => real() - days * DAY * 1000;
    try { return `oh_session=${makeSession({ email: "pat@synergyrealtors.com", name: "Pat Agent" })}`; } finally { Date.now = real; }
  };

  const fresh = (await signIn("pat")).headers.get("set-cookie");
  assert.match(fresh, new RegExp(`Max-Age=${NINETY}(;|$)`));
  const s = readSession(at(fresh.split(";")[0]));
  assert.ok(Math.abs(s.exp - (Date.now() / 1000 + NINETY)) < 5);

  assert.equal(renewedSession(at(madeAgo(0))), null, "not renewed the same day");
  assert.equal(renewedSession(at(madeAgo(0.5))), null);
  assert.equal(renewedSession(at("oh_session=junk")), null);
  assert.equal(renewedSession(at(madeAgo(100))), null, "an expired sign-in isn't brought back");

  // Through /api/me, the first thing every signed-in page asks.
  const quiet = await meApi(at(madeAgo(0)));
  assert.equal(quiet.status, 200);
  assert.equal(quiet.headers.get("set-cookie"), null);
  for (const days of [2, 83, 89.9]) { // 83 days old: a 7-day sign-in from before this change, with 7 days left
    const res = await meApi(at(madeAgo(days)));
    assert.equal(res.status, 200);
    const next = res.headers.get("set-cookie");
    assert.match(next, /^oh_session=.+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=7776000$/, `renewed at ${days} days`);
    assert.ok(Math.abs(readSession(at(next.split(";")[0])).exp - (Date.now() / 1000 + NINETY)) < 5);
  }
  assert.equal((await meApi(at(madeAgo(91)))).status, 401, "after 90 days without a visit, they sign in again");

  // Someone taken off the access list isn't renewed: they're signed out.
  const gone = `oh_session=${makeSession({ email: "someone@gmail.com", name: "Some One" })}`;
  const res = await meApi(at(gone));
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("set-cookie"), null);
});
