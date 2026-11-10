import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BlobsServer } from "@netlify/blobs/server";
import { getStore } from "@netlify/blobs";

// Texts to the hosting agent through Quo (netlify/lib/texts.mjs), against a local Blobs server and a stand-in Quo
// and Resend.
process.env.SESSION_SECRET = "x".repeat(40);
process.env.ADMIN_EMAILS = "boss@synergyrealtors.com";
process.env.TEAM_EMAILS = "";
process.env.ALLOWED_DOMAINS = "synergyrealtors.com";
process.env.RESEND_API_KEY = "resend-key";
delete process.env.QUO_API_KEY;
delete process.env.QUO_FROM_NUMBER;

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "oh-texts-"));
const blobs = new BlobsServer({ directory: dir, token: "t" });
const { port } = await blobs.start();
const edge = `http://localhost:${port}`;
process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify({ edgeURL: edge, uncachedEdgeURL: edge, siteID: "test", token: "t" })).toString("base64");
after(async () => { await blobs.stop(); await fs.rm(dir, { recursive: true, force: true }); });

// Quo: every text posted, and a recipient who has opted out. Resend: every email.
const quo = { posts: [], optedOut: new Set() }, emails = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u === "https://api.resend.com/emails") { emails.push(JSON.parse(init.body)); return Response.json({ id: "em" }); }
  if (!u.startsWith("https://api.quo.com")) return realFetch(url, init);
  assert.equal(u, "https://api.quo.com/v1/messages");
  if (new Headers(init.headers).get("authorization") !== "quo-key") return Response.json({ error: { message: "Unauthorized", key: "Unauthorized" } }, { status: 401 });
  const b = JSON.parse(init.body);
  if (quo.optedOut.has(b.to[0])) return Response.json({ message: "User opted out", code: "0201400", status: 400, title: "User Opted Out" }, { status: 400 });
  quo.posts.push(b);
  return Response.json({ data: { id: "AC1", to: b.to, from: b.from, text: b.content, status: "queued" } }, { status: 202 });
};

const T = await import("../netlify/lib/texts.mjs");
const { saveRequest, getRequest } = await import("../netlify/lib/requests.mjs");
const { listEvents } = await import("../netlify/lib/mls.mjs");
const { makeSession } = await import("../netlify/lib/shared.mjs");
const { capture } = await import("../netlify/lib/email.mjs");
const { chicagoNow, addDays } = await import("../netlify/lib/time.mjs");
const reminders = (await import("../netlify/functions/reminders.mjs")).default;
const adminTexts = (await import("../netlify/functions/admin-texts.mjs")).default;

const ROSTER = { updatedAt: 1, source: "test", agents: [
  { name: "Dana Sample", phone: "+18175550111", emails: ["dana@synergyrealtors.com", "dana.personal@example.com"] },
  { name: "Boss Person", phone: "+18175550199", emails: ["boss@synergyrealtors.com"] },
  { name: "Pat Lee", phone: "+18175550101", emails: ["pat@a.com"] }, { name: "Pat Lee", phone: "+18175550102", emails: ["pat@b.com"] },
] };
await T.saveRoster(ROSTER);
const listing = { mls: "21372196", addr: "6900 Rockingham Court", city: "Colleyville", zip: "76034", price: 1, img: "x.jpg" };
const req = (o = {}) => ({ id: "c".repeat(32), mls: listing.mls, iso: "2026-11-14", from: 13, to: 15, listing, status: "approved",
  agent: { name: "Dana Sample", email: "dana@synergyrealtors.com" }, createdAt: 1, ...o });

test("phone numbers", () => {
  assert.equal(T.toE164("(817) 410-8769"), "+18174108769");
  assert.equal(T.toE164("(817) 555-0123\u202C"), "+18175550123"); // a stray invisible character copied from a sheet
  assert.equal(T.toE164("1-817-410-8769"), "+18174108769");
  assert.equal(T.toE164("410-8769"), null);
  assert.equal(T.toE164(""), null);
  assert.equal(T.fmtPhone("+18174108769"), "(817) 410-8769");
  assert.equal(T.QUO_FROM, "+18174108769");
});

test("roster matches by any of the agent's emails, else by a name only one agent has", () => {
  assert.equal(T.rosterMatch(ROSTER, { email: "Dana.Personal@example.com " }).phone, "+18175550111");
  assert.equal(T.rosterMatch(ROSTER, { email: "dana@other.com", name: "Dana  Sample" }).phone, "+18175550111");
  assert.equal(T.rosterMatch(ROSTER, { email: "pat@c.com", name: "Pat Lee" }), null); // two agents named Pat Lee
  assert.equal(T.rosterMatch(ROSTER, { email: "nobody@x.com", name: "Nobody" }), null);
  assert.equal(T.rosterMatch({ agents: [] }, { email: "dana@synergyrealtors.com" }), null);
});

test("texts are short, plain, name the sender and say how to opt out", () => {
  const r = req();
  for (const [kind, t] of Object.entries(T.TEXTS)) {
    const body = t.body(r);
    assert.match(body, /^George & Noonan: /, kind);
    assert.match(body, /6900 Rockingham Court/, kind);
    assert.match(body, /Reply STOP to opt out\.$/, kind);
    assert.match(body, /^[\x20-\x7E]+$/, kind); // plain characters keep it one or two segments
    assert.ok(body.length <= 306, `${kind} is ${body.length} characters`); // two segments
    assert.doesNotMatch(body, /lockbox|code/i, kind);
  }
  assert.match(T.TEXTS.reminder.body(r), /tomorrow, 1:00 PM to 3:00 PM/);
  assert.match(T.TEXTS.feedbackAsk.body(r), /https:\/\/open-house\.synergyrealtors\.com\/feedback\/\?id=c{32} /);
  assert.match(T.TEXTS.feedbackRemind.body(r), /\/feedback\/\?id=c{32} /);
});

test("texts are off until QUO_API_KEY is set", async () => {
  quo.posts.length = 0;
  assert.equal(await T.textAgent(req(), "reminder"), null);
  assert.equal(quo.posts.length, 0);
});

test("with the key: texts the agent on the roster, notes it in the history, and never throws", async () => {
  process.env.QUO_API_KEY = "quo-key";
  try {
    quo.posts.length = 0;
    const r = req({ id: "d".repeat(32) });
    assert.equal(await T.textAgent(r, "feedbackAsk"), "sent");
    assert.deepEqual(quo.posts, [{ content: T.TEXTS.feedbackAsk.body(r), from: "+18174108769", to: ["+18175550111"] }]);
    assert.equal(await T.textAgent(req({ agent: { name: "Nobody", email: "nobody@x.com" } }), "reminder"), null); // not on the roster
    quo.optedOut.add("+18175550111");
    assert.equal(await T.textAgent(r, "feedbackRemind"), "failed");
    quo.optedOut.clear();
    const notes = (await listEvents(r.id)).map((e) => `${e.type}: ${e.note}`);
    assert.deepEqual(notes.sort(), [
      "text_failed: The feedback reminder text to Dana Sample at (817) 555-0111 didn't send (Quo 400: User Opted Out)",
      "text_sent: Texted Dana Sample the feedback request at (817) 555-0111",
    ]);
    // previews keep texts instead of sending them
    const kept = await capture(() => T.sendText("+18175550111", "hi"));
    assert.deepEqual(kept, [{ text: true, to: "+18175550111", content: "hi" }]);
    assert.equal(quo.posts.length, 1);
  } finally { delete process.env.QUO_API_KEY; }
});

test("the hourly job texts the feedback request along with the email, once", async () => {
  process.env.QUO_API_KEY = "quo-key";
  try {
    quo.posts.length = 0; emails.length = 0;
    const r = req({ id: "e".repeat(32), iso: addDays(chicagoNow().date, -1) }); // ended yesterday afternoon
    await saveRequest(r);
    await reminders();
    assert.equal(emails.filter((m) => m.to === r.agent.email).length, 1);
    assert.deepEqual(quo.posts.map((p) => [p.to[0], p.content]), [["+18175550111", T.TEXTS.feedbackAsk.body(r)]]);
    assert.ok((await getRequest(r.id)).feedbackAskedAt);
    await reminders(); // an hour later: the reminder waits for 3 hours after the end and 2 after the ask
    assert.equal(quo.posts.length, 1);
  } finally { delete process.env.QUO_API_KEY; }
});

test("Settings > Texts: admins see the texts and can text the samples to themselves", async () => {
  const ORIGIN = "http://localhost:8888";
  const as = (email, name) => ({ cookie: `oh_session=${makeSession({ email, name })}`, origin: ORIGIN });
  const call = (headers, body) => adminTexts(new Request(ORIGIN + "/api/admin/texts", { method: body ? "POST" : "GET",
    headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }));
  assert.equal((await call(as("dana@synergyrealtors.com", "Dana Sample"))).status, 403);
  const boss = as("boss@synergyrealtors.com", "Boss Person");
  let res = await call(boss);
  let d = await res.json();
  assert.equal(d.on, false);
  assert.deepEqual([d.from, d.me, d.roster.count], ["(817) 410-8769", { name: "Boss Person", phone: "(817) 555-0199" }, 4]);
  assert.deepEqual(d.texts.map((t) => t.key), ["reminder", "feedbackAsk", "feedbackRemind"]);
  assert.equal((await call(boss, { action: "test" })).status, 409); // off
  process.env.QUO_API_KEY = "quo-key";
  try {
    quo.posts.length = 0;
    res = await call(boss, { action: "test" });
    d = await res.json();
    assert.equal(res.status, 200, JSON.stringify(d));
    assert.deepEqual([d.sent, d.to], [3, "(817) 555-0199"]);
    assert.deepEqual(quo.posts.map((p) => p.to[0]), ["+18175550199", "+18175550199", "+18175550199"]);
    assert.equal((await call(boss, { action: "test" })).status, 429); // a double press sends one set
  } finally { delete process.env.QUO_API_KEY; }
});

test("the key is sent bare however it was pasted, and a key Quo rejects is explained and can be retried at once", async () => {
  const ORIGIN = "http://localhost:8888";
  const boss = { cookie: `oh_session=${makeSession({ email: "boss@synergyrealtors.com", name: "Boss Person" })}`, origin: ORIGIN };
  const test = () => adminTexts(new Request(ORIGIN + "/api/admin/texts", { method: "POST", headers: { ...boss, "content-type": "application/json" }, body: JSON.stringify({ action: "test" }) }));
  for (const pasted of [" quo-key\n", '"quo-key"', "Bearer quo-key"]) {
    process.env.QUO_API_KEY = pasted;
    quo.posts.length = 0;
    await T.sendText("+18175550111", "hi");
    assert.equal(quo.posts.length, 1, JSON.stringify(pasted)); // the stand-in Quo only accepts "quo-key"
  }
  process.env.QUO_API_KEY = "wrong-key";
  try {
    await assert.rejects(T.sendText("+18175550111", "hi"), { message: "Quo 401: Unauthorized" });
    await getStore({ name: "open-house-agents", consistency: "strong" }).delete("test"); // the earlier test's set
    let res = await test();
    assert.equal(res.status, 502);
    assert.match((await res.json()).message, /didn't accept the API key \(401 Unauthorized\)/);
    res = await test(); // not "just went out": nothing did
    assert.equal(res.status, 502);
  } finally { delete process.env.QUO_API_KEY; }
});
