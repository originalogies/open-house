import { json, getAccess, isAllowed, makeSession, sessionCookie, sameOrigin } from "./_lib.mjs";

const ISSUERS = ["accounts.google.com", "https://accounts.google.com"];

export default async (req) => {
  if (req.method !== "POST" || !sameOrigin(req)) return json(405, { error: "method_not_allowed" });
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return json(500, { error: "not_configured" });

  const { credential } = await req.json().catch(() => ({}));
  if (!credential || typeof credential !== "string") return json(400, { error: "missing_credential" });

  // Google verifies the signature and expiry; we check audience, issuer and email.
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  if (!res.ok) return json(401, { error: "invalid_token" });
  const t = await res.json();
  if (t.aud !== clientId || !ISSUERS.includes(t.iss) || Number(t.exp) * 1000 < Date.now()) {
    return json(401, { error: "invalid_token" });
  }
  if (String(t.email_verified) !== "true" || !t.email) return json(401, { error: "email_not_verified" });

  const email = t.email.toLowerCase();
  if (!isAllowed(email, await getAccess())) return json(403, { error: "not_allowed", email });

  const name = t.name || email;
  return json(200, { email, name }, { "set-cookie": sessionCookie(makeSession({ email, name })) });
};
export const config = { path: "/api/auth/google" };
