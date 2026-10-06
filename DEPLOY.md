# Hosting: EC2, with a Vercel + Render alternative

## Current production: EC2 and Cloudflare Tunnel

`findmymines.app` runs the Node server and built client on one Ubuntu 24.04 EC2
instance in the AWS project's selected Region (`ap-southeast-2`). The `findmymines`
systemd service runs `npm start`; Cloudflare Tunnel forwards to `localhost:3000`.
Live games are in memory, so a restart ends open matches. The Vercel + Render
instructions below describe the older alternative setup.

### CI, automatic releases, and remote access (v3.11)

GitHub Actions runs typecheck, unit tests, build, and a guest-only socket smoke
test for every push and pull request to `main`. The EC2 instance checks the
public workflow result for the exact `main` SHA, builds a new release, then
switches the `current` symlink and checks `/health`. A failed release rolls back
to the prior working release. See [deploy/README.md](./deploy/README.md) for the
first-release cutover, systemd units, dry run, rollback, and end-to-end check.

The owner's `ssh fmm` uses AWS Systems Manager Session Manager. The instance
role has `AmazonSSMManagedInstanceCore`, the agent is online, and the Windows
Session Manager plugin is installed. SSH succeeded through SSM from a public IP
outside the existing security-group allowlist. Keep the EC2 Instance Connect
prefix-list rule; remove personal SSH CIDR rules only after the owner confirms
access on a different network.

### Enable the `/admin` CloudWatch card

First confirm the selected Region in **AWS Settings → View all projects → Overview →
Additional info → Region**. In IAM, create an **EC2 service role** named
`findmymines-ec2`. Attach the managed `AmazonSSMManagedInstanceCore` policy for
the later Session Manager setup. Add this inline policy for the admin graphs:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "ReadMetricsForAdminConsole",
    "Effect": "Allow",
    "Action": ["cloudwatch:GetMetricStatistics", "cloudwatch:ListMetrics"],
    "Resource": "*"
  }]
}
```

In **EC2 → Instances → find-my-mines → Actions → Security → Modify IAM role**,
attach that role. The app obtains its instance ID and Region from IMDSv2 and uses
the role's temporary credentials; no access keys are stored in the app. The
CloudWatch collector requests six EC2 metrics at five-minute resolution, once
per minute only while at least one authorized console is open. The charts show
up to 24 hours of actual points with 1, 6 and 24 hour views. No alerts or
CloudWatch dashboard resources are created.

After the owner deploys the code with the usual `git pull`, `npm ci`,
`npm run build`, and `sudo systemctl restart findmymines` steps, open `/admin`
with an admin account or token. The Server and Service health cards also work
off AWS. The AWS card reports unavailable metadata, credentials, or permission
without affecting the game. `DEPLOY_STATUS_FILE` is optional until the v3.11
auto-deployer writes a status file.

---

```
Browser ──► Vercel   (React client, static)
   └─ Socket.IO ──► Render (Node game server: rooms, timers, console)
                       └──► Supabase (accounts, Elo, match history)
```

Vercel cannot run the game server: its functions are short-lived and cannot
hold WebSocket connections open. The server runs on Render instead, and the
client on Vercel connects to it. The LAN setup in the README keeps working
unchanged.

Do the steps in this order — each one needs a URL from the one before.

## 1. Game server on Render

1. Push this repo to GitHub.
2. Render → **New → Blueprint** → pick the repo. It reads `render.yaml`.
3. Fill the secrets it asks for:

   | Key | Value |
   |---|---|
   | `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | Same page → **service_role / secret** key. Server only. |
   | `CORS_ORIGIN` | `*` for now; tightened in step 3 |

4. Deploy, then open `https://<render-name>.onrender.com/health`. It should
   return `{"ok":true,...}`.
5. Note the generated `ADMIN_TOKEN` (Render → Environment). It is one of three
   ways into `/admin` — see "Who can open the server console" below.

## 2. Client on Vercel

1. Vercel → **Add New → Project** → import the same repo. `vercel.json` sets
   the build. Leave the root directory as the repo root.
2. Environment variables:

   | Key | Value |
   |---|---|
   | `VITE_SERVER_URL` | `https://<render-name>.onrender.com` |
   | `VITE_SUPABASE_URL` | Supabase Project URL |
   | `VITE_SUPABASE_ANON_KEY` | Supabase **anon / publishable** key. Never the service_role key. |
   | `VITE_OAUTH_PROVIDERS` | `github` if GitHub sign-in is set up, otherwise empty |

   Alternatively, set `PUBLIC_SERVER_URL` in `packages/shared/src/config.ts`
   and leave `VITE_SERVER_URL` out. That keeps the address in source code,
   which is what the assignment asks for.
3. Deploy. Vite bakes `VITE_*` values in at build time, so **redeploy after
   changing any of them**.

## 3. Lock the server to the Vercel address

Render → Environment → set `CORS_ORIGIN` to your Vercel address, for example
`https://find-my-mines.vercel.app`. Separate several addresses with commas.

## 4. Supabase

Supabase → **Authentication → URL Configuration**:

- **Site URL:** `https://find-my-mines.vercel.app`
- **Redirect URLs:** add `https://find-my-mines.vercel.app/**`. For preview
  deploys also add `https://*-<your-vercel-team>.vercel.app/**`.

Without this, email confirmation links and GitHub sign-in send people back to
`localhost`.

GitHub OAuth needs no change: its callback is the Supabase URL, not Vercel.
Update the GitHub OAuth app's Homepage URL to the Vercel address (cosmetic).
Google sign-in can now be finished, because Vercel gives you a real https
domain. See the Social sign-in section of `ROADMAP.md`.

## 5. Check

- `https://<vercel>/`: the header shows **● connected**. Play in two browsers.
- `https://<vercel>/admin?token=<ADMIN_TOKEN>`: the server console. Without the
  token (or an admin account) it shows "Admin only", so strangers cannot press
  Reset.

## Who can open the server console

`/admin` lets a connection in if **any** of these holds:

| Way in | Works on | Set up |
|---|---|---|
| The server machine itself | LAN demo laptop | Nothing — open `http://localhost:3000/admin`. Never applies behind Render, a tunnel or any proxy: a forwarding header always refuses it. |
| An admin account | Anywhere | Sign in on the game page with an account listed in `public.admins` (migration `0002_admins.sql`). |
| `ADMIN_TOKEN` | Anywhere | Set it on the server, open `/admin?token=<value>`. |

Leaving `ADMIN_TOKEN` unset only closes the token route; it never opens the
console to everyone.

## Things to know

- **Render free tier sleeps** after 15 minutes idle. The first visit takes
  about 30–60 s to wake it. Open `/health` a minute before a demo.
- **A restart loses live games.** Rooms live in server memory; only finished
  matches reach Supabase.
- **The graded demo should still use the LAN setup** (one machine runs server
  and client, the other runs client only). The hosted version is a bonus.
