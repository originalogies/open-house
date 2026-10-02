# Open house email templates

All emails send from openhouse@synergyrealtors.com. Merge fields use `{{double_braces}}` (Handlebars syntax).

| # | Template | Sent to | Trigger | Subject |
|---|----------|---------|---------|---------|
| 1 | Request Received | gn-team@ | Agent submits a request | Open house request: {{address}}, {{day_name}} {{date}}, {{time_range}} |
| 2 | Request Sent | Requesting agent | Agent submits a request | Request sent: open house at {{address}}, {{day_name}} {{date}} |
| 3 | Request Confirmed | Agent + gn-team@ | First approval, after MLS entry is verified | Confirmed: open house at {{address}}, {{day_name}} {{date}}, {{time_range}} |
| 4 | Open House Reminder | Agent + gn-team@ | Day before at 9:00 AM CT | Reminder: open house at {{address}} {{relative_day}}, {{time_range}} |

## Merge fields

Listing: `address`, `city`, `zip`, `mls_number`, `list_price`, `photo_url`, `map_url`, `listing_url`

Request: `request_id`, `day_name`, `date`, `time_range`, `received_at`, `agent_notes`, `other_requests`, `relative_day` ("tomorrow"), `arrival_time` (start minus 30 minutes)

Agent: `agent_name`, `agent_first_name`, `agent_phone`, `agent_email`

Approval: `approve_url`, `decline_url`, `approver_name`, `approved_at`, `ics_url`

Instructions: `instructions` (list of general notes), `access_details` (gate, lockbox and alarm codes)

## Rules

- `access_details` appears only in templates 3 and 4. Never include it in 1 or 2.
- `approve_url` and `decline_url` must be single-use, signed links tied to the approver's roster email.
- Attach `open-house.ics` to template 3.

## Logo

All four templates use the George & Noonan logo (`gn-logo.png`, included here). The templates load it from https://synergyrealtors.com/email/open-house/gn-logo.png, so copy it to `email/open-house/` in the synergy-realtors repo as well. If you host it elsewhere, update the `src` in each template.
