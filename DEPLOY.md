# Hosting: Vercel + Render + Supabase

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
5. Note the generated `ADMIN_TOKEN` (Render → Environment).

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
  token it stays "disconnected", so strangers cannot press Reset.

## Things to know

- **Render free tier sleeps** after 15 minutes idle. The first visit takes
  about 30–60 s to wake it. Open `/health` a minute before a demo.
- **A restart loses live games.** Rooms live in server memory; only finished
  matches reach Supabase.
- **The graded demo should still use the LAN setup** (one machine runs server
  and client, the other runs client only). The hosted version is a bonus.
