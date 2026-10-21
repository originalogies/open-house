# MLS automation: webhook contract with the MLS bot

Last updated: 2026-10-21

When the George & Noonan team approves, changes or cancels an open house, the portal asks the MLS bot (Grokbot, running the `mls-open-house` skill) to make the NTREIS Matrix entry match. This document is the contract between the portal and the bot.

## How it works

Each request stores what the MLS **should** show (an open house while the request is approved, nothing otherwise) and what the bot last **confirmed** it shows (`sync.current`). When the two differ, the `mls-sync` scheduled function (every minute) sends one job:

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

## Modes (`MLS_BOOKING_MODE`)

| Mode | What happens |
|---|---|
| `off` (default) | Nothing is sent. The approve page keeps the "I have entered this on the MLS" box; changes and cancellations remind the team to update the MLS by hand. |
| `dry_run` | Jobs are sent with `"dry_run": true`. The bot fills the form and validates, then cancels. Use this to test. |
| `live` | The bot submits to the MLS. Switching from `dry_run` to `live` re-sends any job that only had a dry run. |

## Webhook (portal → bot)

`POST GROKBOT_WEBHOOK_URL`, JSON body:

```json
{
  "request_id": "9f1c…32 hex",
  "job_id": "job_4be0c2a1d9f37e55",
  "action": "update",
  "mls_number": "21413668",
  "address": "1704 Overlook Drive, Grapevine, TX 76051",
  "type": "Public",
  "date": "2026-10-25",
  "start": "14:00",
  "end": "16:00",
  "timezone": "America/Chicago",
  "original_date": "2026-10-24",
  "original_start": "13:00",
  "original_end": "16:00",
  "original_type": "Public",
  "approved_by": "team@georgeandnoonan.com",
  "approved_at": "2026-10-21T14:02:00.000Z",
  "dry_run": false,
  "callback_url": "https://open-house.synergyrealtors.com/api/mls/callback"
}
```

- Times are 24-hour Central. `original_*` appear on `update` and `cancel`. For `cancel`, `date/start/end` repeat the entry being cancelled and `remove_method` is `"cancel"` (set Status to Canceled, keep the record).
- Access details (gate, lockbox, alarm) are never sent.
- Headers: `X-OH-Timestamp` (Unix seconds), `X-OH-Signature` (hex HMAC-SHA256 of `` `${timestamp}.${rawBody}` `` with `MLS_WEBHOOK_SECRET`), `Idempotency-Key` (= `job_id`).
- **The bot should:** verify the signature, reject timestamps more than 5 minutes old, answer `2xx` within 15 seconds (then do the work), never run the same `job_id` twice, and run one job at a time.
- If the webhook call fails (non-2xx, timeout), the portal retries after 2 and 4 minutes, then marks it failed and emails the team. Nothing is retried once the bot has accepted a job.

## Callback (bot → portal)

`POST /api/mls/callback`, signed the same way (same secret, same headers), JSON body:

```json
{
  "request_id": "9f1c…",
  "job_id": "job_4be0c2a1d9f37e55",
  "result": "updated",
  "message": "Entry saved as Active in Open Houses; OH icon pending",
  "screenshot_base64": "<PNG or JPEG, up to 5 MB>"
}
```

| `result` | Meaning | Portal does |
|---|---|---|
| `booked` / `updated` / `cancelled` | Change verified on the MLS | Marks the MLS as matching |
| `already_done` | The MLS already showed it (e.g. duplicate check) | Marks the MLS as matching |
| `dry_run` | Dry run finished, nothing submitted | Shows "Dry run passed" |
| `needs_login` | Sign-in or the verification code failed | Emails the team; waits for Retry |
| `failed` | Anything else, including an overlapping open house found on the MLS form; the bot stopped without submitting | Emails the team; waits for Retry |

Callbacks for an unknown, old or already-finished `job_id` are ignored. If no callback arrives within **30 minutes**, the job is marked stalled and the team is emailed. A late callback after that is ignored; when the team clicks Retry, the bot's duplicate check reports `already_done` if the first run did post.

## Team and agent actions

- **Agents** can cancel their own pending or approved requests from the portal until the open house starts (the weekly cutoff doesn't apply). Time changes go through the team.
- **Team** (`/respond/?id=…`, the same link as the approve email): change the date/hours of an approved open house (Saturday or Sunday, 9 AM to 7 PM, no overlap with another approved open house or with an open house already on the MLS per Repliers), cancel it, retry a failed MLS job, see the MLS status, the bot's screenshot and the full history.
- Changes send the agent an "Updated" email with a calendar invite that updates the existing event (same UID, higher SEQUENCE) and reset the day-before reminder. Cancellations send a calendar cancellation. The requester's approval email still goes out at approval, not when the MLS booking finishes.

## Conflict checks

Overlapping open houses are caught in two places:

1. **Portal:** new requests and team time changes are checked against approved requests and against the listing's open houses on the MLS (from Repliers). The request's own MLS entry is ignored when it's being moved. If Repliers can't be reached, a change still goes through and the team sees a warning.
2. **Bot:** before adding or updating, the bot checks the Active entries on the Matrix Open Houses form. An exact match is reported as `already_done`; an overlap stops the job as `failed`. This is the final check, since Repliers can lag behind the MLS.

## Where things are stored (Netlify Blobs)

| Store | Key | Contents |
|---|---|---|
| `open-house-requests` | `req/<id>` | The request, including `sync` (MLS status, current job, delivery retries) and `history` of time changes |
| `open-house-audit` | `evt/<id>/<timestamp>-<rand>` | One entry per event: approved, declined, changed, cancelled, retry, webhook sent, bot result, stalled, delivery failed. Who and when; never secrets or access codes |
| `open-house-screenshots` | `shot/<id>/<job_id>.png` | Bot confirmation screenshots, served to the team only by `/api/mls/screenshot?id=…` |
| `open-house-mls` | `inflight` | The one job currently with the bot |

## Settings (Netlify environment variables)

| Variable | Purpose |
|---|---|
| `MLS_BOOKING_MODE` | `off`, `dry_run` or `live`. Default `off`. |
| `GROKBOT_WEBHOOK_URL` | Where jobs are sent. |
| `MLS_WEBHOOK_SECRET` | 32+ random characters, shared with the bot, signs both directions. Mark as secret. |

## Rollout

1. Deploy with `MLS_BOOKING_MODE=off` (no behaviour change except agent cancel and team change/cancel).
2. Build the bot's webhook receiver and callback against this contract. Set the URL and secret.
3. Switch to `dry_run` and approve a test request. Check the bot's dry-run result, screenshot and history on the request page.
4. Switch to `live`.
