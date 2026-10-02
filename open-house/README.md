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
