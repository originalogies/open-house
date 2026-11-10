# Open house email templates

All emails send from openhouse@synergyrealtors.com. Merge fields use `{{double_braces}}` (Handlebars syntax).

| # | Template | Sent to | Trigger | Subject |
|---|----------|---------|---------|---------|
| 1 | Request Received | gn-team@ | Agent submits a request | Open house request: {{address}}, {{day_name}} {{date}}, {{time_range}} |
| 2 | Request Sent | Requesting agent | Agent submits a request | Request sent: open house at {{address}}, {{day_name}} {{date}} |
| 3 | Request Confirmed | Agent + gn-team@ | First approval, after MLS entry is verified | Confirmed: open house at {{address}}, {{day_name}} {{date}}, {{time_range}} |
| 4 | Open House Reminder | Agent + gn-team@ | Day before at 9:00 AM CT | Reminder: open house at {{address}} {{relative_day}}, {{time_range}} |
| 5 | Feedback Request | Hosting agent | As an approved open house ends (only within 3 days of it) | How did your open house at {{address}} go? |
| 5 | Feedback Reminder (same template, `is_reminder`) | Hosting agent | Once, 3 hours after it ends if no feedback yet, or when the team presses "Email a reminder" | Reminder: how did your open house at {{address}} go? |

The hourly job runs on the hour, which is when open houses end, so the feedback request goes out as the open house ends. The team's copy of an agent's feedback has no HTML template; it's a short email built in `netlify/lib/email.mjs`:

| Email | Sent to | Trigger | Subject |
|-------|---------|---------|---------|
| Feedback received | gn-team@ | Agent sends feedback at /feedback/ | Open house feedback: {{address}}, {{day_name}} {{date}} (starts "⚠ Flagged for broker:" when flagged) |

## Merge fields

Listing: `address`, `city`, `zip`, `mls_number`, `list_price`, `photo_url`, `map_url`, `listing_url`

- `photo_url` is the listing photo cropped to a 3:2 landscape (1072×715) by Netlify's image CDN, so a portrait photo doesn't run tall; the templates show it at 536×357.
- `map_url` is a Google Maps search for the address. The address in each template's Property row links to it.

Request: `request_id`, `day_name`, `date`, `time_range`, `received_at`, `agent_notes`, `other_requests`, `relative_day` ("tomorrow"), `arrival_time` (start minus 30 minutes)

Agent: `agent_name`, `agent_first_name`, `agent_phone` (only on older requests; the form no longer asks for it), `agent_email`

Approval: `approve_url`, `decline_url`, `approver_name`, `approved_at`, `ics_url`

Feedback (template 5): `feedback_url` (the agent's feedback form for this open house), `is_reminder` (true for the reminder)

Instructions: `instructions` (list of general notes), `access_details` (gate, lockbox and alarm codes)

## Rules

- `access_details` appears only in templates 3 and 4. Never include it in 1 or 2.
- `approve_url` and `decline_url` must be single-use, signed links tied to the approver's roster email.
- Attach `open-house.ics` to template 3.

## Logo

All five templates use the George & Noonan logo (`gn-logo.png`, included here). The templates load it from https://open-house.synergyrealtors.com/gn-logo.png (the copy in `portal/`). If you host it elsewhere, update the `src` in each template and rerun `npm run build:templates`.
