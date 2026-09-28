# Security policy

Find My Mines is a student project (Net-Centric course), maintained on a best-effort basis.
Reports are still taken seriously — thank you for looking.

## Supported versions

Only the latest release on `main` is supported. Older tags (`v1.x`) get no fixes.

| Version | Supported |
|---|---|
| `main` / `v2.0.0` | Yes |
| `v1.x` | No |

## Reporting a vulnerability

**Please do not open a public issue, pull request or discussion for a security problem.**

Report it privately through GitHub instead:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Describe what you found, how to reproduce it, and what an attacker could do with it.

If you cannot use GitHub, email Palangtaj@gmail.com with the same details.

Only the maintainers can see a GitHub report. Expect a first reply within about a week; a fix,
or an explanation of why it will not be fixed, follows once the problem is understood. You
will be credited in the advisory unless you ask not to be.

## What is in scope

- The game server (`packages/server`): Socket.IO events, room and match state, the
  `/admin` console and its access checks.
- The web client (`packages/client`), including anything that leaks data a player should
  not see — for example mine positions reaching a player's browser.
- The database rules in `supabase/migrations` (row-level security, rating protection).
- A secret committed to this repository — the Supabase **service-role key** above all.
  If you spot one, report it straight away.

## Out of scope

- Denial of service by flooding a free-tier deployment.
- Problems in Supabase, Vercel, Render or Cloudflare themselves — report those to the
  provider.
- Findings that need physical access to the server machine (it is allowed into `/admin`
  by design, so the course demo works without a database).
