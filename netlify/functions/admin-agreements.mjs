import { json, currentUser, adminEmails, parseList } from "../lib/shared.mjs";
import { agreementOn, getAgreement, getSubmitter, listAgreements } from "../lib/agreement.mjs";

// GET /api/admin/agreements             -> { on, agreements: [{ email, name, status, signedAt, startedAt }], exempt }
//                                          who has signed the Support and Referral Agreement, and when
// GET /api/admin/agreements?copy=<email> -> the agent's signed copy, from DocuSeal (its link is looked up each time)
export default async (req) => {
  if (req.method !== "GET") return json(405, { error: "method_not_allowed" });
  const user = await currentUser(req);
  if (!user) return json(401, { error: "signed_out" });
  if (!user.team) return json(403, { error: "team_only" });

  const copy = new URL(req.url).searchParams.get("copy");
  if (copy) {
    const a = await getAgreement(copy);
    if (a?.status !== "signed") return json(404, { error: "not_found" });
    let doc;
    try { doc = (await getSubmitter(a.submitterId)).documents?.[0]?.url; }
    catch (e) { console.error("signed copy failed", e.message); return json(502, { error: "docuseal_unavailable" }); }
    if (!doc) return json(404, { error: "not_found" });
    return new Response(null, { status: 302, headers: { location: doc, "cache-control": "no-store" } });
  }

  const agreements = (await listAgreements()).map((a) => ({
    email: a.email, name: a.signedName || "", status: a.status, signedAt: a.signedAt || null, startedAt: a.startedAt || null,
  }));
  // The team doesn't sign it.
  const exempt = [...new Set([...adminEmails(), ...parseList(process.env.TEAM_EMAILS)])];
  return json(200, { on: agreementOn(), agreements, exempt });
};
export const config = { path: "/api/admin/agreements" };
