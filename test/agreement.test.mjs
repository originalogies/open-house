import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BlobsServer } from "@netlify/blobs/server";

// The Support and Referral Agreement flow (netlify/lib/agreement.mjs) against a local Blobs server and a
// stand-in DocuSeal API.
process.env.SESSION_SECRET = "x".repeat(40);
process.env.ADMIN_EMAILS = "boss@synergyrealtors.com";
process.env.TEAM_EMAILS = "";
process.env.ALLOWED_DOMAINS = "synergyrealtors.com";
process.env.DOCUSEAL_API_KEY = "test-key";
process.env.DOCUSEAL_TEMPLATE_ID = "7";
process.env.DOCUSEAL_API_URL = "https://docuseal.test";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "oh-agreement-"));
const blobs = new BlobsServer({ directory: dir, token: "t" });
const { port } = await blobs.start();
const edge = `http://localhost:${port}`;
process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify({ edgeURL: edge, uncachedEdgeURL: edge, siteID: "test", token: "t" })).toString("base64");
after(async () => { await blobs.stop(); await fs.rm(dir, { recursive: true, force: true }); });

// DocuSeal: submissions made through the API, and submitters looked up by id.
const ds = { submitters: new Map(), posts: [], next: 100 };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  if (!String(url).startsWith("https://docuseal.test")) return realFetch(url, init);
  assert.equal(new Headers(init.headers).get("x-auth-token"), "test-key");
  const u = new URL(url), method = init.method || "GET";
  if (method === "POST" && u.pathname === "/submissions") {
    const b = JSON.parse(init.body), who = b.submitters[0], id = ++ds.next;
    ds.posts.push(b);
    const s = { id, submission_id: id + 1000, email: who.email, external_id: who.external_id, name: who.name, status: "sent", completed_at: null,
      template: { id: b.template_id }, values: [], documents: [], embed_src: `https://docuseal.test/s/slug${id}` };
    ds.submitters.set(id, s);
    return Response.json([s]);
  }
  const m = u.pathname.match(/^\/submitters\/(\d+)$/);
  if (method === "GET" && m && ds.submitters.has(Number(m[1]))) return Response.json(ds.submitters.get(Number(m[1])));
  return Response.json({ error: "Not found" }, { status: 404 });
};
const sign = (id, name) => Object.assign(ds.submitters.get(id), {
  status: "completed", completed_at: "2026-10-28T19:14:05.123Z", values: [{ field: "Agent Name", value: name }],
  documents: [{ name: "agreement", url: "https://docuseal.test/file/signed.pdf" }],
});

const { makeSession, currentUser } = await import("../netlify/lib/shared.mjs");
const { signedFrom, getAgreement } = await import("../netlify/lib/agreement.mjs");
const agreementApi = (await import("../netlify/functions/agreement.mjs")).default;
const webhook = (await import("../netlify/functions/agreement-webhook.mjs")).default;
const requestsApi = (await import("../netlify/functions/requests.mjs")).default;
const adminApi = (await import("../netlify/functions/admin-agreements.mjs")).default;

const ORIGIN = "http://localhost:8888";
const as = (email, name = "Pat Agent") => ({ cookie: `oh_session=${makeSession({ email, name })}`, origin: ORIGIN });
const call = (fn, p, { method = "GET", headers = {}, body } = {}) =>
  fn(new Request(ORIGIN + p, { method, headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }));

test("the signed record keeps DocuSeal's time of signing and the name typed", () => {
  const a = signedFrom({ id: 5, submission_id: 9, email: "Pat@SynergyRealtors.com", name: "Pat", status: "completed", completed_at: "2026-10-28T19:14:05Z",
    template: { id: 7 }, values: [{ field: "Agent Name", value: " Patricia Agent " }] }, "webhook", { url: "https://docuseal.test/s/x", startedAt: 1 });
  assert.equal(a.email, "pat@synergyrealtors.com");
  assert.equal(a.status, "signed");
  assert.equal(a.signedAt, "2026-10-28T19:14:05Z");
  assert.equal(a.signedName, "Patricia Agent");
  assert.equal(a.via, "webhook");
  assert.equal(a.startedAt, 1);
  assert.ok(!("url" in a)); // the signing page isn't needed once it's signed
});

test("an agent is held at the agreement until DocuSeal says they signed", async () => {
  const pat = as("pat@synergyrealtors.com");
  let u = await currentUser(new Request(ORIGIN, { headers: pat }));
  assert.equal(u.mustSign, true);
  assert.equal((await call(requestsApi, "/api/requests", { headers: pat })).status, 403);

  // Read and sign: one DocuSeal submission, no DocuSeal email, back to the page they came from.
  let r = await call(agreementApi, "/api/agreement", { method: "POST", headers: pat, body: { from: "/my-open-houses/" } });
  const started = await r.json();
  assert.equal(started.signed, false);
  assert.match(started.url, /^https:\/\/docuseal\.test\/s\//);
  const sent = ds.posts.at(-1);
  assert.equal(sent.template_id, 7);
  assert.equal(sent.send_email, false);
  assert.deepEqual(sent.submitters[0].fields, [{ name: "Agent Name", default_value: "Pat Agent" }]);
  assert.equal(sent.submitters[0].role, "Cooperating Agent");
  assert.equal(sent.submitters[0].external_id, "pat@synergyrealtors.com");
  assert.equal(sent.submitters[0].completed_redirect_url, `${ORIGIN}/my-open-houses/?agreement=signed`);

  // Leaving and coming back picks up the same one.
  r = await call(agreementApi, "/api/agreement", { method: "POST", headers: pat, body: {} });
  assert.equal((await r.json()).url, started.url);
  assert.equal(ds.posts.length, 1);
  u = await currentUser(new Request(ORIGIN, { headers: pat }));
  assert.equal(u.agreement, "pending");

  // Not signed yet: still held.
  assert.deepEqual(await (await call(agreementApi, "/api/agreement", { headers: pat })).json(), { signed: false, status: "pending" });

  // Signed in DocuSeal: the check records it, with DocuSeal's time.
  sign(ds.next, "Patricia Agent");
  assert.deepEqual(await (await call(agreementApi, "/api/agreement", { headers: pat })).json(), { signed: true, status: "signed" });
  const a = await getAgreement("pat@synergyrealtors.com");
  assert.equal(a.signedAt, "2026-10-28T19:14:05.123Z");
  assert.equal(a.signedName, "Patricia Agent");
  assert.equal(a.via, "portal");
  u = await currentUser(new Request(ORIGIN, { headers: pat }));
  assert.equal(u.mustSign, false);
  assert.equal((await call(requestsApi, "/api/requests", { headers: pat })).status, 200);
});

test("the team doesn't sign", async () => {
  const u = await currentUser(new Request(ORIGIN, { headers: as("boss@synergyrealtors.com") }));
  assert.equal(u.mustSign, false);
});

test("DocuSeal only sends the agent back to this site", async () => {
  for (const from of ["//evil.test/x", "/\\evil.test", "https://evil.test/", "javascript:alert(1)"]) {
    const email = `t${ds.next}@synergyrealtors.com`;
    await call(agreementApi, "/api/agreement", { method: "POST", headers: as(email), body: { from } });
    assert.equal(ds.posts.at(-1).submitters[0].completed_redirect_url, `${ORIGIN}/?agreement=signed`, from);
  }
});

test("the webhook records a signature only after checking with DocuSeal", async () => {
  const kim = as("kim@synergyrealtors.com", "Kim");
  await call(agreementApi, "/api/agreement", { method: "POST", headers: kim, body: {} });
  const id = ds.next;
  const hook = (body, headers = {}) => call(webhook, "/api/agreement/webhook", { method: "POST", headers, body });

  // A forged "completed" for a submitter DocuSeal still has as unsigned records nothing.
  await hook({ event_type: "form.completed", data: { id, status: "completed", template: { id: 7 } } });
  assert.equal((await getAgreement("kim@synergyrealtors.com")).status, "pending");
  // Other documents in the DocuSeal account are left alone.
  assert.equal((await (await hook({ event_type: "form.completed", data: { id, template: { id: 8 } } })).json()).ignored, true);

  // With a secret set, calls without it are refused.
  process.env.DOCUSEAL_WEBHOOK_SECRET = "s".repeat(32);
  sign(id, "Kim Lee");
  assert.equal((await hook({ event_type: "form.completed", data: { id } })).status, 401);
  const ok = await hook({ event_type: "form.completed", data: { id, template: { id: 7 } } }, { "x-oh-webhook-secret": "s".repeat(32) });
  assert.equal((await ok.json()).status, "signed");
  delete process.env.DOCUSEAL_WEBHOOK_SECRET;
  const a = await getAgreement("kim@synergyrealtors.com");
  assert.equal(a.via, "webhook");
  assert.equal(a.signedAt, "2026-10-28T19:14:05.123Z");
});

test("a form DocuSeal no longer has is replaced, not a dead end", async () => {
  const lee = as("lee@synergyrealtors.com", "Lee");
  const first = await (await call(agreementApi, "/api/agreement", { method: "POST", headers: lee, body: {} })).json();
  ds.submitters.delete(ds.next); // deleted in DocuSeal, or the key now points at another DocuSeal account
  assert.deepEqual(await (await call(agreementApi, "/api/agreement", { headers: lee })).json(), { signed: false, status: "gone" });
  const again = await (await call(agreementApi, "/api/agreement", { method: "POST", headers: lee, body: {} })).json();
  assert.match(again.url, /^https:\/\/docuseal\.test\/s\//);
  assert.notEqual(again.url, first.url);
});

test("the Admin Console sees who signed and when, and agents can't", async () => {
  assert.equal((await call(adminApi, "/api/admin/agreements", { headers: as("pat@synergyrealtors.com") })).status, 403);
  const d = await (await call(adminApi, "/api/admin/agreements", { headers: as("boss@synergyrealtors.com") })).json();
  assert.equal(d.on, true);
  assert.deepEqual(d.exempt, ["boss@synergyrealtors.com"]);
  const pat = d.agreements.find((a) => a.email === "pat@synergyrealtors.com");
  assert.deepEqual(pat, { email: "pat@synergyrealtors.com", name: "Patricia Agent", status: "signed", signedAt: "2026-10-28T19:14:05.123Z", startedAt: pat.startedAt });
  const copy = await call(adminApi, "/api/admin/agreements?copy=pat%40synergyrealtors.com", { headers: as("boss@synergyrealtors.com") });
  assert.equal(copy.status, 302);
  assert.equal(copy.headers.get("location"), "https://docuseal.test/file/signed.pdf");
});

test("with DocuSeal not set up, nobody is held", async () => {
  delete process.env.DOCUSEAL_TEMPLATE_ID;
  const u = await currentUser(new Request(ORIGIN, { headers: as("new@synergyrealtors.com") }));
  assert.equal(u.mustSign, false);
  process.env.DOCUSEAL_TEMPLATE_ID = "7";
});
