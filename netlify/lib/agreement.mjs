import { getStore } from "@netlify/blobs";
import { readAll } from "./readall.mjs";

// ---- Support and Referral Agreement (DocuSeal) ------------------------------
// Agents sign the George & Noonan Support and Referral Agreement once, in DocuSeal, before they can use
// the portal. The team (admins and TEAM_EMAILS) doesn't sign. It's required only while DOCUSEAL_API_KEY
// and DOCUSEAL_TEMPLATE_ID are set. One record per agent, "agreement/<email>":
//   { email, status: "pending" | "declined" | "gone" | "signed", submitterId, submissionId, templateId,
//     url (their DocuSeal signing page, while pending), startedAt,
//     signedAt (when DocuSeal says they signed, ISO), signedName, recordedAt, via ("portal" | "webhook") }
// DocuSeal is the source of truth: a signature is recorded only after DocuSeal itself reports that
// submitter completed, never on the word of the browser or a webhook body.

const store = () => getStore({ name: "open-house-agreements", consistency: "strong" });
const key = (email) => `agreement/${String(email).toLowerCase()}`;

// The DocuSeal template's signing role, and its text field for the agent's name in the first paragraph
// (filled in with their Google name; they can correct it before signing).
export const ROLE = "Cooperating Agent";
export const NAME_FIELD = "Agent Name";

export const templateId = () => Number(process.env.DOCUSEAL_TEMPLATE_ID) || null;
export const agreementOn = () => !!(process.env.DOCUSEAL_API_KEY && templateId());
// DocuSeal cloud by default; https://api.docuseal.eu for the EU cloud, https://<host>/api when self-hosted.
const apiBase = () => (process.env.DOCUSEAL_API_URL || "https://api.docuseal.com").replace(/\/+$/, "");

export const getAgreement = (email) => store().get(key(email), { type: "json" }).catch(() => null);
const saveAgreement = (a) => store().setJSON(key(a.email), a);
export const listAgreements = async () => (await readAll(store(), "open-house-agreements", "agreement/")).map(([, a]) => a);

async function docuseal(method, path, body) {
  const res = await fetch(apiBase() + path, {
    method, signal: AbortSignal.timeout(10000),
    headers: { "x-auth-token": process.env.DOCUSEAL_API_KEY, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(`DocuSeal ${method} ${path}: ${res.status} ${data?.error || ""}`.trim()), { status: res.status });
  return data;
}
export const getSubmitter = (id) => docuseal("GET", `/submitters/${Number(id)}`);

// The record once DocuSeal reports the agent signed: its own time of signing and the name they signed as.
export function signedFrom(s, via, prev = {}) {
  const { url, declinedAt, ...rest } = prev;
  const typed = (s.values || []).find((v) => v.field === NAME_FIELD)?.value;
  return {
    ...rest, email: String(rest.email || s.external_id || s.email).toLowerCase(), status: "signed",
    submitterId: s.id, submissionId: s.submission_id, templateId: s.template?.id ?? rest.templateId ?? null,
    signedAt: s.completed_at, signedName: String(typed || s.name || "").trim(), recordedAt: Date.now(), via,
  };
}

// The agent's agreement as it stands. One waiting to be signed is checked with DocuSeal, and a signature
// (or a decline) is recorded the first time DocuSeal reports it. One DocuSeal no longer has (deleted, or
// a different DocuSeal account's key) is marked "gone", so the next "Read and sign" makes a new one.
export async function refreshAgreement(email) {
  const a = await getAgreement(email);
  if (a?.status !== "pending") return a;
  const s = await getSubmitter(a.submitterId).catch((e) => { if (e.status === 404) return null; throw e; });
  if (!s) { const gone = { ...a, status: "gone" }; await saveAgreement(gone); return gone; }
  if (s.status === "completed") { const done = signedFrom(s, "portal", a); await saveAgreement(done); return done; }
  if (s.status === "declined") { const no = { ...a, status: "declined", declinedAt: s.declined_at }; await saveAgreement(no); return no; }
  return a;
}

// Where the agent reads and signs: the DocuSeal page they already started, or a new one. DocuSeal sends
// no email; the portal takes them there, and DocuSeal sends them back to `returnTo` once it's signed.
export async function startAgreement(user, returnTo) {
  const a = await refreshAgreement(user.email);
  if (a?.status === "signed") return a;
  if (a?.status === "pending" && a.templateId === templateId()) return a;
  const [s] = await docuseal("POST", "/submissions", {
    template_id: templateId(), send_email: false,
    submitters: [{ role: ROLE, email: user.email, name: user.name, external_id: user.email, completed_redirect_url: returnTo,
      fields: [{ name: NAME_FIELD, default_value: user.name }] }],
  });
  const next = { email: user.email, status: "pending", submitterId: s.id, submissionId: s.submission_id, templateId: templateId(), url: s.embed_src, startedAt: Date.now() };
  await saveAgreement(next);
  return next;
}

// From DocuSeal's webhook: records a signature on the agreement, including one the team sent from DocuSeal
// itself (matched by the signer's email). Other DocuSeal documents are ignored; the first signature stands.
export async function recordFromDocuSeal(submitterId) {
  const s = await getSubmitter(submitterId);
  if (s.template?.id !== templateId()) return null;
  const email = String(s.external_id || s.email || "").toLowerCase();
  if (!email) return null;
  const a = await getAgreement(email);
  if (a?.status === "signed") return a;
  if (s.status === "completed") { const done = signedFrom(s, "webhook", a || { email }); await saveAgreement(done); return done; }
  if (s.status === "declined" && a?.submitterId === s.id) { const no = { ...a, status: "declined", declinedAt: s.declined_at }; await saveAgreement(no); return no; }
  return a;
}
