import {
  json, currentUser, getAccess, saveAccess, adminEmails, normalizeEmail, normalizeDomain, sameOrigin,
} from "../lib/shared.mjs";

export default async (req) => {
  const user = await currentUser(req);
  if (!user) return json(401, { error: "signed_out" });
  if (!user.admin) return json(403, { error: "admin_only" });

  if (req.method === "GET") {
    const a = await getAccess();
    return json(200, { emails: a.stored.emails, domains: a.stored.domains, env: a.env, admins: adminEmails() });
  }

  if (req.method === "PUT") {
    if (!sameOrigin(req)) return json(403, { error: "bad_origin" });
    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.emails) || !Array.isArray(body.domains)) return json(400, { error: "bad_request" });
    const emails = body.emails.map(normalizeEmail);
    const domains = body.domains.map(normalizeDomain);
    if (emails.includes(null) || domains.includes(null)) return json(400, { error: "invalid_entry" });
    await saveAccess({ emails: [...new Set(emails)].sort(), domains: [...new Set(domains)].sort() });
    return json(200, { ok: true });
  }

  return json(405, { error: "method_not_allowed" });
};
export const config = { path: "/api/admin/access" };
