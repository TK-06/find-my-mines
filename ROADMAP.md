# Find My Mines — status and roadmap

Single source of truth for what is built, what is left, and what is blocked.
Update this file whenever a feature lands.

New to the project? Read **[CONTRIBUTING.md](./CONTRIBUTING.md)** for setup, the rules, and
how work is split.

**Last updated:** 2026-09-28 — join requests, guest game log, Classic kept to the original rules,
and a fix for signed-in tabs reloading each other forever. AI bot still on hold.

---

## 1. Assignment requirements (25 points)

### (b) Fundamental implementation — 10 points · **COMPLETE**

Every graded row below is implemented and verified by an automated test.

| Requirement | Status | Where |
|---|---|---|
| Socket-based client–server model | Done | `server/src/index.ts`, `client/src/socket.ts` |
| Client never asks for IP or port | Done | `SERVER_URL` constant in `shared/src/config.ts` |
| Server shows connected count **and** client list | Done | `/admin` console **and** stdout `printConsole()` |
| Client receives info about other connected clients | Done 2026-09-27 | Lobby **Online now** list — `lobby:rooms.online`. Before this, clients only got a count. |
| Nickname + welcome message | Done | `player:join` ack |
| 11 mines on a 6×6 grid | Done | `engine/board.ts`, exact by construction |
| Player name and score on the client | Done | `components/Leaderboard.tsx` |
| Server picks the first player at random | Done | `matchManager.startMatch()` |
| All slots start covered | Done | `board.revealed` |
| 10-second turn countdown | Done | `match/turnTimer.ts`, server-authoritative |
| Mine found → keep the turn | Done | `engine/game.ts` `keepsTurn` |
| Empty → adjacent count, then disabled | Done | `RevealedCell.adjacent` |
| 1 point per mine | Done | `outcome.pointsAwarded` |
| Match ends when all mines found | Done | `allBombsFound()` |
| Win/Lost + both scores + Rematch | Done | `components/ResultOverlay.tsx` |
| Previous winner starts the rematch | Done | `matchManager.lastWinnerId` |
| Server Reset button | Done | `/admin` → `roomManager.reset()`, per-room or all |
| One machine runs server + client, another runs client only | Ready | Set `SERVER_HOST` to the LAN IP, see README |

**The professor's "dashboard"** is the `/admin` server console: live client count, the client
list with addresses and which room each is in, open rooms, match status, turn timer, the
matchmaking pool, and Reset. The same information is also printed to the server's stdout, so
it is visible in the terminal without a browser.

Since 2026-09-27 the console also has a **terminal panel** (raw connect / disconnect / room
events, optional game traffic), a **game viewer** with a mine toggle, and **kick / ban / end
game** with reasons. It opens on the server machine with no login, or for an account listed in
`public.admins` from anywhere else. Design: `docs/specs/2026-09-27-admin-and-online-list.md`.

### (a) Demo and creativity — 5 points

Judged on the day. The custom board sizes, free-for-all rooms and the live leaderboard are
the parts worth showing.

### (c) Extra features — up to 10 points

**At least one AI feature is required to claim any AI points.** Extras score **zero** if the
fundamentals are incomplete, so the fundamentals stay protected.

---

## 2. The requested features

| # | Feature | Status | Notes |
|---|---|---|---|
| 1 | Free-for-all | **Done** | Fixed limit or unlimited seats; turns rotate through all |
| 2 | Concurrent rooms | **Done** | One `MatchManager` per room, isolated by socket.io rooms |
| 3 | Map size | **Done** | 4–16 per side, validated on both sides |
| 4 | Number of mines | **Done** | 1 .. rows×cols−1, validated |
| 5 | Landing page | **Done** | Game list, join or spectate |
| 6 | Spectator | **Done** | Extra clients watch; promoted into free seats next match |
| 7 | Create new room | **Done** | Classic preset default, Custom panel, Casual/Ranked |
| 8 | **Play with AI** | **On hold** | Mandatory AI feature, 2 points. Awaiting team discussion |
| 9 | Matchmaking | **Done** | Casual/Ranked pools, Elo window widens while waiting, auto-start |
| 10 | Elo | **Done** | Live end to end; verified writing to the database |
| 11 | Login: guest (800) / registered | **Done** | Guest, email/password and **GitHub** live. Google paused until hosting gives a real domain |
| 12 | Theme | **Done** | Light/dark toggle, remembered, follows the OS by default |
| 13 | Leaderboard | **Done** | Live in-match ranking **and** the persistent `/ranks` page |
| 14 | Leave button | **Done** | Plus host succession and room cleanup |
| 15 | Private room, invite | **Partly done** | **Ask to join** is built (Custom rooms; the host accepts or declines from a popup). Invite cards in world chat and share links come with chat; link testing waits for hosting (§4) |
| 16 | Online, friends | **Online list done** | Lobby shows everyone connected and where they are. Friends not started |

### Also built (not in the original 14)

| Feature | Status | Notes |
|---|---|---|
| User profile page | **Done** | `/profile` — rating, record, rename, recent matches |
| Game log page | **Done** | `/games` — history, filter by scope and mode |
| Server dashboard | **Done** | `/admin` — the connection display the assignment asks for |
| Server console v2 | **Done** | Terminal panel, game viewer + mine toggle, kick / ban / end game with reasons, admin-only access |
| Host moderation | **Done** | Host of a casual room a player created can kick or room-ban players and spectators, with reasons |
| Removed page | **Done** | Kicked / banned / room-ended players see who did it and why. Bans are not stored |
| Ask to join | **Done 2026-09-28** | Custom rooms can require the host's approval: request dialog (Cancel / Request / ×), host popup with Accept / Decline, also reachable from the Online now list. Spec: `docs/specs/2026-09-28-join-requests-and-guest-log.md` |
| Guest game log | **Done 2026-09-28** | "Mine" works for guests: the server sends each seat the saved match id and the browser remembers it |
| Classic stays original | **Done 2026-09-28** | A 6×6 / 11-mine / 2-player room always lets anyone join and has no host kick or ban — exactly the assignment |
| Casual vs Ranked modes | **Done** | Elo only moves in Ranked |
| Matchmaking pool on the console | **Done** | `/admin` shows who is queued, their rating, wait and current window |
| Contributor guide | **Done** | `CONTRIBUTING.md` — setup, rules, work split, gotchas |
| Match history schema | **Applied** | `supabase/migrations/0001_accounts_and_elo.sql`, advisors clean |

---

## 3. Supabase

**Project:** `FindMyMines` · ref `uyodtnchsjvxqzalcsmh` · region ap-southeast-1 (Singapore)
· free tier, $0/month.

Schema is **applied and verified**. `get_advisors(security)` returns zero lints. Three
checks were run against the live database and all passed:

1. The signup trigger creates a profile at Elo 800 with the requested username.
2. A non-`service_role` update **cannot** move `elo` or `wins` — the freeze trigger holds.
3. `apply_match_result` called as `service_role` does move them, and increments `games_played`.

### Remaining manual steps (dashboard only)

| Step | Why |
|---|---|
| ~~Paste the secret key into `.env`~~ | **Done.** Server reports "Supabase connected". |
| ~~Add GitHub OAuth app~~ | **Done.** Enabled and live. |
| ~~Apply `supabase/migrations/0002_admins.sql`~~ | **Done 2026-09-27.** `public.admins` exists; `test:ranked` confirms a non-admin is refused, an admin is let in, and the public key gets "permission denied". |
| **Add yourself as an admin** | The `insert` statement at the bottom of the migration file, with your username. Needed only to open `/admin` from a machine other than the server. |
| Add Google OAuth | **Paused** until hosting — needs a real domain. See "Social sign-in" below. |

**Fixed 2026-09-28 — one malformed message could crash the server.** Any client sending an
event with a missing or odd payload (e.g. `room:join` with nothing) threw inside a Socket.IO
handler, which killed the whole process and every match on it. Now every handler reads its
payload defensively, only calls a reply callback that really is a function, and runs inside
`contain()` (`server/src/safety.ts`) so an unexpected error stays with that one event. The turn
timer and matchmaking tick are contained too, database lookups time out after 5 s (a player
continues as a guest), and a last-resort process guard logs instead of exiting. A port conflict
still exits with a clear message. The e2e suite sends garbage to every event and checks the
server keeps answering.

**Fixed 2026-09-28 — signed-in tabs reloading each other forever.** supabase-js broadcasts
`SIGNED_IN` to every other tab whenever a tab loads with a stored session; the client reloaded
on any auth event, so two open tabs bounced each other. It now reloads only when the signed-in
identity changes, and the socket reads the token itself at handshake time.

**Note on "Supabase connected":** the startup line only means the keys are present in `.env`;
the server does not contact the database at boot. A free-tier project pauses after about a week
without activity — resume it in the dashboard. A paused database does not error loudly: signed-in
players quietly become guests.

### Social sign-in (Google / GitHub)

The buttons are **hidden by default**. An unconfigured provider fails with
"Unsupported provider", and a button that cannot work is worse than no button.

To turn them on, all three steps are needed:

1. Create an OAuth app on the provider — Google Cloud Console, or GitHub → Settings →
   Developer settings → OAuth Apps. The callback URL is
   `https://uyodtnchsjvxqzalcsmh.supabase.co/auth/v1/callback`.
2. Paste the client id and secret into Supabase → Authentication → Sign In / Providers,
   and enable the provider.
3. Set `VITE_OAUTH_PROVIDERS=google,github` in `.env` (either name alone also works), then
   rebuild the client.

#### Status: GitHub live, Google PAUSED

**GitHub OAuth is configured and enabled** — `VITE_OAUTH_PROVIDERS=github`.

**Google OAuth is paused until hosting is done**, because publishing its consent screen needs
three public URLs that cannot exist on `localhost`:

| Field | What it needs |
|---|---|
| Application home page | Public link to the running app |
| Application privacy policy link | Public page |
| Application terms of service link | Public page |

Plus an **Authorized domain** matching them.

Two separate Google blockers, both solved by the same thing — a real domain:

1. Authorized JavaScript origins must be `https` and cannot be a raw IP.
2. The consent screen above cannot be published without public links.

**Resume Google after AWS hosting**, once the domain exists. Until then the Google button
stays hidden, and email/password plus guest cover every sign-in need. If Google is wanted
before that, the fallback is leaving it in "Testing" and adding each person under
Google Auth Platform → Audience → Add users (cap 100 for the app's lifetime).

Email/password and guest play work without any of this.

#### When you deploy — what changes, and one blocker

The **callback URL never changes**. OAuth always bounces through Supabase, never through the
game server, so `https://uyodtnchsjvxqzalcsmh.supabase.co/auth/v1/callback` stays as-is in
both Google and GitHub.

What does change:

| Where | Change |
|---|---|
| Supabase → URL Configuration | Site URL, and add `https://<host>/**` to Redirect URLs |
| Google → Authorized JavaScript origins | Add `https://<host>` |
| GitHub → Homepage URL | Update (cosmetic) |
| `shared/src/config.ts` | `SERVER_HOST` → the public address, then rebuild the client |

**Blocker: Google rejects a bare EC2 IP.** Authorized JavaScript origins must be `https`, and
Google does not accept raw IP addresses — it requires a real domain. `http://54.x.x.x:3000`
fails on both counts.

Options, cheapest first:

1. **Free subdomain + Caddy** — DuckDNS or nip.io, with Caddy in front for automatic Let's
   Encrypt certificates. About 20 minutes of work.
2. **ALB + ACM certificate** — fits the EC2/CloudWatch/ELB plan, but still needs a domain.
3. **Drop Google in production** — GitHub only validates the (unchanged) Supabase callback, so
   it survives a bare IP. Email/password and guest play work over plain HTTP too.

**Email confirmation stays ON** — a deliberate choice, not an oversight. Consequence for the
demo: every new account needs a real inbox before it can sign in, so create the demo accounts
*before* demo day, or use **Play as guest**, which needs no account at all.

The server still runs **guest-only with no persistence** when the keys are absent, and that
path is covered by a regression test.

---

## 4. Build order

Ordered by marks per hour of work.

1. ~~Supabase go-live~~ — **done**, verified by `npm run test:ranked`.
2. ~~Persistent leaderboard page~~ — **done**, `/ranks`.
3. ~~Theme~~ — **done**.
4. ~~Matchmaking (item 9)~~ — **done**. Casual and Ranked pools, widening Elo window,
   auto-started rooms, live pool on the server console.
5. ~~Online players list + server console v2~~ — **done 2026-09-27**. Closes the graded
   "client receives information about other connected clients" gap. Spec in `docs/specs/`.
6. **Chat + invites** — **next.** World chat in the lobby, in-room chat, invite cards posted
   into world chat, share links (copy, LINE, phone share sheet), optional private rooms
   (item 15).
7. **Puzzle mode** — classic single-player Minesweeper (first click safe, flood-fill, flags),
   as its own mode. After chat. Scores as a non-AI feature and reuses the engine.
8. **AI opponent (item 8)** — **on hold, pending team discussion.** Worth 2 points and
   mandatory to claim *any* AI points, so it should not slip far. Options on the table:
   constraint propagation over the revealed numbers, or an LLM opponent (mind the 10-second
   turn and demo-day network). Reuses `shared/engine`, so a solver is testable without a socket.
9. **AWS hosting** — last, once the feature set is frozen (EC2, CloudWatch, ELB).
   **Get a real domain as part of this.** It unblocks Google OAuth in two ways at once, and
   Google is the only feature currently parked. See "When you deploy" under Social sign-in.
   Vercel was considered and ruled out for the game server: its WebSockets close at the
   function's max duration and new connections can land on a different instance, while this
   server keeps every room in one process's memory. For temporary public access before AWS,
   run a Cloudflare quick tunnel from the server laptop.
10. **Resume Google OAuth** — after the domain exists: add the three consent-screen links,
    set the authorized domain, publish, then set `VITE_OAUTH_PROVIDERS=google,github`.

### Parked until the game is online

Decided 2026-09-27. Each of these needs a public server, so revisit them once hosting is done.

| Item | Why it waits |
|---|---|
| **AWS stats on the server console** — CPU, memory and network from CloudWatch, shown alongside the socket stats | Needs the EC2 instance to exist |
| **Test invite links end to end** — copy link, LINE share, phone share sheet | A link only works when the server has a public address |
| **Admin password** (`ADMIN_PASSWORD`) as a second way into `/admin` | Admin access is account-based for now; a password comes later |

### v1.0.0 MVP

Everything scoped for v1.0.0 is built **except the AI bot**, which is on hold pending the
team discussion. Remaining before hosting: that bot, and optionally puzzle mode.

**Extra-points estimate:** AI opponent 2 + LLM assistant 2 + leaderboard 1 + matchmaking 1 +
theme 1 + puzzle 1 = 8 of the 10 available, with chat/emotes in reserve.

---

## 4b. Matchmaking rules

Two pools, Casual and Ranked, never mixed. A player's Elo tolerance starts at **±100** and
widens by **50 every 5 seconds**, capped at **±800**.

Pairing uses the **tighter** of the two players' windows, so someone who just joined is never
force-matched against a long-waiting player expecting a close game. Longest waiter is served
first, and each gets their closest-rated available opponent.

A paired match **auto-starts** — neither player chose the room, so there is no meaningful host
to wait on. Entering a room or disconnecting removes you from the pool automatically.

---

## 5. Verification

Every claim of "done" above is backed by a command that can be re-run.

```
npm run typecheck   # clean across all three packages
npm test            # 223 unit tests: engine, room config, Elo, matchmaking, moderation,
                    #   join requests, presence, admin access check, activity log,
                    #   handler safety, session handling, guest history, formatting
npm run test:e2e    # 130 socket assertions — needs a running server
npm run test:ranked # 32 assertions against the real database — needs a server + credentials
                    #   and migration 0002 (applied)
```

The e2e suite covers the online list, host and admin moderation, join requests (ask, cancel,
accept, decline, room closing, no approval bypass through spectating), Classic staying open with
no host kick, the admin game viewer and mine toggle (mines reach the admin socket only), the
terminal log, a remote-looking console connection being refused with `ADMIN_ONLY`, and garbage
payloads on every game and console event leaving the server running.

`test:ranked` creates two confirmed accounts, plays a ranked match and a casual one, checks
that the rows landed and the ratings moved, then deletes everything it made.

Two regression gates:

1. `test:e2e` must keep passing **with Supabase unconfigured**. If it ever needs credentials,
   something has been wired wrong.
2. The secret key must never appear in `packages/client/dist`. Check with the key's own value,
   not the string `service_role` — supabase-js contains that string legitimately.

---

## 6. Open question for the instructor

The spec says a player who finds a mine *"continues their turn until time runs out."* Read
literally the countdown does **not** restart, and that is what is implemented. If the
instructor means a fresh 10 seconds per mine, set `BOMB_RESETS_TIMER = true` in
`shared/src/config.ts`. One line, nothing else changes.
