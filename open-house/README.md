# Open House Coordinator

Weekly open house request system for George & Noonan Real Estate Group listings at Synergy Realty, LLC. Synergy agents request a day and time on a listing, the George & Noonan team approves it, and the system enters the open house on the MLS (NTREIS) and emails the confirmation.

## What's here

| Path | Contents |
|------|----------|
| `portal/index.html` | Example request page agents receive a link to. Static prototype with sample data. |
| `emails/` | HTML email templates, the George & Noonan logo, and a merge-field reference. |

## Weekly flow

1. George & Noonan team chooses which listings are offered and adds open house instructions for each.
2. Agents open the portal, pick a residential sale listing, a day (Saturday or Sunday) and an hourly time range between 9:00 AM and 7:00 PM.
3. Request Received email goes to the George & Noonan team; Request Sent email goes to the agent.
4. First approval locks the slot. The MLS entry is made and verified, then the Confirmed email goes to both, with access details and a calendar invite.
5. Unanswered requests close Friday at 5:00 PM.
6. Reminder email goes to both the day before at 9:00 AM CT.

## Business rules

- Only active residential listings for sale appear. Land and lease listings are excluded.
- Only Synergy roster agents can request.
- Agents can submit more than one request per listing; overlapping hours are blocked.
- Gate, lockbox and alarm codes appear only in the Confirmed and Reminder emails, never on the portal or in request emails.

## Prototype notes

The portal uses sample time blocks, a sample sign-in and sample instructions. Listing data comes from NTREIS via the Repliers API. Listing photos load from the Repliers CDN and the map from a Google Maps embed. Production should load listings, availability and requests from the agent server.

## Sign-in and access control

Agents sign in with Google. The server checks every sign-in against an allowlist, so only approved people get in. Code lives in `netlify/functions/` (repo root) (the `/api/*` routes) and `portal/auth.js`.

**Netlify environment variables**

| Variable | Purpose |
|----------|---------|
| `GOOGLE_CLIENT_ID` | OAuth Web client ID from Google Cloud Console. Authorized JavaScript origin: `https://open-house.synergyrealtors.com` |
| `SESSION_SECRET` | Random string, 32+ characters, used to sign the login cookie |
| `ADMIN_EMAILS` | Comma-separated admin emails. Admins can always sign in and use `/admin/` |
| `ALLOWED_EMAILS`, `ALLOWED_DOMAINS` | Optional starting lists. Admins manage the live list at `/admin/` |

Nothing is allowed by default: with no admins and no allowed entries, no one can sign in. Removing someone at `/admin/` ends their access right away.

## Requests and email (Resend)

`POST /api/requests` saves a request (Netlify Blobs) and sends templates 1 and 2. The team opens the Approve or Decline link, which goes to `/respond/`, signs in with Google, and confirms. Approving requires ticking "entered on the MLS" and then sends template 3 with the calendar invite. `netlify/functions/reminders.mjs` runs hourly, sends template 4 at 9:00 AM Central the day before, and expires unanswered requests after the Friday cutoff.

| Variable | Purpose |
|----------|---------|
| `RESEND_API_KEY` | Resend API key (sends from openhouse@synergyrealtors.com) |
| `REPLIERS_API_KEY` | Repliers API key (read-only). Listings come from agents 492946 (Troy George) and 560617 (Lucy Noonan): active, residential, for sale, land excluded |
| `TEAM_EMAIL` | Optional. Team inbox(es), comma-separated. Defaults to team@georgeandnoonan.com |
| `TEAM_EMAILS` | Optional. Extra people who may approve. Admins (`ADMIN_EMAILS`) can always approve |

The weekend is calculated automatically (next Saturday and Sunday, rolling over at Friday 5:00 PM Central). The team turns listings on for the weekend, and adds instructions and access details, at `/inventory/`. Those details are stored in Netlify Blobs, not in MLS data, and access details are never sent to the browser. Open houses already on the MLS (Repliers `openHouse`) block those hours.

See `../docs/PROJECT_SUMMARY.md` for the full project summary, architecture, configuration and open issues.

## Running locally

```bash
cp .env.example .env     # then fill in the values (run from the repo root)
npm install
npm run dev              # http://localhost:8888
```

- Use `http://localhost:8888`, not a plain file server: the `/api` functions and sign-in only run under Netlify's dev tool.
- Add `http://localhost:8888` as an Authorized JavaScript origin on the Google OAuth client.
- Set `TEAM_EMAIL` to your own address. With a real `RESEND_API_KEY`, local requests send real emails.
- Local data (requests, offered listings, settings) is stored in a local Netlify Blobs sandbox and never touches production.
- `.env` is git-ignored. Secret variables in Netlify are not available locally, which is why the local values live in `.env`.
