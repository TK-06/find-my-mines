# Find My Mines — status and roadmap

Single source of truth for what is built, what is left, and what is blocked.
Update this file whenever a feature lands.

New to the project? Read **[CONTRIBUTING.md](./CONTRIBUTING.md)** for setup, the rules, and
how work is split.

**Last updated:** 2026-10-03 — **Live at https://findmymines.app** (AWS EC2 in Sydney behind a
Cloudflare Tunnel; see build order item 11). New since: **find friends by typing a few letters**
(friends first), **player cards** from the Online now list (stats, View profile, Add friend,
Report behind ⋯), public profiles at **`/u/<username>`**, **player reports** to the server console
(guests too; needs migration 0005 to survive restarts), real visitor addresses behind the tunnel,
the **logo and favicon**, and a README fix so the graded two-computer setup never has anyone type
an IP. Spec: `docs/specs/2026-10-03-friend-search-player-cards-reports.md`.
**2026-10-01 — v3.2 (committed and released since):** **JEV is playable**
(TypeSafe AI, on servers with a `JEV_API_KEY`); the **Fruit Fly is retrained** to play from
its own neurons with no solver, with "sleepy" difficulty; **guests are remembered** for 30 days
by a cookie, with an unofficial Elo and a guest profile; hosting decided: **Cloudflare + AWS**.
Earlier the same day, **v3.1:** Play vs AI became
opponent × difficulty × board — AI, Fruit Fly or JEV; Easy / Medium / Hard; square boards 6–16 with light /
classic / heavy mines, Classic 6×6 with 11 by default — with a logo per opponent and an
"About this opponent" popup that names the language model in use. Profile pictures get a
crop dialog (drag, zoom, pinch). Ranked results show the Elo gained or lost. Large boards
scroll inside their card on phones. Migration 0004 confirmed applied.
**2026-09-29 — v3.0.0:** puzzle mode (single-player Minesweeper with the AI
hint), world chat with invite cards, share links and private rooms, profile pictures, the
experimental Fruit Fly bot, and fixes (whole-number cells only, "Mine"
game log newest first, online-list wording and colours, HTTP rate limit, bundle split, vitest 5,
`npm audit` clean). Earlier the same day: Play vs AI (hybrid bot: solver + Groq LLM, easy /
medium / hard, AI hint, room chat). Build order changed: everything that runs locally first,
AWS last. On 2026-09-28: friends (requests, live status, invites; needs migration
0003), the rebuilt profile page (rating chart, activity heatmap), the 8-bit pixel mine, a site
footer with a contact popup, and privacy / security / terms pages. Earlier the same day:
merged Chain's fork (Vercel + Render hosting, flat redesign, forfeit wins, 30 s reconnect
grace, guests surviving a refresh, sign-up help, `ADMIN_TOKEN`) and fixed ratings drifting
after a player's first ranked room.

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
game** with reasons. It opens on the server machine with no login, for an account listed in
`public.admins` from anywhere else, or — when the server sets `ADMIN_TOKEN` — as
`/admin?token=<value>`. An unset token never opens it. Design:
`docs/specs/2026-09-27-admin-and-online-list.md`; hosting table in `DEPLOY.md`.

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
| 8 | **Play with AI** | **Done 2026-09-29; picker 2026-10-01** | Mandatory AI feature, 2 points. Lobby card "Play vs AI": pick the **opponent** (AI, Fruit Fly, or JEV — JEV only on a server with a `JEV_API_KEY`; without one the tile is greyed, says "isn't set up on this server", and the server refuses it too), the **difficulty** (Easy / Medium / Hard) and the **board** (square, 6×6 to 16×16; Light 20% / Classic / Heavy 40% mines; default Classic 6×6 with 11), then Play → a casual room against e.g. `AI · Hard` or `Fruit Fly · Easy`, started at once, never rated. The choice is remembered per browser. Each opponent has a logo (the pixel robot, a pixel fruit fly with red eyes, TypeSafe AI's logo for JEV — owner-supplied, `client/src/assets/typesafe-ai.webp`; check TypeSafe's brand terms before a public launch). **About this opponent** popup for credibility: how each one plays, the fly's data credit, and the models the server actually uses (`ai:about` → e.g. `openai/gpt-oss-20b` via Groq and `jev-latest` via TypeSafe AI, or "none connected") the bot never hosts; a room left with only the bot closes. **Hybrid bot:** a solver works out each covered cell's mine chance from the numbers on the board (public information only — never the hidden mines); the level (easy / medium / hard) decides how often it makes a deliberate mistake; an LLM on Groq (`openai/gpt-oss-20b` to start, `AI_MODEL` to switch) picks from the shortlist and talks in the room chat. No key, rate limit, slow or bad answer → the solver's own pick, so a turn never stalls. **AI hint** (second AI feature) in games against the bot. **JEV** (done 2026-10-01, `server/src/ai/jev.ts`): plays from the same solver plan as the AI (so its levels and deliberate mistakes match), and TypeSafe's `choice` question picks among the shortlist with each cell's odds in the option text; ~30 calls a minute, a pause after 429/529, the solver's pick on any failure; its chat lines quote its own probability ("JEV: D1 at 64%. Taking it."), none when it did not answer. Fruit Fly: see "Also built" |
| 9 | Matchmaking | **Done** | Casual/Ranked pools, Elo window widens while waiting, auto-start |
| 10 | Elo | **Done** | Live end to end; verified writing to the database |
| 11 | Login: guest (800) / registered | **Done; guests remembered 2026-10-01** | Guest, email/password and **GitHub** live. Google paused until hosting gives a real domain. **Remembered guests:** a first-party cookie `fmm_guest` (30 days from the last visit; name, unofficial rating, ranked W/L/D) gives "Continue as X" / "Not you?" / "Change name" on the name screen; each tab still gets its own seat. The guest's **unofficial Elo** is worked out in the browser with the shared `rateMatch` after ranked results (forfeits too, once per match); the server never sees or trusts it — opponents and matchmaking still rate guests as 800, and it never reaches `/ranks`. Shown on the lobby badge, the result screen ("+20 Elo (unofficial) · 800 → 820") and a guest `/profile` card with "Forget me on this browser". Guest match history now also drops entries older than 30 days. Privacy page updated. Logic in `client/src/data/guestCookie.ts` |
| 12 | Theme | **Done** | Light/dark toggle, remembered, follows the OS by default |
| 13 | Leaderboard | **Done** | Live in-match ranking **and** the persistent `/ranks` page |
| 14 | Leave button | **Done** | Plus host succession and room cleanup |
| 15 | Private room, invite | **Done 2026-09-29** | **Ask to join** (Custom rooms; host accepts / declines). **Friend invites** (see 16). **Share links:** a Share button in every room bar shows the code, the `/join/CODE` link, Copy link (falls back to selecting the text on plain-http LAN), Share on LINE and the phone's share sheet. Opening `/join/CODE` joins once the player has a name, then the address goes back to `/`. **Join by code** box in the lobby (any case; a pasted link works), with Join and Watch. **Private rooms** (Custom only; Classic, matchmaking and AI rooms are always listed): left out of the game list; the online and friends lists say "In a private room" with no code and no Join/Watch; the console still lists them; anyone with the code joins, watches or asks as usual. New event `room:lookup` lets a link or code open the ask-to-join dialog for an unlisted room. **Invite cards** in the world chat (below). Testing a link from a real phone waits for a public address |
| 16 | Online, friends | **Done 2026-09-28** | Lobby shows everyone connected and where they are. **Friends:** requests by exact username (accept / decline / cancel / remove with an inline confirm), a friends list on `/profile` with live status — green online, yellow playing, grey offline — and Watch / Join / Ask / Invite. Invites are checked by the server against `public.friendships` with the service role; guests cannot invite; one invite per friend per 10 s; the popup shows on any page outside a room and expires after 60 s. **Needs migration 0003** (§3). (Chain built the same online list independently; the merge kept this one) |

### Also built (not in the original 14)

| Feature | Status | Notes |
|---|---|---|
| User profile page | **Rebuilt 2026-09-28** | `/profile` in two columns: identity card (initial avatar, inline rename, joined date and day streak, Elo with leaderboard rank and top %, sign out) with Friends under it; stat tiles (matches, win rate, mines found, best Elo), a rating line over the last 30 ranked matches, a year-long activity heatmap, and recent matches linking to the game log. Keyboard-usable chart and heatmap. Pure logic in `client/src/data/profileStats.ts` |
| Profile pictures | **Done 2026-09-29; crop dialog 2026-10-01** | Migration 0004 is applied (checked 2026-10-01: `profiles.avatar_path` exists). Signed-in players add, change or remove a picture on `/profile`. Choosing a file opens **Position your picture**: drag (mouse or finger), zoom with the slider, wheel or a pinch, arrow keys and + / −, with round previews at profile and scoreboard size; the circle is what is saved. The browser then crops that square to 256 px, re-encodes it (WebP, JPEG fallback) and uploads it to the public Supabase Storage bucket `avatars` under their own id's folder; `profiles.avatar_path` keeps only that path (a CHECK and `isOwnAvatarPath` in `shared/src/avatar.ts` both hold it to the owner's folder). Shown on the in-game scoreboard, rankings, friends list, room chat and world chat, with the initial as fallback and a pixel robot for the computer. Sign-in keeps working before 0004 is run (the server retries without the column); the profile card then says the update is needed. A new picture reaches other players when they next load the page, like a rename. Deleting an account by email request must also delete `avatars/<uid>/` (storage is not removed by the auth cascade) |
| Puzzle mode | **Done 2026-09-29** | `/puzzle`: classic single-player Minesweeper, Easy 9×9/10, Medium 16×16/40, Hard 30×16/99. First click and its neighbours always safe, iterative flood fill, flags (right click, long press, F), chording, win auto-flags, loss shows every mine and wrong flags. **AI hint** from the shared solver on the visible board only, 3 per game; games with a hint never set a best time. It also spots a wrong flag the numbers prove safe ("take your flag off it"). Best times in localStorage. Keyboard play on an ARIA grid. Runs entirely in the browser — the one place mines live on a client, fine for single-player — and loads lazily. Engine `shared/src/engine/puzzle.ts`, UI `client/src/components/puzzle/`, state `client/src/data/puzzleStore.ts` |
| World chat + invite cards | **Done 2026-09-29** | Lobby chat under Online now for any named player, guests included: last 50 lines in server memory only (`server/src/state/lobbyChat.ts`), sent to newcomers, 5 lines per 10 s per tab. **Post invite to world chat** in the room bar (seated players, not in a full room, a private room only from its host, one card per 30 s per tab) posts a card with the room's code, board, players and mode; its button follows the live game list (Join / Join next / Ask / Full / Room closed). The console's **Clear world chat** (inline confirm) empties it for everyone and logs it under moderation. Nothing is stored in the database |
| Fruit Fly bot (experiment) | **Done 2026-09-29; retrained 2026-10-01** | **Plays from its own neurons, no solver.** For each covered cell (all of them, or the frontier plus a sample when more than 40) it gets 8 public "smells": share of open neighbours, their numbers, found mines nearby, edge, mines left per covered cell, and the max / mean / min "pressure" of its numbered neighbours (mines still needed ÷ covered cells). 16 ON/OFF channels drive 24 olfactory projection neurons → 200 Kenyon cells → 20 MBONs (male fruit fly connectome, male-cns:v1.0 via neuPrint, 9,076 connections, `circuit.json` unchanged, CC BY 4.0 credit on the card and in the About popup); a logistic readout over the MBONs (`readout.json` format 2, which lists its features and is refused if they ever differ from the code) was retrained on 10,000 seeded Classic games (`scripts/fly/train.ts`). **Sleepy difficulty:** Hard opens its top-scoring cell; Medium and Easy sample from softmax(score / T), T = 0.6 and 1.5 (`FLY_TEMPERATURE`, tuned with `scripts/fly/arena.ts`). **Honest numbers** — held-out picks that are mines: fly 48.4%, the same readout with no circuit 46.0% (+2.4 points, about 2 standard errors: a small lift), a random covered cell 21.1%, the solver's best 59.0% (reference only). Arena, 300 Classic matches each: fly-Hard vs the solver bot on Medium 47.7% wins, vs Easy 88.3%, vs Hard 32.7%; fly-Medium vs Medium 31.0%; fly-Easy vs Medium 13.3%; every level beats a random clicker (91–98%). 10×10, 31 mines, 100 matches: fly-Hard vs Medium 36% (trained on 6×6 only). ~12 ms a move on 6×6, ~63 ms on 16×16. The LLM, when connected, still adds the banter |
| Elo on the result screen | **Done 2026-10-01** | Ranked matches only: under Win / Lost your change in big type ("+14 Elo", green, red, or ±0) with before → after, and each rated player's change beside their score. Forfeit wins show it too. Guests are told they don't keep a rating. Casual results are unchanged |
| Phone-width boards | **Done 2026-10-01** | Main-game cells now size to the phone's width counting the gaps; a board too wide even at the 24 px minimum (16×16) scrolls sideways inside its own box, so the page never does. Desktop unchanged |
| Pixel mine | **Done 2026-09-28** | Mines are an 8-bit bomb with a lit fuse (`MineSprite`, sprite data in `client/src/data/mineSprite.ts`). The spark blinks, except under reduced motion. Dark mode adds a light one-pixel outline. The admin's "show mines" view draws covered mines see-through inside the dashed red border, so they never read as found ones |
| Site footer + contact | **Done 2026-09-28** | Every page: contact, github, terms, security, privacy, the theme toggle (moved from the header) and the version (`client/src/version.ts`, 3.0.0 since 2026-09-29; its link needs the git tag `v3.0.0`). Contact popup with six mail buttons to Palangtaj@gmail.com, subject filled in |
| Privacy, security, terms | **Done 2026-09-28** | `/privacy`, `/security`, `/terms` — text in `client/src/data/policies.ts`, checked against what the code actually stores and logs. Readable signed out and without Supabase |
| Game log page | **Done** | `/games` — history, filter by scope and mode |
| Server dashboard | **Done** | `/admin` — the connection display the assignment asks for |
| Server console v2 | **Done** | Terminal panel, game viewer + mine toggle, kick / ban / end game with reasons, admin-only access |
| Host moderation | **Done** | Host of a casual room a player created can kick or room-ban players and spectators, with reasons |
| Removed page | **Done** | Kicked / banned / room-ended players see who did it and why. Bans are not stored |
| Ask to join | **Done 2026-09-28** | Custom rooms can require the host's approval: request dialog (Cancel / Request / ×), host popup with Accept / Decline, also reachable from the Online now list. Spec: `docs/specs/2026-09-28-join-requests-and-guest-log.md` |
| Guest game log | **Done 2026-09-28** | "Mine" works for guests: the server sends each seat the saved match id and the browser remembers it |
| Classic stays original | **Done 2026-09-28** | A 6×6 / 11-mine / 2-player room always lets anyone join and has no host kick or ban — exactly the assignment |
| Clearer scoreboard | **Done 2026-09-28** | Rows read `8 mines · 800` — the unlabelled all-games total ("8 / 0") is gone from the players' view (the server still keeps it; Reset still clears it). A `next` tag joins `on turn`, from one shared rule (`nextInTurn`, `shared/src/engine/turns.ts`) that the server's turn passing also uses. When the player on turn leaves, the turn now goes to the player after them — before, it jumped to the first player, so the `next` tag would have been wrong |
| Hosted build | **Done — Chain** | Client on Vercel, game server on Render (`vercel.json`, `render.yaml`, `DEPLOY.md`). `PUBLIC_SERVER_URL` / `VITE_SERVER_URL` point the client at it; the LAN setup is unchanged |
| Flat redesign | **Done — Chain** | Grey and ink palette, light and dark, one orange accent for "your turn"; survey-grid board with a draining clock line; self-hosted fonts so the LAN demo works offline. The console, dialogs and online list were restyled to match in the merge |
| Forfeit wins | **Done — Chain** | Leaving mid-match hands the other player the win, **rated in Ranked**. Merge decision: being kicked or banned mid-match counts the same as leaving. An admin *ending* a game still records nothing |
| Reconnect grace | **Done — Chain** | A seated player who drops keeps their seat, score and turn for 30 s and takes it back from the same tab. Merge rules: only the same player gets it back (a tab returning as someone else gives it up at once), and kicking a player whose seat is held frees it |
| Guest survives refresh | **Done — Chain** | The guest name is remembered per tab. A banned guest's name is forgotten, as a banned account is signed out |
| Sign-up help | **Done — Chain** | Explains Supabase's silent "already registered" sign-up, rewrites rate-limit errors, adds "Resend confirmation email" |
| Admin token | **Done — Chain** | `ADMIN_TOKEN` as a third way into `/admin`, compared in constant time. Unset closes that route only |
| Casual vs Ranked modes | **Done** | Elo only moves in Ranked |
| Matchmaking pool on the console | **Done** | `/admin` shows who is queued, their rating, wait and current window |
| Contributor guide | **Done** | `CONTRIBUTING.md` — setup, rules, work split, gotchas |
| Security policy + GitHub security | **Done 2026-09-28** | `SECURITY.md` (report privately through the Security tab). Turned on: private vulnerability reporting, Dependabot alerts, CodeQL code scanning; secret scanning and push protection were already on. First Dependabot findings: 5 moderate (express/body-parser/qs — same-major update fixes them; vitest — dev tooling only, major upgrade). **Fixed 2026-09-29:** `npm audit fix` (express 4.22.3, body-parser 1.20.8, qs 6.16.0) and vitest 3 → 5.0.2 (still one Vite 7.3.6); `npm audit` reports 0 |
| HTTP rate limit | **Done 2026-09-29** | `express-rate-limit`: 600 requests a minute per address on `/health` and the `index.html` fallback, standard `RateLimit` headers, plain 429. The built assets are not counted (a page load is a dozen of them, and tunnel visitors all arrive from one local address). `trust proxy` stays off on purpose (`admin/access.ts`), so behind Render's proxy everyone shares one allowance — fine while Render serves only `/health`. Socket.IO is not affected; chat has its own per-tab limits |
| Bundle split | **Done 2026-09-29** | React, Supabase and socket.io in their own chunks; the admin console and puzzle mode load on first visit, behind a boundary that offers "Reload the page" if a chunk has gone (e.g. after a redeploy) instead of a blank page. Main chunk 528 kB → 131 kB; no chunk over Vite's 500 kB warning |
| Small fixes 2026-09-29 | **Done** | A fractional cell (`row: 2.5`) was accepted and then threw inside the reveal; `inBounds` now takes whole numbers only (unit + e2e). The game log's "Mine" filter shows the newest matches first. The online list says "In the menu" and uses the friends list's green / yellow dots |
| Match history schema | **Applied** | `supabase/migrations/0001_accounts_and_elo.sql`, advisors clean |
| Find friends by typing | **Done 2026-10-03** | `+ Add friend` on `/profile` is a type-ahead now, not an exact-username form. From 2 letters (200 ms pause) it searches public profiles with `ILIKE '%text%'` (`%`, `_`, `\` escaped — checked against the real table), friends searched separately so they are never crowded out. **Friends first**, then online people, then names that start with the text. Each row: Add / Accept / requested / a friend's live Invite-Join-Watch. Arrow keys, Enter, Esc; an ARIA combobox. `client/src/data/playerSearch.ts`, `components/FriendSearch.tsx` |
| Player cards + public profiles | **Done 2026-10-03** | Every name in Online now is a button: yours opens your profile, anyone else's a card — a popover beside the list, a bottom sheet on phones. Accounts: Elo and rank, ranked win rate and games, last 5 results, **View profile** and **Add friend** (Accept / Requested / Friends; "Sign in to add friends" for guests). Guests: name and where they are. ⋯ holds Copy username and **Report player…**. **`/u/<username>`** is a read-only public profile (tiles, rating line, heatmap, recent matches, friend button). `PlayerCard.tsx`, `screens/PlayerProfileScreen.tsx`, router `pathForPlayer` / `playerNameFromPath` |
| Player reports | **Done 2026-10-03** | Anyone named — guests too — reports from a player card: reason (offensive name or picture, harassment, cheating, spam, something else) and optional details. New events `player:report`, `admin:report`, `admin:reports`, and an optional `guestId` on `player:join`. The server fills in both sides from its own records: name, account id, the `fmm_guest` cookie's random id, tab id, IP address, room. Limits: the same player once per 10 min, 5 reports per 10 min, no self-reports. Admins get a **Player reports** card on `/admin` (Resolve / Dismiss / Reopen; Kick and Ban while the player is still connected), every change logged under moderation. Kept in memory and — **after migration 0005** — in `public.reports` (service role only), deleted after 90 days. Privacy and terms pages updated. Rules `shared/src/reports.ts`; server `state/reportStore.ts`, `state/reportLimit.ts`, `persistence/reportRecorder.ts` |
| Real addresses behind the tunnel | **Done 2026-10-03** | Through Cloudflare Tunnel every peer was `127.0.0.1`. `clientAddress()` (`admin/access.ts`) now takes `CF-Connecting-IP` (then the first `X-Forwarded-For`) **only when the peer is loopback**, so the console and reports show the visitor's own address. Admin access is unchanged: forwarded requests still never count as the server machine |
| "Why?" on hints | **Done 2026-10-05 (v3.7.0)** | `shared/src/hintWhy.ts` (pure, tested): `explainHint(view, grid, cell, goal)` returns a facts object (`HintReason`) and a sentence, from the public board only. Cases: forced by one number ("The 1 at A1 still needs 1 mine and touches only B2, so B2 is a mine"; for Puzzle's safe goal, a number whose mines are all found or sure), certain only by combining numbers, likely ("about N%", with the most telling number touching it), and untouched by any number (mines still hidden and slots out of reach). Revealed mines count toward a number; labels via `puzzleCellLabel` (30-wide boards). Server: the `ai:hint` ack carries `why` at once. Then, without delaying the hint, the Groq advisor (same `RateBudget` as the bot) is asked to reword only the facts (`buildWhyMessages`, 4 s timeout); `checkWhy` accepts it only if it is one line ≤ 240 chars, names the hinted cell, names no cell / number / percent absent from the facts, and has no links or markup. A passing wording goes to the asker alone as the new server→client event **`ai:hintWhy`** `{row, col, why}`, and only if they are still seated in the same room and match (`MatchManager.matchNumber`), still playing, the cell still covered and no newer hint taken. The client swaps it in only for the hint on screen. Puzzle computes the plain explanation in the browser when the hint is taken. **Why?** is a collapsed toggle (aria-expanded) reset per hint. e2e checks the ack's `why` names the hinted cell. Checked in Chrome: a vs-AI hint showed Groq's validated rewording within a second; Puzzle's "D1 is safe for sure" explained by "The 1 at E1 already touches a sure mine at D2"; 375 px fits |
| Daily challenge in Puzzle | **Done 2026-10-04 (v3.6.0)** | A fourth "Daily #N" button in Puzzle (#1 = 2026-10-04). Engine (`shared/engine/puzzle.ts`, pure, tested): `dailyKey` = the Bangkok date by UTC+7 arithmetic (no time-zone data); seed = FNV-1a of `fmm-daily-v1:<date>` into `createRng`; the opening cell is drawn from the inner 14×14, then the 40 mines are laid as a first click lays them (opening + neighbours clear) and the opening flood-fills open. **Never change the seed, the draw order, `layMines` or `openCells` in a way that moves mines** — a test pins 2026-10-04's seed, opening and all 40 mines. `DAILY_PRESET` is its own constant so a change to Medium can't change the Daily. Client (`data/dailyStore.ts`, `components/puzzle/Daily*.tsx`): the clock starts at the first click; the first finished game of the day is the result (won/lost, time, hints, % cleared); later games are practice and never recorded; an unfinished first try is saved every move (`fmm.puzzleDailyGame`, open/flagged cells only, never mines) and resumed on reload with the clock still counting, so a reload is neither a free retry nor a loss; the page opens straight back into it. Records in `fmm.puzzleDaily`: per-day results (pruned after 400 days), current streak (consecutive first-try wins ending today or yesterday), best streak, best Daily time (no-hint first-try wins), dailies played. A Daily win never sets Medium's best time. Share copies `Find My Mines Daily #N — 2:31 · 0 hints · findmymines.app/puzzle` (loss: `💥 12% cleared`), with a select-to-copy fallback and the phone share sheet. No shared leaderboard (browser times are easy to fake). Privacy page lists both keys and `fmm.puzzleBest`. Checked in Chrome: board matches the engine (opening H14, 19 cells), resume after reload, loss recorded once, Share text, practice not recorded, 375 px light and dark |
| Sound effects and vibration | **Done 2026-10-04 (v3.5.0)** | Client only; no files and no new dependency. `sound/soundEvents.ts` (pure, tested) turns snapshots into cues: your turn (rising chime + 80 ms vibration), your empty slot (blip, pitch rises with its number), your mine (coin arpeggio), someone else's mine (same, lower and quieter), someone else's empty slot (faint pip), ticks on 3-2-1 of your turn, timeout (falling pair), win / lose / draw (a spectator hears the draw sound), win by forfeit; Puzzle: explosion (noise through a falling filter) and the win fanfare. The server announces a hand-over as the reveal and then `turn:changed`, so the detector remembers a pending hand-over (`handOverDue`) to tell it from a timeout. The first snapshot of a room (joining, spectating, reconnecting) and a reset or rematch are silent. `sound/synth.ts`: one AudioContext made on the first tap or key, master gain 0.2 behind a 5.5 kHz low-pass, ramped envelopes (no clicks), cues that arrive together play in order, an identical cue within 60 ms is dropped. Vibration only where `navigator.vibrate` exists (not iPhone/iPad, said under the switch), never under `prefers-reduced-motion`. Settings `fmm.sound` / `fmm.vibration` in localStorage; privacy page lists them. Checked in Chrome: a vs-AI game scheduled the bot's moves, the turn chime, 3-2-1, the timeout and a mine, and nothing while muted |
| Link preview cards | **Done 2026-10-04 (v3.4.0)** | A pasted findmymines.app link unfurls in LINE, Discord, WhatsApp, X and the like. `client/index.html` carries the default card (description, light/dark `theme-color`, Open Graph, `summary_large_image`) and `client/public/og-image.png` (1200×630; source `brand/og-image.html`, screenshotted with headless Edge, regenerate command at its top). The server's index.html fallback swaps in per-link text: `/join/CODE` → `Join "<room>"` plus host, casual/ranked, board, seats and status; a **private or closed room gets the same generic invitation**, so a card never reveals a private room or whether a code exists. `/u/<name>` → `<name> · <Elo> · <ranked games>`, read by exact username with the service role (`profileForPreview`: username, elo, games_played only); unknown name, no Supabase or a failed lookup → the default card, never a name echoed from the URL. Every value is cleaned (control and bidi characters) and HTML-escaped. Profile lookups are cached 60 s (500 names, "no such player" included), share one request per name in flight, and give up after 1.5 s. `og:url` comes from `PUBLIC_URL` (default `https://findmymines.app`; http(s) only), never from the Host header. Deep links are sent `Cache-Control: no-cache`; the built index.html is re-read only when it changes on disk. e2e section "link previews" (14 checks, including a `<script>` room name and a private room) |
| Find a player in the lobby | **Done 2026-10-04 (v3.3.0)** | The Online now card leads with the number online in big type, then "Find a player": the Friends card's type-ahead, always open, from the first letter. Signed in: Add / Accept / requested / a friend's Join or Watch. Guests: View only, with "Sign in to add friends". Friendship loading and actions moved into `data/useFriendships.ts`, shared by the lobby (`LobbyFriendSearch.tsx`) and the Friends card, whose names (and every search result's) now link to `/u/<name>` (`PlayerLink` in `router.tsx`). The online list below is unchanged — it is the graded roster. Also fixed: the picked option in Play vs AI went near-black and unreadable on hover and after a tap on phones |
| Logo + favicon | **Done 2026-10-03** | The pixel bomb on a signal-orange tile. Sources in `brand/` (SVG, 512 and 120 px PNG for GitHub and Google); `favicon.svg`, `favicon-32.png` and `apple-touch-icon.png` in `client/public/` and linked from `index.html` |

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
| **Add admins** | Paste `supabase/queries/add-admin.sql` into the SQL Editor and run it — it adds Chain (`chainpong`) and lists every admin; change the username to add someone else. Needed only to open `/admin` from a machine other than the server. |
| **Apply `supabase/migrations/0003_friends.sql`** | Friends list and invites. Paste the file into the SQL Editor and run it once. Until then `/profile` says the update is needed and invites are refused. |
| ~~Apply `supabase/migrations/0004_avatars.sql`~~ | **Done** (confirmed 2026-10-01: `profiles.avatar_path` exists; applied outside the migration history, which lists only 0001). Profile pictures (needs 0001). Adds `profiles.avatar_path` with its own-folder CHECK and column grant, the public `avatars` bucket (2 MB; WebP, PNG, JPEG; no SVG), owner-only storage policies, and `avatar_path` on the leaderboard view (still `security_invoker`). Idempotent. Until then the profile card says the update is needed and everything else works without pictures. Afterwards: add, change and remove a picture once while signed in, and check Storage → avatars → your id. |
| Add Google OAuth | **In progress 2026-10-03** — the domain exists now (`findmymines.app`). Consent screen, OAuth client and Supabase provider are being set up; then `VITE_OAUTH_PROVIDERS=google,github` on the server and rebuild. See "Social sign-in" below. |
| **Apply `supabase/migrations/0005_reports.sql`** | Player reports. Paste it into the SQL Editor and run it once. Until then reports reach the console from memory only and are lost on a restart; the server logs "no reports table yet" once. |

**Fixed 2026-09-28 — one malformed message could crash the server.** Any client sending an
event with a missing or odd payload (e.g. `room:join` with nothing) threw inside a Socket.IO
handler, which killed the whole process and every match on it. Now every handler reads its
payload defensively, only calls a reply callback that really is a function, and runs inside
`contain()` (`server/src/safety.ts`) so an unexpected error stays with that one event. The turn
timer and matchmaking tick are contained too, database lookups time out after 5 s (a player
continues as a guest), and a last-resort process guard logs instead of exiting. A port conflict
still exits with a clear message. The e2e suite sends garbage to every event and checks the
server keeps answering.

**Fixed 2026-09-28 — ratings drifting after a player's first ranked room.** The server read a
player's rating once, at sign-in, and never updated it. A second ranked match in a new room
(or a matchmaking pairing) started from the sign-in rating and saved a result computed from it
over the real one — two wins in a row could leave the database showing one. Found while testing
the forfeit merge; each rated result now carries into the player's session (`carryRatings`), and
`test:ranked` plays three ranked matches in different rooms to hold it.

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

Ordered by marks per hour of work. **Decided 2026-09-29: build everything that runs on a laptop
first, reach an almost-final version, then go live on AWS** only for what needs real resources.

1. ~~Supabase go-live~~ — **done**, verified by `npm run test:ranked`.
2. ~~Persistent leaderboard page~~ — **done**, `/ranks`.
3. ~~Theme~~ — **done**.
4. ~~Matchmaking (item 9)~~ — **done**. Casual and Ranked pools, widening Elo window,
   auto-started rooms, live pool on the server console.
5. ~~Online players list + server console v2~~ — **done 2026-09-27**. Closes the graded
   "client receives information about other connected clients" gap. Spec in `docs/specs/`.
6. ~~**Play vs AI + AI hint + room chat (item 8)**~~ — **done 2026-09-29.** Hybrid bot (solver +
   Groq LLM with a strict answer format), three levels, bot lines in a Discord-style room chat,
   hints in games against the bot. `GROQ_API_KEY` in `.env` (server-only); without it the bot
   plays on the solver alone. `npm run ai:eval --workspace @fmm/server` compares models (valid
   answers, speed, real-mine hit rate, agreement with the solver) — try light models and pick the
   final one. First run, 5 boards, `openai/gpt-oss-20b`: 5/5 valid, median 595 ms, ~466 tokens a
   call. Budget: ≤ 20 calls and 6K tokens a minute server-wide (Groq free tier is 30 req / 8K
   tokens a minute), pause after a 429; beyond it the bot plays the solver's pick silently.
   Hints: 3 per player per match, your turn only. Room chat: 5 lines per 10 s, not stored. AI
   matches are recorded like any casual match (the bot as a guest seat).
7. ~~**Puzzle mode**~~ — **done 2026-09-29**, with the AI hint (§2 "Also built").
8. ~~**World chat + invite cards**~~ — **done 2026-09-29**.
9. ~~**Share invite links**~~ — **done 2026-09-29**, with private rooms (item 15). Tested
   locally over sockets; the test from a real phone waits for a public address.
10. ~~**Fruit Fly bot (experiment)**~~ — **done 2026-09-29**, CPU-only on a 244-neuron circuit.
    Retrained 2026-10-01 to play without the solver (numbers in §2). The
    full-brain version (~166k neurons) needs an NVIDIA GPU — a friend's machine or a cloud GPU
    later. Also done that day: profile pictures (migration 0004), the fixes batch and v3.0.0.
11. ~~**Hosting**~~ — **live 2026-10-03 at https://findmymines.app.** What was built differs from
    the plan below: one EC2 `t4g.small` (Arm, Ubuntu 24.04) in **Sydney** (`ap-southeast-2`, the AWS
    project's fixed Region), the game run by a systemd service (`findmymines`, `npm run start`, no
    Docker), the built client served by the same server (no Cloudflare Pages), and a **Cloudflare
    Tunnel** (`cloudflared` service) in front — no inbound web ports; SSH from the owner's IP plus
    EC2 Instance Connect. Supabase Site URL and redirect URLs point at the domain; GitHub sign-in
    works there. Update: `git pull && npm run build && sudo systemctl restart findmymines` on the
    server. The original decision, for the record: **Cloudflare + AWS.** Cloudflare for the domain, DNS and
    HTTPS (and the static client on Cloudflare Pages); the game server as one Docker container
    on AWS EC2 (the existing `Dockerfile`), with CloudWatch for the console stats. One server
    instance on purpose: every room lives in one process's memory, so it scales by instance
    size; several instances would need sticky sessions plus Redis for the lobby, chat and
    matchmaking. Kubernetes was weighed and left out (EKS's control plane alone is ~$73 a month
    and gives nothing while the server is single-instance). Commit everything just before this.
    **Get a real domain as part of this.** It unblocks Google OAuth and fixes sign-up emails
    that return to localhost (Supabase Site URL). Optional here: AWS Bedrock as the model
    provider, a GPU for the full-brain fly. Vercel was ruled out for the game server: its
    WebSockets close at the function's max duration and new connections can land on a different
    instance, while this server keeps every room in one process's memory. **Interim hosting
    exists (Chain):** client on Vercel, server on Render — see `DEPLOY.md`. For temporary public
    access from the server laptop, a Cloudflare quick tunnel also works.
12. **Resume Google OAuth** — after the domain exists: add the three consent-screen links,
    set the authorized domain, publish, then set `VITE_OAUTH_PROVIDERS=google,github`.

**JEV (TypeSafe AI) — playable since 2026-10-01** (see row 8). A probe before building it: on
three seeded Classic boards, given the solver's odds in each option it picked a best-rated cell
3 of 3 times; given the board alone it picked one of the best, one lucky 40% mine and one 2%
empty cell — so it is always offered the odds. Answers in 250–400 ms (`jev-1.13.0`). Still to
do: add it to `ai:eval` next to the Groq models.

### Parked until the game is online

Decided 2026-09-27. Each of these needed a public server — **unblocked since 2026-10-03**, when the game went live.

| Item | Why it waits |
|---|---|
| **AWS stats on the server console** — CPU, memory and network from CloudWatch, shown alongside the socket stats | Can be built now: the instance exists |
| **Test invite links end to end** — copy link, LINE share, phone share sheet | Can be tested now at https://findmymines.app |
| ~~**Admin password** as another way into `/admin`~~ | **Done** — Chain's `ADMIN_TOKEN` (see "Admin token" above) |

### v1.0.0 MVP

Everything scoped for v1.0.0 is built, and since 2026-09-29 so are the AI bot and puzzle mode
(v3.0.0). Hosted since 2026-10-03. Owner items left: apply migration 0005 (reports) and finish
Google sign-in. (The Cloudflare tunnel token was refreshed on 2026-10-03.)

**Extra-points estimate (rubric: AI feature 2, non-AI 1, cap 10, at least one AI feature
required):** AI opponent 2 + AI hint 2 + six of the many non-AI extras already built = 10.
Chat, share links, puzzle mode, profile pictures and the Fruit Fly add demo value, not marks
(the puzzle's hint is the same AI hint feature).

---

## 4a. v3.x plan (agreed 2026-10-03)

One feature per branch, one commit `v3.x.x feat: …`, merged onto `main` with a merge commit and
tagged (CONTRIBUTING.md §5). Built in this order; pushed and deployed together at the end.

| Version | What | Status |
|---|---|---|
| v3.1.0 | Logo and favicon (tag added after the fact) | **Done** |
| v3.2.0 | Friend search, player cards, `/u/<username>`, player reports, real IPs behind the tunnel, README two-computer fix | **Done** — migration 0005 applied |
| v3.3.0 | **Find a player in the lobby**: the Online now card leads with a big online count, then the same type-ahead as `/profile` (guests can look people up, signed-in players add them); search starts at the **first letter**; every name in the Friends card and in search results links to `/u/<name>`. Fix: the picked option in Play vs AI stays readable on hover and after a tap on phones (the ghost hover swapped its fill to near-black and hid the label) | **Done** |
| v3.4.0 | **Link preview cards**: Open Graph / Twitter tags and a 1200×630 `og-image.png`; the server writes a room's name and game into `/join/CODE` cards and a player's Elo into `/u/<name>` cards (`server/src/preview.ts`); private or closed rooms and unknown players get a generic card | **Done** |
| v3.5.0 | **Sound effects and vibration**: 8-bit cues synthesised with Web Audio (no files), quiet, on by default; an 80 ms buzz when your turn starts; a speaker button in the header with Sound and Vibration switches (`client/src/sound/`, `SoundControl.tsx`) | **Done** |
| v3.6.0 | **Daily challenge in Puzzle**: the same 16×16 / 40-mine board for everyone each Bangkok day with the same safe opening already open; first try is the result (reload resumes it), replays are practice; streak, best time and a spoiler-free Share line, kept in this browser | **Done** |
| v3.7.0 | **"Why?" on hints**: a toggle under every hint (vs-AI games and Puzzle) that explains the pick from the visible numbers; in games, a Groq rewording follows when connected, checked before it is shown | **Done** |
| v3.8.0 | Game review after a match: each move rated against the solver, accuracy per player, key moments | Planned |
| v3.9.0 | Fruit Fly brain view: the 244 neurons light up (real wiring, real positions from neuPrint) as the fly decides | Planned |
| v3.10.0 | Server stats on `/admin`: live CPU / memory / load from the server, service health and uptime, CloudWatch CPU, CPU credits and network (needs an IAM role on the instance; the same role also gets `AmazonSSMManagedInstanceCore` for v3.11.0's Session Manager) | Planned |
| v3.11.0 | CI on GitHub Actions and automatic deploy: the server pulls `main` when its CI is green. **Also: SSH into the EC2 from any network** without adding an inbound rule each time (owner's request, 2026-10-04). **Decided: AWS Session Manager** (owner, 2026-10-04): no open port and no IP to keep up to date, signs in through the AWS project, keeps working when the tunnel or the app is down, and Systems Manager is on the Free Tier list. Needs `AmazonSSMManagedInstanceCore` on the instance role (the same role v3.10.0 creates), the SSM agent running on the server (Ubuntu 24.04 ships it as a snap — check), and on the PC the AWS CLI, the Session Manager plugin and an `~/.ssh/config` entry that proxies `ssh` / `scp` / VS Code Remote through `AWS-StartSSHSession`. Then the "My IP" SSH rule is removed; the EC2 Instance Connect prefix-list rule stays as the browser fallback. Walkthrough with the owner | Planned |
| — | Verify on prod: real visitor IPs on `/admin` (the live server still shows 127.0.0.1 until v3.2.0 is deployed) | After deploy |

**Known issue, not scheduled:** during a network blip in an e2e run, a JEV game made no move for a
whole 40 s window, although JEV is meant to fall back to the solver's pick on any failure.

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
npm test            # 920 unit tests: engine, turn order, room config, Elo, matchmaking,
                    #   moderation, join requests, presence, admin access check (incl.
                    #   ADMIN_TOKEN), activity log, handler safety, seat-hold identity,
                    #   session handling, guest history, formatting, friends (status,
                    #   actions, request plan, invite rate limit), profile stats, pixel
                    #   mine sprite, routes, policy text, mine-probability solver (checked
                    #   against brute force), AI levels, hints, Groq advisor (fake fetch),
                    #   bot controller, chat rules and limits, puzzle rules and hint,
                    #   puzzle store, room codes and share links, private-room presence,
                    #   world chat and invite cards, avatar paths and image rules,
                    #   Fruit Fly circuit / features / sleepy picks / readout format,
                    #   JEV picker (fake fetch), guest cookie and unofficial Elo,
                    #   whole-number cells, newest-first "Mine" query, report rules and
                    #   limits and store, real-address check, player search ranking,
                    #   the card's friend button, the guest id, /u/<name> routes
npm run test:e2e    # 253 socket assertions (with a JEV key; the no-key run checks the refusal) — needs a running server; ~30 s of it is the
                    #   reconnect grace period running out. FMM_URL=http://localhost:3100
                    #   points it at a test server on another port
npm run test:ranked # 40 assertions against the real database — needs a server + credentials
                    #   and migration 0002 (applied)
```

The e2e suite covers the online list, host and admin moderation, join requests (ask, cancel,
accept, decline, room closing, no approval bypass through spectating, "accepted" arriving before
the room's state), Classic staying open with no host kick, forfeits and leaving after a match,
the reconnect grace period (held seat, resume, expiry), a tab returning as someone else, kicking
a player whose seat is held, the admin game viewer and mine toggle (mines reach the admin socket
only), the terminal log, remote console connections being refused with `ADMIN_ONLY` (with or
without a guessed token when none is set), the online list carrying each row's account id (null
for guests), friend invites refused for guests, Play vs AI (a bot seat that plays its turns from
public state, hints on your turn only and counting down, room chat reaching every member with its
limits, the room closing when the player leaves), the Fruit Fly seating and moving with no bot
errors (checks a fresh server — the fly loads its circuit once per process), private rooms
(absent from another player's list but on the console, online rows without the code, join /
watch / ask by code, `room:lookup`, Classic-shaped and garbage values listed), world chat (a line
reaches others, history for newcomers, the sixth line in 10 s refused, invite rules, the console
clearing it), HTTP (`/health` with a `RateLimit` header), a fractional cell refused as a bad move,
player reports (a guest reporting a guest reaches the console with both guest ids, address and
connection; repeats inside 10 minutes, self-reports, offline targets and bad payloads refused; the
console resolves; a malformed guest id is not kept), and garbage payloads on every game and console
event leaving the server running. The signed-in invite path needs two real accounts that are
friends, so it is not in the e2e suite yet.

`test:ranked` creates two confirmed accounts, plays a ranked match and a casual one, then two
ranked forfeits (leaving, and an admin kick) in new rooms, checks that the rows landed and the
ratings moved correctly each time, then deletes everything it made.

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
