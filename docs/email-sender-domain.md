# Sending real email (sender domains)

HateD sends verification codes to `.edu`/`.gov` addresses. Delivering those needs a
**verified sender identity** — this is the blocker that stops live sends today.

## Why the sandbox sender is not enough

Resend's shared `onboarding@resend.dev` sender will only deliver to the address
registered on the Resend account itself. Sending to anyone else returns:

```
403 validation_error
"You can only send testing emails to your own email address (...).
 To send emails to other recipients, please verify a domain at resend.com/domains,
 and change the `from` address to an email using this domain."
```

This is not a Resend quirk. Since the Gmail/Yahoo sender rules (Feb 2024) and
Microsoft's (May 2025), **no reputable provider sends to arbitrary recipients with
zero sender setup.** What varies is only *what* you verify — a whole domain is not
always required; verifying a single email address is often enough.

## Options compared

| Provider | Free tier | Domain needed? | Notes |
|---|---|---|---|
| **Resend** (current) | 3,000/mo, 100/day | Yes, to send anywhere | Mailer already implemented. No code change to switch senders — only `MAIL_FROM`. |
| **SMTP2GO** | 1,000/mo, 200/day, permanent | **No** — "single sender email" | ⚠️ Cannot verify a single sender if the address's domain publishes DMARC. `gmail.com` and nearly all `.edu` domains do, so this likely **fails for `@live.vu.edu.au`**. Without a domain: 25/hour cap, no SPF/DKIM alignment. |
| **Brevo** | 300/day | No, but rewritten | Delivers to anyone, but replaces your From with e.g. `you@5000001.t-sender-sib.com` until you authenticate a domain. |
| **Gmail SMTP** | 500 recipients/day | **No** | Needs 2FA + app password and `nodemailer` (first new dependency). Reaches `.edu`/`.gov`. Dev-only in practice. |
| **AWS SES** | pay-per-email | Single email identity | Sandbox restricts recipients until production access is granted. |
| **SendGrid** | ❌ retired | — | Free plan retired 27 May 2025; now 60-day trial then $19.95/mo. |
| **MailerSend** | ❌ retired | — | Free Hobby plan became $7/mo in Oct 2025. |
| **Mailgun** | sandbox only | Yes | Free sandbox restricts recipients to authorized addresses. |
| **Maileroo** | 3,000/mo | Yes (CNAME) | Free-tier verification is reportedly a manual approval bottleneck. |
| **Ethereal / Mailpit** | n/a | n/a | Dev only — never actually delivers. |

## Records Resend requires

After adding a domain in the Resend dashboard, it shows the exact values. The
**names** are always these three:

| Name | Type | Value shape |
|---|---|---|
| `send.<domain>` | MX | `feedback-smtp.<region>.amazonses.com`, priority 10 |
| `send.<domain>` | TXT | `v=spf1 include:amazonses.com ~all` |
| `resend._domainkey.<domain>` | TXT | `p=MIGfMA0GCSq…` (DKIM public key) |

Then set `MAIL_FROM` in `packages/db/.env` to an address at the verified domain and
`npm run send-code -- --email you@example.edu` will deliver for real.

## Free-subdomain route (is-a.dev)

`is-a.dev` hands out free subdomains with MX/TXT support, via a GitHub pull request.
Commit these three files to a fork of `is-a-dev/register`, then open **one** PR:

- `domains/hated.json` — the root registration. Must point at a real, at-least-somewhat-complete
  website for the project (a `URL` redirect is accepted).
- `domains/send.hated.json` — the MX + SPF records.
- `domains/resend._domainkey.hated.json` — the DKIM record. Underscores are allowed
  in intermediate labels, so this filename is valid.

Replace `hated` with the subdomain you want and `<gh-username>` with your GitHub handle.

`domains/hated.json`:

```json
{
  "owner": { "username": "<gh-username>" },
  "records": { "URL": "https://github.com/<gh-username>/hated" }
}
```

`domains/send.hated.json` — paste the MX target and SPF value from the Resend dashboard:

```json
{
  "owner": { "username": "<gh-username>" },
  "records": {
    "MX": [{ "target": "feedback-smtp.us-east-1.amazonses.com", "priority": 10 }],
    "TXT": "v=spf1 include:amazonses.com ~all"
  }
}
```

`domains/resend._domainkey.hated.json` — paste the DKIM value from the Resend dashboard.
If the value is long, split it with the list form (resolvers concatenate the strings):

```json
{
  "owner": { "username": "<gh-username>" },
  "records": { "TXT": ["p=MIGfMA0GCSq…", "…rest of the key…"] }
}
```

### Risks — read before relying on this

1. **is-a.dev is non-commercial.** Its Quickstart states the site must be a
   software-development personal/project site and *"if the website is for commercial
   purposes, we have the right to close the pull request."* Root subdomains must relate
   to software development. A dating app is a commercial product, so maintainers may
   close the PR. PRs are reviewed by hand, so this is a real possibility, not a formality.
2. **Resend calls this a "shared or public domain".** Their docs say Resend sends
   "using a domain you own (i.e., not a shared or public domain)". `is-a.dev` is on the
   Public Suffix List, which is the same category as `*.github.io`. Resend may refuse to
   verify it, and receiving filters treat such domains with suspicion.
3. **New-domain reputation.** Any fresh domain starts with none. University mail systems
   filter aggressively; SPF + DKIM + DMARC and a warm-up matter more than the provider.

### Lower-risk alternatives

- **A real domain (~$1–3 first year for `.xyz`/`.top`)** with free Cloudflare DNS.
  Instant, commercial use is fine, and no PSL/shared-domain objection. Lowest friction.
- **`eu.org`** — free *real* domain, no commercial restriction, but volunteer approval
  can take weeks.

## Current state

`packages/db/.env` holds `RESEND_API_KEY` and `MAIL_FROM="HateD <onboarding@resend.dev>"`.
The API key is send-only scoped, so it cannot list verified domains
(`GET /domains` returns `401 restricted_api_key`). Until a domain is verified, use the
console mailer (`npm run send-code -- --print`) to exercise the flow without delivery.
