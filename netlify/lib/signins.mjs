import { getStore } from "@netlify/blobs";
import { readAll } from "./readall.mjs";

// The sign-in log behind the Admin Console's Sign-ins page (admin-signins.mjs): each time someone signs in, is turned
// away, or signs out (auth-google.mjs, logout.mjs). One blob per event, "signin/<ms>-<random>", so two sign-ins at the
// same moment never overwrite each other. Kept for a year; older ones are deleted when the log is read.
// A sign-in that fails on Google's own page (accounts.google.com) never reaches the site, so it can't be logged.
//   { at, result, email, name, device: "iPhone · Safari", page: "/admin/" }
// result: signed_in | not_allowed (not on the access list) | email_not_verified | invalid_token | signed_out
const NAME = "open-house-signins";
export const KEEP_DAYS = 365;
const store = () => getStore({ name: NAME, consistency: "strong" });

// "iPhone · Safari", "Mac · Chrome", "Android · In-app browser": the device and browser, from the browser's user agent.
// Apps that open links in their own browser (Facebook, Gmail and others on iPhone) show as an in-app browser.
const OSES = [[/iPhone|iPod/, "iPhone"], [/iPad/, "iPad"], [/Android/, "Android"], [/CrOS/, "Chromebook"],
  [/Windows/, "Windows"], [/Macintosh|Mac OS X/, "Mac"], [/Linux/, "Linux"]];
const BROWSERS = [[/FBAN|FBAV|FB_IAB/, "Facebook app"], [/Instagram/, "Instagram app"], [/LinkedInApp/, "LinkedIn app"],
  [/GSA\//, "Google app"], [/CriOS/, "Chrome"], [/FxiOS/, "Firefox"], [/EdgiOS|EdgA|Edg\//, "Edge"], [/OPR\/|OPiOS/, "Opera"],
  [/SamsungBrowser/, "Samsung Internet"], [/; wv\)/, "In-app browser"], [/Firefox\//, "Firefox"], [/Chrome\//, "Chrome"],
  [/Version\/[\d.]+.*Safari\//, "Safari"]];
export function deviceOf(ua) {
  const s = String(ua || "");
  if (!s.trim()) return "Unknown device";
  const os = OSES.find(([re]) => re.test(s))?.[1];
  // On iPhone and iPad every browser is Safari underneath; one without Safari's own marks is an app's browser.
  const browser = BROWSERS.find(([re]) => re.test(s))?.[1] || (/iPhone|iPad|iPod/.test(s) ? "In-app browser" : null);
  return [os, browser].filter(Boolean).join(" · ") || "Unknown device";
}

// The page they signed in on ("/", "/admin/", "/respond/" …), when the browser says and it's on this site.
function pageOf(req) {
  try {
    const from = new URL(req.headers.get("referer") || "");
    return from.origin === new URL(req.url).origin ? from.pathname : null;
  } catch { return null; }
}

// Logs one event. A failure to log is noted and never stops the sign-in itself.
export async function recordSignIn(req, { result, email, name }, now = Date.now()) {
  const entry = { at: now, result, email: email ? String(email).toLowerCase() : null, name: name || null,
    device: deviceOf(req.headers.get("user-agent")), page: pageOf(req) };
  const key = `signin/${String(now).padStart(13, "0")}-${Math.random().toString(36).slice(2, 8)}`;
  try { await store().setJSON(key, entry); }
  catch (e) { console.error("sign-in log failed", e.message); }
  return entry;
}

// The log, newest first. Entries older than KEEP_DAYS are deleted on the way.
export async function listSignIns(now = Date.now()) {
  const s = store(), cutoff = now - KEEP_DAYS * 24 * 60 * 60 * 1000;
  const all = await readAll(s, NAME, "signin/");
  const old = all.filter(([, e]) => !(e.at >= cutoff));
  if (old.length) await Promise.all(old.map(([key]) => s.delete(key).catch(() => {})));
  return all.filter(([, e]) => e.at >= cutoff).map(([, e]) => e).sort((a, b) => b.at - a.at);
}
