import { json, currentUser, sameOrigin } from "../lib/shared.mjs";
import { refreshAgreement, startAgreement } from "../lib/agreement.mjs";
import { siteFor } from "../lib/email.mjs";

// The Support and Referral Agreement, for the signed-in agent (see netlify/lib/agreement.mjs).
// GET  /api/agreement           -> { signed, status }: checks one waiting to be signed with DocuSeal, and records the signature
// POST /api/agreement { from? } -> { signed: true } or { signed: false, url }: the DocuSeal page to read and sign it on.
//                                  `from` is the portal page DocuSeal sends them back to once it's signed.
export default async (req) => {
  const user = await currentUser(req);
  if (!user) return json(401, { error: "signed_out" });
  if (!user.mustSign) return json(200, { signed: true });
  try {
    if (req.method === "GET") {
      const a = await refreshAgreement(user.email);
      return json(200, { signed: a?.status === "signed", status: a?.status || null });
    }
    if (req.method !== "POST" || !sameOrigin(req)) return json(405, { error: "method_not_allowed" });
    const b = await req.json().catch(() => ({}));
    const a = await startAgreement(user, returnTo(req, b?.from));
    return json(200, a.status === "signed" ? { signed: true } : { signed: false, url: a.url });
  } catch (e) {
    console.error("agreement failed", e.message);
    return json(502, { error: "agreement_unavailable", message: "The agreement couldn't be opened. Try again in a minute." });
  }
};

// Back to the page they started from on this site, marked so the page checks the signature straight away.
function returnTo(req, from) {
  const site = siteFor(new URL(req.url).origin);
  let u = new URL("/", site);
  try { const f = new URL(String(from || "/"), site); if (f.origin === u.origin) u = f; } catch {}
  u.hash = ""; u.searchParams.set("agreement", "signed");
  return u.href;
}
export const config = { path: "/api/agreement" };
