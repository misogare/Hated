# Sending real email (sender domains)

HateD sends verification codes to `.edu`/`.gov` addresses. Delivering those needs a
**verified sender identity**. The code can send through any SMTP relay or through
Resend's HTTP API (`packages/db/src/mail-config.ts` picks one from the environment).
The current setup is **Brevo over SMTP, which needs no domain at all**; see
[Current setup](#current-setup-brevo-over-smtp).

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
| **Brevo** (current, SMTP) | 300/day (~9,000/mo) | **No** — verify a single sender | Delivers to anyone. Until you authenticate a domain, the From domain is rewritten to a Brevo one (`brevosend.com`). SMTP keys work only from authorized IPs. |
| **Resend** (HTTP API) | 3,000/mo, 100/day | Yes, to send anywhere | Still supported: set `RESEND_API_KEY` (and `MAIL_TRANSPORT=resend` if SMTP is also configured). |
| **SMTP2GO** | 1,000/mo, 200/day, permanent | **No** — "single sender email" | ⚠️ Cannot verify a single sender if the address's domain publishes DMARC. `gmail.com` and nearly all `.edu` domains do, so this likely **fails for `@live.vu.edu.au`**. Without a domain: 25/hour cap, no SPF/DKIM alignment. Works with the SMTP transport. |
| **Gmail SMTP** | 500 recipients/day | **No** | Needs 2FA + an app password. Works with the SMTP transport (`SMTP_HOST=smtp.gmail.com`). Reaches `.edu`/`.gov`. Dev-only in practice. |
| **AWS SES** | pay-per-email | Single email identity | Sandbox restricts recipients until production access is granted. |
| **SendGrid** | ❌ retired | — | Free plan retired 27 May 2025; now 60-day trial then $19.95/mo. |
| **MailerSend** | ❌ retired | — | Free Hobby plan became $7/mo in Oct 2025. |
| **Mailgun** | sandbox only | Yes | Free sandbox restricts recipients to authorized addresses. |
| **Maileroo** | 3,000/mo | Yes (CNAME) | Free-tier verification is reportedly a manual approval bottleneck. |
| **Ethereal / Mailpit** | n/a | n/a | Dev only — never actually delivers. |

## Current setup: Brevo over SMTP

Brevo's free plan includes its SMTP relay. It needs **no domain**: you verify one
sender address and Brevo will deliver to any recipient. Four things must be in
place, and `npm run mail:check` tests each of them in turn.

1. **An SMTP key.** In Brevo, open **SMTP & API → SMTP** and generate an SMTP
   key. The login on that page (`…@smtp-brevo.com`) is `SMTP_USER`; the key is
   `SMTP_PASS`. It is *not* your account password, and Brevo shows it only once.
   It is not an API key either: SMTP keys start with `xsmtpsib-`, while the API
   Keys tab on the same page issues `xkeysib-` keys, which the relay rejects with
   the same bare `535` as a wrong password. `mail:check` names this mix-up.
2. **An authorized IP.** SMTP keys get no learning period: Brevo refuses SMTP from
   any IP not listed under **Settings → Security → Authorized IPs**. Add the public
   IP of every machine that sends: your dev box now, and the server's static egress
   IP later. Home IPs change; when yours does, `mail:check` fails at login and
   says so. The same page can **deactivate blocking**, which works from anywhere
   but means a leaked key can send from anywhere too.
3. **A verified sender.** Under **Senders, Domains & Dedicated IPs → Senders**, add
   the address mail should come from and confirm the code Brevo emails to it. Set
   `MAIL_FROM` to exactly that address.
4. **The environment**, in `packages/db/.env`:

   ```bash
   SMTP_HOST="smtp-relay.brevo.com"
   SMTP_PORT="587"                          # STARTTLS; 2525 also works, or 465 with SMTP_SECURE="true"
   SMTP_USER="<login>@smtp-brevo.com"
   SMTP_PASS="<SMTP key>"
   MAIL_FROM="HateD <the-verified-sender@example.com>"
   ```

   With `SMTP_HOST` set, SMTP is chosen automatically. If `SMTP_PASS` or
   `MAIL_FROM` is missing, the CLIs stop and name the variable rather than falling
   back to Resend.

Then:

```bash
npm run mail:check                           # connects, STARTTLS, logs in; sends nothing
npm run mail:check -- --to you@example.com   # also sends a sample code email
```

### What recipients see without a domain

If `MAIL_FROM` is a free mailbox (`gmail.com`, `outlook.com`, …) or any domain not
authenticated in Brevo, Brevo **rewrites the sender domain to a Brevo-owned
`brevosend.com` address**. This keeps mail compliant with the Gmail/Yahoo sender
rules. The mail still arrives, but recipients see an unfamiliar address, and
strict filters (universities' among them) may score it lower. That is fine for
development and a small pilot. Before launch, authenticate a domain you control.

Do not use a university address such as `@live.vu.edu.au` as the sender: you
cannot publish DNS records for it, so it can never be authenticated, and it
would be rewritten like any other unauthenticated domain.

## Records Brevo requires

Once you own a domain (see the options below), add it under **Senders, Domains &
Dedicated IPs → Domains**. Brevo shows the exact values; the record names are:

| Name | Type | Value shape |
|---|---|---|
| `<domain>` | TXT | `brevo-code:<value from the dashboard>` (proves ownership) |
| `brevo1._domainkey.<domain>` | CNAME | `b1.<value from the dashboard>.dkim.brevo.com` |
| `brevo2._domainkey.<domain>` | CNAME | `b2.<value from the dashboard>.dkim.brevo.com` |
| `_dmarc.<domain>` | TXT | the DMARC policy Brevo suggests (`v=DMARC1; p=none; …`) |

After Brevo shows the domain as authenticated, any address at it works as
`MAIL_FROM` and the `brevosend.com` rewrite stops. No code changes.

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

For **Brevo** the pattern is the same with Brevo's record names (see
[Records Brevo requires](#records-brevo-requires)): the `brevo-code` TXT goes on
`domains/hated.json`, and the other records each get their own file:
`domains/brevo1._domainkey.hated.json` and `domains/brevo2._domainkey.hated.json`
(each a `CNAME`), and `domains/_dmarc.hated.json` (a `TXT`). is-a.dev allows an
underscore in any label except the registered one, as in its own
`_vercel.example.json` example. The repository's validator decides which record
types may share a file.

### Risks — read before relying on this

1. **is-a.dev is non-commercial.** Its Quickstart states the site must be a
   software-development personal/project site and *"if the website is for commercial
   purposes, we have the right to close the pull request."* Root subdomains must relate
   to software development. A dating app is a commercial product, so maintainers may
   close the PR. PRs are reviewed by hand, so this is a real possibility, not a formality.
2. **Providers may call this a "shared or public domain".** Resend's docs say it
   sends "using a domain you own (i.e., not a shared or public domain)". `is-a.dev` is
   on the Public Suffix List, the same category as `*.github.io`. A provider may refuse
   to authenticate it, and receiving filters treat such domains with suspicion.
3. **New-domain reputation.** Any fresh domain starts with none. University mail systems
   filter aggressively; SPF + DKIM + DMARC and a warm-up matter more than the provider.

### Lower-risk alternatives

- **A real domain (~$1–3 first year for `.xyz`/`.top`)** with free Cloudflare DNS.
  Instant, commercial use is fine, and no PSL/shared-domain objection. Lowest friction.
- **`eu.org`** — free *real* domain, no commercial restriction, but volunteer approval
  can take weeks.

## Current state

- **Brevo (SMTP)** is the intended transport. `packages/db/.env` has the relay
  host, port and login; it still needs `SMTP_PASS` (the SMTP key) and `MAIL_FROM`
  set to a Brevo-verified sender, and the sending machine's IP must be
  authorized. From the dev machine, `smtp-relay.brevo.com` accepts connections
  with TLS on 587, 2525 and 465 (checked 2026-10-05).
- **No domain is authenticated**, so Brevo rewrites the From to `brevosend.com`.
  Fine for development; authenticate a domain before launch.
- **Resend** still works via `MAIL_TRANSPORT=resend`, but its sandbox sender
  `onboarding@resend.dev` only reaches the Resend account's own address. The key
  is send-only scoped, so it cannot list verified domains (`GET /domains` returns
  `401 restricted_api_key`).
- To exercise the flow with no delivery at all, use the console mailer:
  `npm run send-code -- --print`.
