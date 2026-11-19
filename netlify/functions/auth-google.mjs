import { json, getAccess, isAllowed, makeSession, sessionCookie, sameOrigin } from "../lib/shared.mjs";
import { recordSignIn } from "../lib/signins.mjs";

const ISSUERS = ["accounts.google.com", "https://accounts.google.com"];

// Each sign-in that reaches here is logged for the Admin Console's Sign-ins page (signins.mjs): signed in, or why not.
export default async (req) => {
  if (req.method !== "POST" || !sameOrigin(req)) return json(405, { error: "method_not_allowed" });
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return json(500, { error: "not_configured" });

  const { credential } = await req.json().catch(() => ({}));
  if (!credential || typeof credential !== "string") return json(400, { error: "missing_credential" });
  const log = (result, who = {}) => recordSignIn(req, { result, ...who });

  // Google verifies the signature and expiry; we check audience, issuer and email.
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  if (!res.ok) { await log("invalid_token"); return json(401, { error: "invalid_token" }); }
  const t = await res.json();
  if (t.aud !== clientId || !ISSUERS.includes(t.iss) || Number(t.exp) * 1000 < Date.now()) {
    await log("invalid_token", { email: t.email, name: t.name });
    return json(401, { error: "invalid_token" });
  }
  if (String(t.email_verified) !== "true" || !t.email) {
    await log("email_not_verified", { email: t.email, name: t.name });
    return json(401, { error: "email_not_verified" });
  }

  const email = t.email.toLowerCase();
  const name = t.name || email;
  if (!isAllowed(email, await getAccess())) { await log("not_allowed", { email, name: t.name }); return json(403, { error: "not_allowed", email }); }

  await log("signed_in", { email, name: t.name });
  return json(200, { email, name }, { "set-cookie": sessionCookie(makeSession({ email, name }), req) });
};
export const config = { path: "/api/auth/google" };
