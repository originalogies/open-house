# MLS automation: webhook contract with the MLS bot

Last updated: 2026-10-21

When the George & Noonan team approves, changes or cancels an open house, the portal asks the MLS bot (Grokbot, running the `mls-open-house` skill) to make the NTREIS Matrix entry match. This document is the contract between the portal and the bot.

## How it works

To confirm a request for a home on the MLS, the team picks one of two options on the confirmation page (`/respond/?id=…`):

- **Submitted manually**: they entered it on the MLS themselves. The request is stored as `mlsMethod: "manual"` and the bot never touches it, including later changes and cancellations (the team keeps the MLS in step by hand).
- **Schedule Open House with AI Agent** (needs `MLS_BOOKING_MODE` `dry_run` or `live` and `GROKBOT_WEBHOOK_URL`): the button becomes **Start**. Start doesn't approve the request yet. It stays waiting (`status: "pending"` with `approving: { at, by, byName }`), its hours held so no one else can request or be approved for them, and the job goes to the bot straight away (`POST /api/manage {action:"start"}`) instead of waiting for the next minute. **Only when the bot reports the open house is on the MLS (`booked` or `already_done`) does the request become approved and the agent get the Confirmed email** (`/api/mls/callback`). A dry run submits nothing, so it never approves; neither does a failure, a sign-in problem, or a webhook the bot never received. The request then keeps waiting, and the page offers **Retry**, **I entered it on the MLS by hand** (approves it now, as Submitted manually) or **Decline**. The page shows the progress (sent, in line behind another job, bot working, on the MLS and approved, or what went wrong). In the Admin Console the request stays under "Waiting for a decision", marked "AI agent adding it to the MLS", or in red when it needs the team. If its day passes without it reaching the MLS, it expires.

Once the open house is confirmed (by hand, or when the bot reports it's on the MLS), the page shows "Open house confirmed" and a 5-second countdown, then goes to the Open House Portal (`/`). If an email failed to send, it stays put so the team sees the warning.

Each request stores what the MLS **should** show (an open house while the request is approved or being approved with the AI agent, nothing otherwise) and what the bot last **confirmed** it shows (`sync.current`). When the two differ, the `mls-sync` scheduled function (every minute, and right away on Start or Retry) sends one job:

| MLS now (`current`) | MLS should show | Job |
|---|---|---|
| nothing | open house | `add` |
| open house | different date/hours | `update` |
| open house | nothing (cancelled) | `cancel` |
| matches | matches | none |

- **One job at a time** across all requests, so parallel runs never share the NTREIS login. The next job goes out after the bot's callback (or after a stall).
- Jobs for the soonest open house go first.
- Changes made while the bot is working are picked up by a follow-up job. An approval cancelled before the bot runs sends nothing.
- Requests whose open house has already ended are skipped.
- Requests on a home the team added before it's on the MLS are skipped until an admin links the home to its MLS listing. Linking moves the requests to the MLS number, and approved ones then go out as `add` jobs.

## Modes (`MLS_BOOKING_MODE`)

| Mode | What happens |
|---|---|
| `off` (default) | Nothing is sent. The AI agent option on the confirmation page shows as not available, so the team picks "Submitted manually"; changes and cancellations remind the team to update the MLS by hand. |
| `dry_run` | Jobs are sent with `"dry_run": true`. The bot fills the form and validates, then cancels. Use this to test. |
| `live` | The bot submits to the MLS. Switching from `dry_run` to `live` re-sends any job that only had a dry run. |

## Webhook (portal → bot)

Grokbot runs as a Cursor automation, so `GROKBOT_WEBHOOK_URL` is its Cursor webhook (`https://api2.cursor.sh/automations/webhook/…`) and `GROKBOT_WEBHOOK_TOKEN` is the `crsr_…` token Cursor gave for it.

`POST GROKBOT_WEBHOOK_URL` with `Authorization: Bearer <GROKBOT_WEBHOOK_TOKEN>`, JSON body with one job in `items`:

```json
{
  "items": [{
    "request_id": "9f1c…32 hex",
    "job_id": "job_4be0c2a1d9f37e55",
    "action": "update",
    "mls_number": "21413668",
    "address": "1704 Overlook Drive, Grapevine, TX 76051",
    "type": "Public",
    "date": "2026-10-25",
    "start": "14:00",
    "end": "16:00",
    "start_time": "2:00 PM",
    "end_time": "4:00 PM",
    "timezone": "America/Chicago",
    "original_date": "2026-10-24",
    "original_start": "13:00",
    "original_end": "16:00",
    "original_start_time": "1:00 PM",
    "original_end_time": "4:00 PM",
    "original_type": "Public",
    "approved_by": "team@georgeandnoonan.com",
    "approved_at": "2026-10-21T14:02:00.000Z",
    "dry_run": false,
    "callback_url": "https://open-house.synergyrealtors.com/api/mls/callback",
    "callback_token": "64 hex characters, for this job only"
  }]
}
```

- `action` is `add` (a new open house; Grokbot's own test calls this `new`), `update` or `cancel`. There is always exactly one item.
- Times are Central, both 24-hour (`start`, `end`) and 12-hour (`start_time`, `end_time`). `original_*` appear on `update` and `cancel`. For `cancel`, `date/start/end` repeat the entry being cancelled and `remove_method` is `"cancel"` (set Status to Canceled, keep the record).
- Access details (gate, lockbox, alarm) are never sent.
- Headers also carry `X-OH-Timestamp` (Unix seconds), `X-OH-Signature` (hex HMAC-SHA256 of `` `${timestamp}.${rawBody}` `` with `MLS_WEBHOOK_SECRET`) and `Idempotency-Key` (= `job_id`), for a receiver that can check them; Cursor checks the Bearer token instead.
- Cursor answers `{"success": true, "runUuid": "…"}`. The run ID is kept on the job and shown in the request's history, so the run can be found in Cursor.
- **The bot should:** never run the same `job_id` twice, run one job at a time, and always send the callback below when it finishes, whatever happened.
- If the webhook call fails (non-2xx, `"success": false`, or no answer in time), the portal retries after 2 and 4 minutes, then marks it failed and emails the team. Nothing is retried once the bot has accepted a job.

## Callback (bot → portal)

`POST` to the job's `callback_url` (`/api/mls/callback`), JSON body, copying `request_id`, `job_id` and `callback_token` from the job:

```json
{
  "request_id": "9f1c…",
  "job_id": "job_4be0c2a1d9f37e55",
  "callback_token": "the job's callback_token",
  "result": "updated",
  "message": "Entry saved as Active in Open Houses; OH icon pending",
  "screenshot_base64": "<PNG or JPEG, up to 4 MB>"
}
```

| `result` | Meaning | Portal does |
|---|---|---|
| `booked` / `updated` / `cancelled` | Change verified on the MLS | Marks the MLS as matching |
| `already_done` | The MLS already showed it (e.g. duplicate check) | Marks the MLS as matching |
| `dry_run` | Dry run finished, nothing submitted | Shows "Dry run passed" |
| `needs_login` | Sign-in or the verification code failed | Emails the team; waits for Retry |
| `failed` | Anything else, including an overlapping open house found on the MLS form; the bot stopped without submitting | Emails the team; waits for Retry |

Keep `screenshot_base64` to an image of 4 MB or less. A larger image is dropped (the result still counts), and one much over 4 MB pushes the callback past Netlify's 6 MB request limit, so Netlify rejects the whole callback before the portal sees it and the job stalls.

**How the portal knows the result is real.** `callback_token` is made from `MLS_WEBHOOK_SECRET`, which stays on Netlify, and the job ID, so it fits only that job. The bot holds no secret and signs nothing; it copies the token back. Once a job has its result, more callbacks for it are ignored, so a token can't be reused. (A receiver that has the secret may instead sign the callback with the `X-OH-Timestamp`/`X-OH-Signature` headers described above.) The portal answers `200 {"ok":true,"state":"synced"}`, or `401` if the token doesn't match the job.

For example, with the result in `result.json`:

```bash
curl -X POST "<callback_url>" -H "Content-Type: application/json" --data @result.json
```

Callbacks for an unknown, old or already-finished `job_id` are ignored. If no callback arrives within **30 minutes**, the job is marked stalled and the team is emailed. A late callback after that is ignored; when the team clicks Retry, the bot's duplicate check reports `already_done` if the first run did post.

## Team and agent actions

- **Agents** can't cancel on their own. They send a cancellation request for their own pending or approved request from the portal (the home's request panel or My open houses) until the open house starts; the weekly cutoff doesn't apply. Like a new booking, the team gets an email with a link and the request shows in the Admin Console's "Needs a decision" queue. Nothing changes until the team answers: approving cancels it (and the bot cancels the MLS entry), keeping it emails the agent that it's still on. Time changes go through the team.
- **Team** (`/respond/?id=…`, the same link as the approve email): change the date/hours of an approved open house (Saturday or Sunday, 9 AM to 7 PM, no overlap with another approved open house or with an open house already on the MLS per Repliers), cancel it, approve or keep an agent's cancellation request, retry a failed MLS job, see the MLS status, the bot's screenshot and the full history.
- **Admin Console** (`/admin/`): one Requests list. New requests and cancellation requests waiting for a decision are pinned at the top with a **Review** button that opens the confirmation page, where the team decides (Submitted manually or AI agent). A row, or its address, opens its request page, which has the full MLS status; the list shows the MLS only when it needs the team (a failed update, a needed MLS sign-in, or an AI-agent approval that hasn't reached the MLS). Upcoming approved open houses have a Cancel button. The request page's "← Back" returns to the list.
- Changes send the agent an "Updated" email with a calendar invite that updates the existing event (same UID, higher SEQUENCE) and reset the day-before reminder. Cancellations send a calendar cancellation. The requester's Confirmed email goes out at approval: right away when the team entered it by hand, or when the bot reports it's on the MLS when the AI agent does it.

## Conflict checks

Overlapping open houses are caught in two places:

1. **Portal:** new requests and team time changes are checked against approved requests and against the listing's open houses on the MLS (from Repliers). The request's own MLS entry is ignored when it's being moved. If Repliers can't be reached, a change still goes through and the team sees a warning.
2. **Bot:** before adding or updating, the bot checks the Active entries on the Matrix Open Houses form. An exact match is reported as `already_done`; an overlap stops the job as `failed`. This is the final check, since Repliers can lag behind the MLS.

## Where things are stored (Netlify Blobs)

| Store | Key | Contents |
|---|---|---|
| `open-house-requests` | `req/<id>` | The request, including `sync` (MLS status, current job, delivery retries) and `history` of time changes |
| `open-house-audit` | `evt/<id>/<timestamp>-<rand>` | One entry per event: approved, declined, changed, cancellation requested, cancellation kept, cancelled, retry, webhook sent, bot result, stalled, delivery failed. Who and when; never secrets or access codes |
| `open-house-screenshots` | `shot/<id>/<job_id>.png` | Bot confirmation screenshots, served to the team only by `/api/mls/screenshot?id=…` |
| `open-house-mls` | `inflight` | The one job currently with the bot |

## Settings (Netlify environment variables)

| Variable | Purpose |
|---|---|
| `MLS_BOOKING_MODE` | `off`, `dry_run` or `live`. Default `off`. |
| `GROKBOT_WEBHOOK_URL` | Where jobs are sent: Grokbot's Cursor automation webhook. |
| `GROKBOT_WEBHOOK_TOKEN` | The `crsr_…` token for that webhook, sent as `Authorization: Bearer …`. Mark as secret. |
| `MLS_WEBHOOK_SECRET` | 32+ random characters (`openssl rand -base64 32`). Stays on Netlify: it makes each job's `callback_token` and signs outgoing jobs. Grokbot doesn't need it. Required for the AI agent option. Mark as secret. |
| `MLS_CALLBACK_URL` | Optional. By default the bot calls back the site the request was made on. Set this to a tunnel's `/api/mls/callback` address to test a local copy with the real bot. Leave it unset in production. |

## Rollout

1. Deploy with `MLS_BOOKING_MODE=off` (no behaviour change except agent cancellation requests and team change/cancel).
2. Set `GROKBOT_WEBHOOK_URL`, `GROKBOT_WEBHOOK_TOKEN` and `MLS_WEBHOOK_SECRET` on Netlify, and tell Grokbot to send each result to the job's `callback_url` with its `callback_token`. Grokbot runs in Cursor's cloud and can't reach `localhost`, so test against the deployed site, or a local copy behind a tunnel with `MLS_CALLBACK_URL` set.
3. Switch to `dry_run` and approve a test request. Check the bot's dry-run result, screenshot and history on the request page.
4. Switch to `live`.
