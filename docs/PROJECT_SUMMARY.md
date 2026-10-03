# Open House Portal: project summary

Last updated: 2026-10-03

This document records what has been built, how it fits together, how it is configured, and what is still open. For day-to-day usage see `open-house/README.md`; for email template fields see `open-house/emails/README.md`.

## What it is

A weekly open house request system for George & Noonan Real Estate Group listings at Synergy Realty, LLC.

1. The George & Noonan team chooses which listings are offered for the coming weekend and adds instructions and access details.
2. Synergy agents sign in with Google, pick a listing, a day (Saturday or Sunday) and an hourly time range between 9:00 AM and 7:00 PM, and submit a request.
3. The team gets an email with Approve and Decline links. The first approval locks the slot.
4. The agent and the team get a confirmation email (with access details and a calendar invite). A reminder goes out at 9:00 AM Central the day before.

Live site: https://open-house.synergyrealtors.com/ (Netlify, deploys automatically from `main`).

## Architecture

| Piece | Where | Notes |
|-------|-------|-------|
| Static front end | `open-house/portal/` | Plain HTML/CSS/JS. Netlify publishes this folder. |
| API | `netlify/functions/` | Netlify Functions (v2, ES modules). Routes are set with `config.path`. |
| Shared code | `netlify/lib/` | Kept out of `functions/` on purpose (see "Pitfalls"). |
| Email templates | `open-house/emails/*.html` | Bundled into `netlify/lib/templates.generated.mjs` by `scripts/build-templates.mjs`. |
| Storage | Netlify Blobs | Requests, per-listing team info, access list, cutoff setting. |
| Email | Resend | Sends from `openhouse@synergyrealtors.com` (domain verified). |
| Listings | Repliers API (read-only) | See "Open issues". |
| Sign-in | Google Identity Services | Verified on the server; signed HttpOnly session cookie. |

`netlify.toml` and `package.json` live at the repo root, because Netlify builds from the repo root (publish directory `open-house/portal`).

## Pages

| Path | Who | Purpose |
|------|-----|---------|
| `/` | Signed-in agents | Browse offered listings, request a time. |
| `/inventory/` | Team (admins and `TEAM_EMAILS`) | Offer listings for the weekend, set Priority, edit instructions and access details, check Repliers data. (Old `/team/` redirects here.) |
| `/respond/?id=...` | Team | Approve or Decline a request. Approving requires ticking "entered on the MLS". |
| `/admin/` | Admins (`ADMIN_EMAILS`) | Allowed email domains and addresses, weekly request cutoff. |

## Features

**Sign-in and access control**
- Google sign-in. Access is deny-by-default: a person can sign in only if their email address, or their email domain, is on the allowlist (or they are an admin).
- Admins manage the list at `/admin/`. Removing someone ends their access immediately (the list is re-checked on every request).
- Subdomains and look-alike domains do not match an allowed domain.

**Requests and email**
- Submitting a request sends template 1 (Request Received) to `team@georgeandnoonan.com` and template 2 (Request Sent) to the agent.
- Approval sends template 3 (Confirmed) to the agent and the team with an `open-house.ics` attachment. Decline sends a short plain note to the agent.
- Reminder (template 4) runs from an hourly scheduled function and sends at 9:00 AM Central the day before.
- Access details (gate, lockbox, alarm codes) are stored server-side and appear only in the Confirmed and Reminder emails, never in the browser or request emails.
- Overlapping hours are blocked for the same agent and listing, and against any approved request or open house already on the MLS. Agents can have up to 12 open requests.

**Weekly schedule**
- The weekend is calculated automatically (next Saturday and Sunday).
- Request cutoff is an admin setting: a weekly on/off switch with a chosen day and time (Central). Default is on, Friday 5:00 PM. When off, requests stay open until Sunday 7:00 PM and the "Requests close..." message is hidden on the portal.
- When the cutoff passes, agents see the next weekend. Offers and Priority reset each weekend; instructions and access details are kept.
- Pending requests expire once their weekend's cutoff passes.

**Inventory**
- **Offer this weekend** controls which listings agents see; days (Sat/Sun) are chosen per listing.
- **Priority** puts a listing first and highlights its card (blue border and glow, "Priority" badge, same card size). Resets weekly.
- Four listings are built in as a fallback (2006 Nighthawk Court, 6900 Rockingham Court, 69 Cortes Drive, 441 Watermere Drive) and always appear in the inventory list. Live Repliers data replaces them when it returns the same MLS number.

**Design**
- Logo in the header with "OPEN HOUSE PORTAL" beneath; a white logo variant is used in dark mode.
- Mobile responsive; admin settings autosave with toast confirmations.

## Configuration (Netlify environment variables)

| Variable | Required | Purpose |
|----------|----------|---------|
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth Web client ID. Authorized JavaScript origin: `https://open-house.synergyrealtors.com`. |
| `SESSION_SECRET` | Yes | 32+ random characters; signs the login cookie. Mark as secret. |
| `ADMIN_EMAILS` | Yes | Comma-separated admins. Always allowed to sign in. |
| `RESEND_API_KEY` | Yes | Sends email. |
| `REPLIERS_API_KEY` | Yes | Read-only Repliers access. |
| `ALLOWED_DOMAINS`, `ALLOWED_EMAILS` | No | Starting allowlist entries (admins can also manage the list at `/admin/`). |
| `TEAM_EMAIL` | No | Team inbox(es) that receive request emails. Defaults to `team@georgeandnoonan.com`. |
| `TEAM_EMAILS` | No | Extra people allowed to use `/inventory/` and approve requests. |

## API routes

`/api/config`, `/api/me`, `/api/auth/google`, `/api/auth/logout`, `/api/listings`, `/api/requests`, `/api/respond`, `/api/ics`, `/api/inventory/listings`, `/api/admin/access`, `/api/admin/settings`. The hourly job is `reminders` (scheduled, not an HTTP route).

## Testing and deployment

- Run `npm test` (9 tests: allowlist rules, session cookie signing, overlap rules, time helpers, weekend and cutoff logic, Repliers field mapping).
- After editing a file in `open-house/emails/`, run `npm run build:templates` (Netlify also runs it on each build).
- Push to `main` to deploy. Functions take about a minute longer than static files to appear.

## Pitfalls we hit

- Anything in `netlify/functions/` is deployed as a function, and function names may contain only letters, numbers, hyphens and underscores. A test file there (`access.test.mjs`) failed the whole build, so tests live in `test/` and shared code in `netlify/lib/`.
- A `netlify.toml` inside a subfolder is ignored when Netlify builds from the repo root. Keep it at the root.
- The old logo URL used in the email templates returned 404; templates now load the logo from `https://open-house.synergyrealtors.com/gn-logo.png`.

## Open issues and next steps

1. **Repliers listings do not load yet.** Searching Repliers by the MLS agent IDs (`492946` Troy George, `560617` Lucy Noonan) returned zero results. Repliers uses its own internal agent IDs, and a name search also returned nothing. The code now resolves agents through the Repliers `/members` endpoint by matching `boardAgentId`, but this has not been confirmed working. Use **Check Repliers data** on `/inventory/` and compare the output with the members documentation. Until fixed, only the four built-in listings appear. The `class=residential`, `status=A` and `type=sale` filters were confirmed working.
2. **Open house data from Repliers is a guess.** The code reads an `openHouse` array with `startTime` and `endTime` on each listing. The real shape has not been seen. Verify once listings load.
3. **MLS entry is manual.** Repliers is read-only, so the team enters approved open houses on the NTREIS MLS by hand; the approve page requires them to confirm they did.
4. **Not yet built:** an email to agents when a request expires unanswered; a dedicated Declined template (currently a plain message); a restriction limiting requests to a Synergy roster beyond the Google allowlist; the Repliers photo CDN path for built-in listings is unverified.
5. **End-to-end check still worth doing:** submit a real request, approve it, and confirm the Confirmed email, calendar invite and (the next morning) the Reminder arrive and look correct, including the logo.
6. **Cutoff is global.** It repeats weekly; there is no per-week override.

## Decisions worth remembering

- Approve and Decline links open a confirmation page (requiring team sign-in) rather than acting on a plain link click, so email scanners that prefetch links cannot approve a request.
- The browser never receives access details. Listing instructions are shown to agents; access details are not.
- Weekly resets (offers, Priority) were chosen so stale settings do not carry into the next weekend.
