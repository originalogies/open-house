# Open House Portal: project summary

Last updated: 2026-10-24

This document records what has been built, how it fits together, how it is configured, and what is still open. For day-to-day usage see `open-house/README.md`; for email template fields see `open-house/emails/README.md`.

## What it is

A weekly open house request system for George & Noonan Real Estate Group listings at Synergy Realty, LLC.

1. The George & Noonan team chooses which listings are published for the coming weekend and adds instructions and access details. Admins can also add homes that aren't on the MLS yet.
2. Synergy agents sign in with Google, pick a listing, a day (Saturday or Sunday) and an hourly time range between 9:00 AM and 7:00 PM, and submit a request.
3. The team gets an email with Approve and Decline links. The first approval locks the slot.
4. The agent and the team get a confirmation email (with access details and a calendar invite). A reminder goes out at 9:00 AM Central the day before.
5. The MLS bot enters the open house on NTREIS Matrix, and keeps it in step when the team changes or cancels it (see `docs/MLS_AUTOMATION.md`). Off by default.

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
| `/` | Signed-in agents | "This weekend", the page agents land on: browse published listings (Priority first, then highest price first), request a time. A home's details open with a gallery of up to 5 of its photos: swipe on phones, arrows on desktop, "2 / 5" to show where you are. |
| `/my-open-houses/` | Signed-in agents | "My Requests" (called "My open houses" until Oct 2026; the address is unchanged): every George & Noonan open house the agent has asked to host, upcoming and history, with "Request cancellation". |
| `/inventory/` | Team | Redirects to the Admin Console's Listings tab (`/admin/#listings`), where the team publishes listings, sets Priority, edits instructions and access details, and admins add homes that aren't on the MLS yet. |
| `/respond/?id=...` | Team | The confirmation page: confirm or decline a request, or answer an agent's cancellation request. Confirming a home on the MLS needs one of two choices: "Submitted manually" or "Schedule Open House with AI Agent" (Start, then live progress; needs MLS automation on). Once confirmed, a 5-second countdown goes to the Open House Portal. After approval: MLS status and screenshot, change the time, cancel, retry a failed MLS job, history. "← Back" returns to the page that opened it (or the Admin Console's Requests list, when opened from an email). |
| `/admin/` | Team; Agents and Settings tabs for admins (`ADMIN_EMAILS`) | Admin Console. Requests: a time frame by open house date (This week by default, This month, This year, All time, or a custom range with date pickers) sets the stat cards (Requests, Waiting for a decision, Approved, Agents) and the list. Requests and cancellation requests waiting for a decision are pinned at the top of the one list whatever the time frame, with a Review button; status chips and search narrow the list. Filters are kept for the browser tab. Every request shows its MLS status and an "MLS status" link; Cancel for upcoming approved open houses. An agent's page (from Agents or an agent's name) has their stats and every open house they've requested, with a photo of each home, a search by address or MLS#, and pages like the Requests list. Also weekend listings (with the date and time Repliers data was last updated), agent access, weekly request cutoff. |

## Features

**Sign-in and access control**
- Google sign-in. Access is deny-by-default: a person can sign in only if their email address, or their email domain, is on the allowlist (or they are an admin).
- Admins manage the list at `/admin/`. Removing someone ends their access immediately (the list is re-checked on every request).
- Subdomains and look-alike domains do not match an allowed domain.

**Changes and cancellations**
- Agents can't cancel on their own. They send a cancellation request for their own pending or approved request until the open house starts (the weekly cutoff doesn't apply). The team gets an email like a new booking and approves the cancellation or keeps the open house. Time changes go through the team.
- The team can change the date or hours of an approved open house, or cancel it, from the request page (cancel also from the Admin Console). The agent gets an Updated email with a calendar invite that updates the same event, or a calendar cancellation. The reminder is re-sent for a new date.
- Every action and every MLS bot result is logged (Netlify Blobs store `open-house-audit`) and shown as History on the request page.

**Requests and email**
- Submitting a request sends template 1 (Request Received) to `team@georgeandnoonan.com` and template 2 (Request Sent) to the agent.
- Approval sends template 3 (Confirmed) to the agent and the team with an `open-house.ics` attachment. Decline sends a short plain note to the agent.
- The calendar event names the George & Noonan Team (team@georgeandnoonan.com) as organizer and lists it as a guest beside the agent. team@georgeandnoonan.com also gets every email that carries the event (Confirmed, Updated, Cancelled), whatever `TEAM_EMAIL` is set to (`TEAM_CALENDAR` in `netlify/lib/email.mjs`).
- Every home's instructions end with "Please text the George & Noonan Team once you enter the home and when you leave." on the portal and in the Confirmed and Reminder emails (`STANDARD_INSTR` in `netlify/lib/listings.mjs`); the Admin Console notes it under each home's instructions.
- Reminder (template 4) runs from an hourly scheduled function and sends at 9:00 AM Central the day before.
- Access details (gate, lockbox, alarm codes) are stored server-side and appear only in the Confirmed and Reminder emails, never in the browser or request emails.
- Overlapping hours are blocked for the same agent and listing, and against any approved request or open house already on the MLS. Agents can have up to 12 open requests.

**Weekly schedule**
- The weekend is calculated automatically (next Saturday and Sunday).
- Request cutoff is an admin setting: a weekly on/off switch with a chosen day and time (Central). Default is on, Friday 5:00 PM. When off, requests stay open until Sunday 7:00 PM and the "Requests close..." message is hidden on the portal.
- When the cutoff passes, agents see the next weekend. Publishing and Priority reset each weekend; days, instructions and access details stay with the home.
- Pending requests expire once their weekend's cutoff passes.

**Inventory** (Admin Console, Listings tab)
- Tabs: All homes, Published and Unpublished, each with its count. Every card has a Published or Unpublished badge.
- **Publish this weekend** controls which listings agents see; days (Sat/Sun) are chosen per listing.
- **Priority** puts a listing first and highlights its card (blue border and glow, "Priority" badge, same card size). Resets weekly.
- **Vacant** marks a home no one is living in (no occupants). Agents see a "Vacant" tag on the listing's card and in its details. A tooltip explains it in both places: hover or keyboard focus, and a tap in the details on phones. Stays with the home from week to week.
- Changes save automatically (switches right away, text after a short pause) and a toast confirms each save. There is no Save button.
- **Homes not on the MLS yet** (admins): "Add a home" takes the address, price, bedrooms, bathrooms and square feet, then photos (resized in the browser; the first is the cover). These homes work like any listing (publish, Priority, instructions, access details, requests) and show "Coming soon" to agents. Their requests aren't sent to the MLS bot, and approving one doesn't ask for the "entered on the MLS" tick. Stored in Netlify Blobs (`open-house-homes`, photos in `open-house-home-photos`, served publicly by `/api/home-photo` so emails can show them).
- **Linking:** once the home is on the MLS, its card suggests the MLS listing at the same address (or the team picks one). Linking moves the home's settings, instructions, access details and requests to the MLS number, and approved open houses then go to the MLS bot (or, with automation off, the team is told which to enter by hand).
- Four listings are built in as a fallback (2006 Nighthawk Court, 6900 Rockingham Court, 69 Cortes Drive, 441 Watermere Drive) and always appear in the inventory list. Live Repliers data replaces them when it returns the same MLS number.

**Design**
- Top navigation bar on every signed-in page (`nav.js`, `nav.css`): logo with "OPEN HOUSE PORTAL" or "ADMIN CONSOLE" beneath, page links with the current page underlined, the signed-in name and Sign out. Agents see This weekend, My Requests and (for the team) Admin Console; the Admin Console shows Requests, Listings, Agents and Settings (the last two for admins) and Agent portal. Below 760px the links fold into a hamburger menu that slides open and closed. A white logo variant is used in dark mode.
- Mobile responsive; admin settings autosave with toast confirmations.
- Confirmations and questions (cancel, remove, link, a cancellation reason) open the site's own dialog (`dialog.js`, `dialog.css`) instead of the browser's boxes.
- Addresses read street and city everywhere ("200 Murano Place, Southlake"), including email subjects and the calendar event title.
- Status labels match across old and new open houses: past approved open houses read "Approved", not "Hosted".
- Browser tab icon: `favicon.png` (the blue ampersand, 72×72). Home-screen and link-preview icons still use `apple-touch-icon.png` (G&N, 180×180).

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
| `MLS_BOOKING_MODE` | No | `off` (default), `dry_run` or `live`. See `docs/MLS_AUTOMATION.md`. |
| `GROKBOT_WEBHOOK_URL` | For MLS automation | Where MLS jobs are sent: Grokbot's Cursor automation webhook. |
| `GROKBOT_WEBHOOK_TOKEN` | For MLS automation | The `crsr_…` Bearer token for that webhook. Mark as secret. |
| `MLS_WEBHOOK_SECRET` | For MLS automation | 32+ random characters; stays on Netlify. Makes each job's one-time callback token and signs outgoing jobs. Mark as secret. |

## API routes

`/api/config`, `/api/me`, `/api/auth/google`, `/api/auth/logout`, `/api/listings`, `/api/requests`, `/api/requests/cancel-request`, `/api/team/requests`, `/api/respond`, `/api/manage`, `/api/ics`, `/api/inventory/listings`, `/api/admin/homes`, `/api/home-photo`, `/api/admin/access`, `/api/admin/settings`, `/api/mls/callback`, `/api/mls/screenshot`. Scheduled jobs: `reminders` (hourly) and `mls-sync` (every minute).

## Testing and deployment

- Run `npm test` (21 tests, including MLS sync, webhook signing, change and cancel rules, and calendar updates; the original 9: allowlist rules, session cookie signing, overlap rules, time helpers, weekend and cutoff logic, Repliers field mapping).
- After editing a file in `open-house/emails/`, run `npm run build:templates` (Netlify also runs it on each build).
- Push to `main` to deploy. Functions take about a minute longer than static files to appear.

## Pitfalls we hit

- Anything in `netlify/functions/` is deployed as a function, and function names may contain only letters, numbers, hyphens and underscores. A test file there (`access.test.mjs`) failed the whole build, so tests live in `test/` and shared code in `netlify/lib/`.
- A `netlify.toml` inside a subfolder is ignored when Netlify builds from the repo root. Keep it at the root.
- The old logo URL used in the email templates returned 404; templates now load the logo from `https://open-house.synergyrealtors.com/gn-logo.png`.

## Open issues and next steps

1. **The Repliers account has no current data for Troy and Lucy.** The agent filter now works (Repliers stores MLS agent IDs zero-padded: `0492946`, `0560617`; `agent=` accepts them), but the account returns zero active listings for them. It has only four old, sold or terminated condo listings. The whole feed is a snapshot last updated 2026-07-31, and known homes (such as 441 Watermere Drive and 2006 Nighthawk Court) are not in it. Ask Repliers whether this key is a sandbox or sample dataset and request a key tied to the live NTREIS feed. `/inventory/` shows a warning when the feed is more than 3 days old. Until then only the four built-in listings appear.
2. **Open house data is only partly verified.** The code reads an `openHouse` array (`date`, `startTime`, `endTime`, `type`, `status`). Times are UTC and are converted to Central; Deleted and cancelled entries are ignored. Verified against sample data, not against a current listing.
3. **MLS entry is manual until the bot is live.** Repliers is read-only. With `MLS_BOOKING_MODE=off` the team enters approved open houses by hand; the approve page requires them to confirm they did. The bot integration is built on the portal side (`docs/MLS_AUTOMATION.md`); the bot's webhook receiver still needs building, then a dry run.
4. **Not yet built:** an email to agents when a request expires unanswered; a dedicated Declined template (currently a plain message); a restriction limiting requests to a Synergy roster beyond the Google allowlist; the Repliers photo CDN path for built-in listings is unverified.
5. **End-to-end check still worth doing:** submit a real request, approve it, and confirm the Confirmed email, calendar invite and (the next morning) the Reminder arrive and look correct, including the logo.
6. **No team list of approved open houses yet.** The team reaches a request's page from its email link. A dashboard listing every request (with MLS status) is the next step for the admin area.
7. **Cutoff is global.** It repeats weekly; there is no per-week override.
8. **Some MLS map pins are wrong.** The agent portal's "View location" map uses the MLS coordinates from Repliers (emails link to the address). Checked Oct 24 2026: 125 Murano Place is about 15 km off and 200 Murano Place about 3.5 km off (Google has both addresses right, in Carillon Parc); every other listing is within about 0.3 km. New streets Google doesn't know yet (the Westlake Entrada homes on Edson, Otter, Molly and Ellis, and 1920 Serendipity Court) carry subdivision placeholder pins that several homes share. The pin can be corrected on the MLS listing itself, which also fixes it on every site that uses MLS data.

## Decisions worth remembering

- Approve and Decline links open a confirmation page (requiring team sign-in) rather than acting on a plain link click, so email scanners that prefetch links cannot approve a request.
- The browser never receives access details. Listing instructions are shown to agents; access details are not.
- Weekly resets (publishing, Priority) were chosen so stale settings do not carry into the next weekend. Instructions and access details belong to the home and carry over.
- Team-added homes are linked to their MLS listing by a person (one click on the suggested match), not automatically, because linking moves requests and access details.
