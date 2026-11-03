import crypto from "node:crypto";
import { json } from "../lib/shared.mjs";
import { agreementOn, templateId, recordFromDocuSeal } from "../lib/agreement.mjs";

// POST /api/agreement/webhook, called by DocuSeal (Settings, Webhooks) when someone finishes or declines a form.
// It records a signature even if the agent never comes back to the portal after signing. Nothing in the
// body is trusted: the submitter is looked up in DocuSeal, so a forged call can't mark anyone signed.
// With DOCUSEAL_WEBHOOK_SECRET set, DocuSeal must also send it as the webhook's secret, in the
// X-OH-Webhook-Secret header. A failed call (DocuSeal unreachable) answers 502 and DocuSeal retries it.
const EVENTS = ["form.completed", "form.declined"];
const same = (a, b) => typeof a === "string" && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  const secret = process.env.DOCUSEAL_WEBHOOK_SECRET;
  if (secret && !same(req.headers.get("x-oh-webhook-secret"), secret)) return json(401, { error: "unauthorized" });
  const b = await req.json().catch(() => null);
  const d = b?.data;
  // Other events, and other DocuSeal documents, aren't ours (the template id in the body only saves a lookup).
  if (!agreementOn() || !EVENTS.includes(b?.event_type) || !d?.id || (d.template?.id && d.template.id !== templateId())) {
    return json(200, { ok: true, ignored: true });
  }
  try {
    const a = await recordFromDocuSeal(d.id);
    return json(200, { ok: true, status: a?.status || null });
  } catch (e) {
    console.error("agreement webhook failed", e.message);
    return json(502, { error: "docuseal_unavailable" });
  }
};
export const config = { path: "/api/agreement/webhook" };
