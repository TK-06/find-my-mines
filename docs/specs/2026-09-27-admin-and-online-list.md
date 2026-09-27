# Admin console v2 and the players' online list

**Status:** approved 2026-09-27 · **Scope:** sub-project 1 of 3 (then chat + invites, then puzzle mode)

---

## 1. Why

Two goals, one piece of work, because both are about "who is connected":

1. **Close a graded gap.** The rubric gives 1.0 point for *"The client connects to the server first
   and receives information about other connected clients."* Today a player only receives a
   number (`clientCount`), never who those clients are. Extras score zero if the fundamentals are
   incomplete, so this gap puts far more than one point at risk.
2. **Showcase the socket programming** on the server console: a live, raw view of connections,
   plus the controls a real game server has — watch a game, end it, kick and ban players.

## 2. Decisions

| Topic | Decision |
|---|---|
| Admin access | Two ways in: an **admin account** (listed in a new `admins` table) from any machine, or **the server machine itself** with no login. Tunnel/proxy traffic never counts as the server machine. |
| Admin password | Not now. Parked in `ROADMAP.md` §4. |
| Ban persistence | **None, for anyone.** A banned user sees a ban page and can log straight back in. Nothing is stored. |
| Host moderation | Only in rooms made with **Create game** in **Casual** mode (Classic or Custom board). Never ranked, never matchmade. |
| Reasons | Every kick, ban and admin "end game" needs at least one preset reason or a remark. The removed player sees them. |
| Mine toggle | Admins watching a game may reveal mine positions. An admin-only exception to "mines never leave the server". |
| Game traffic | A "Show game traffic" checkbox in the terminal panel, off by default. |
| AWS stats | Later, once hosted. Parked in `ROADMAP.md` §4. |

## 3. Players' online list (the graded fix)

The lobby gets an **Online now (N)** panel next to the game list. One row per connected player
who has picked a nickname (or signed in):

- nickname, with a `you` tag on your own row and a `guest` tag for guests
- where they are: **In menu**, **Looking for a match**, **In room ABCD**, **Playing in ABCD**,
  **Watching ABCD**

It rides on the lobby broadcast the server already sends to every client on every change, so it
is live with no extra polling. Network addresses are **never** included — they stay admin-only.

Where-they-are is derived by a pure function in `shared/presence.ts` from: in the matchmaking
queue?, room id, seat, and that room's match status.

## 4. Kick, ban and reasons

### Reason dialog

One component, used by both the host and the admin:

- checkboxes: **Inactive / AFK**, **Offensive name**, **Harassment or spam**, **Cheating**, **Other**
- a remarks box, at most 200 characters
- confirm is disabled until at least one box is ticked or a remark is written

The server re-validates with the same pure function (`parseRemovalNote` in `shared/moderation.ts`):
unknown reasons are dropped, duplicates removed, the remark trimmed, over-long remarks rejected.

### What the removed player sees

A full-page notice instead of the lobby or game:

| Kind | Page | Button |
|---|---|---|
| Kicked (by host or admin) | "You were kicked from room ABCD by the host (Alice)" / "by an admin", then the reasons and remark | **Back to games** |
| Room closed by admin | "An admin ended the game in room ABCD", then the reasons and remark | **Back to games** |
| Banned (admin only) | "You were removed from the server by an admin", then the reasons and remark | **Log in again** |

A ban disconnects the socket from the server side (so the client does not auto-reconnect) and,
for a signed-in user, signs them out of Supabase in that browser, so "log in again" is literal.
Nothing is stored: they may come straight back.

### Admin powers

- **Kick** — removes a client from its room and from the matchmaking queue; they stay connected
  and land on the kicked page.
- **Ban** — kicks, shows the banned page, disconnects.
- **End game** — every member of the room (players and spectators) lands on the "room closed"
  page; the room is destroyed.
- **Reset** — unchanged.

### Host powers

The host is still derived, never stored: the earliest-joined seated player.

- Allowed only when the room was **created by a player** (`origin: 'created'`) **and** is
  **Casual**. Matchmade rooms and ranked rooms refuse with a message.
- **Kick** — target returns to the menu (kicked page) and may rejoin.
- **Ban** — as kick, and the target may not rejoin this room while it exists. Keyed by account
  id for signed-in users, by connection for guests (a guest who logs in again gets a new
  connection — accepted, consistent with "no stored bans").
- Works on players and spectators, at any time. Kicking the second player of a live two-player
  match abandons that match, exactly as if they had left.
- The host cannot kick themselves or anyone outside the room.
- The ban list belongs to the room, so a new host inherits it.

The rule lives in one pure function, `hostModerationError()` in `shared/moderation.ts`, and the
client uses `hostCanModerate()` from the same file to decide whether to show the buttons.

## 5. Server console (`/admin`) v2

Existing parts stay: the stat tiles, the connected-client list, the matchmaking pool, the room
list, per-room Reset and Reset all.

- **Access gate.** Before the admin socket connects, the server checks the two ways in (§6). A
  refused browser sees "Admin only — sign in with an admin account" with a link to the main page.
- **Clients list** — each row gains **Kick** and **Ban**, and a guest/account tag.
- **Room list** — each row gains **Watch** and **End game** beside Reset.
- **Game viewer** — the watched room's live board, timer and leaderboard (the same components
  the players see), plus the **mine toggle**: a mine icon, drawn with a slash while mines are
  hidden; click to switch. Mines are sent only to that admin socket, only for the watched room,
  only while the toggle is on.
- **Terminal panel** — opens and closes. A monospace, auto-scrolling feed of raw socket events:

  ```
  23:14:02  connect     Kd9x2… from 192.168.1.5 via websocket
  23:14:05  player      Kd9x2… is "Alice" (guest)
  23:14:09  room        Alice created ABCD "Friday" (6×6, 11 mines, casual)
  23:14:31  match       ABCD started — 2 players
  23:15:40  moderation  host Alice kicked Bob from ABCD — Inactive / AFK · "asleep"
  23:16:02  disconnect  Kd9x2… "Alice" — transport close
  ```

  The server keeps the last 200 event lines and the last 200 traffic lines in memory; opening
  the panel backfills them. Event lines (not traffic) are also printed to the server's stdout.
- **Show game traffic** checkbox (off by default) — also shows every event a game client sends,
  for example `← Alice  game:reveal {"row":2,"col":3}`. Access tokens are never logged: they
  travel in the handshake, not in events, and acknowledgement callbacks are stripped.

## 6. Admin access in detail

A Socket.IO middleware on the `/admin` namespace lets a connection in when either holds:

1. **Server machine.** The handshake address is loopback or one of this machine's own network
   addresses, **and** the request carries no forwarding header (`x-forwarded-for`, `x-real-ip`,
   `forwarded`, `cf-connecting-ip`, `true-client-ip`, `x-client-ip`). Tunnels (Cloudflare, ngrok)
   and reverse proxies add those headers, so their traffic never passes as local.
2. **Admin account.** The handshake carries a Supabase access token, the server verifies it with
   `auth.getUser()`, and the user's id is in `public.admins`.

Anything else is refused with the error `ADMIN_ONLY`. The browser's existing sign-in carries over:
the admin page sends the same token the game page uses.

Why keep the server-machine path: the graded **Reset** button lives on `/admin`, and the e2e test
must pass without a database. If the database is unreachable on demo day, the server laptop still
opens `/admin`.

### New table — `supabase/migrations/0002_admins.sql`

`public.admins (profile_id uuid primary key → profiles.id, note text, created_at)`. RLS on, no
policies, all grants revoked from `anon` and `authenticated`: only the game server (service role)
can read it, so nobody can see who the admins are or add themselves. To make an account an admin,
insert its profile id in the Supabase SQL editor (the migration file shows the statement).

Not a column on `profiles`: profiles are publicly readable, which would publish the admin list.

## 7. The "mines never leave the server" rule

Reworded, not removed:

> Mine positions never reach a player's or spectator's client. `publicState()` stays the only
> projection sent to game clients. The one exception is a verified admin socket that has asked to
> see the mines of the room it is watching; that data goes out only on the `/admin` namespace.

`MatchManager.minePositions()` is the only accessor, and only the admin namespace calls it.

## 8. Protocol additions

**Discuss with the team before merging** — `protocol.ts` is the shared seam.

### Types (`shared/types.ts`)

```ts
export type RoomOrigin = 'created' | 'matchmaking';
export type PresenceStatus = 'lobby' | 'queue' | 'room' | 'playing' | 'watching';

export interface OnlinePlayer {
  id: string;
  nickname: string;
  isGuest: boolean;
  status: PresenceStatus;
  roomId: string | null;
}

export interface SpectatorPublic { id: string; nickname: string }

export type RemovalReason = 'afk' | 'offensive-name' | 'harassment' | 'cheating' | 'other';
export interface RemovalNote { reasons: RemovalReason[]; remark: string }
export type RemovalKind = 'kicked' | 'banned' | 'room-closed';
export interface RemovalNotice {
  kind: RemovalKind;
  by: 'host' | 'admin';
  byName: string | null;
  roomId: string | null;
  roomName: string | null;
  roomBan: boolean;
  note: RemovalNote;
}
export interface ModerationResult { ok: boolean; error?: string }

export type LogKind =
  | 'connection' | 'player' | 'room' | 'queue' | 'match' | 'moderation' | 'admin' | 'traffic';
export interface LogLine { id: number; at: number; kind: LogKind; text: string }

export interface MinePosition { row: number; col: number }
export interface AdminRoomView { state: PublicMatchState; mines: MinePosition[] | null }
```

Changed: `PublicMatchState` gains `origin` and `spectators`; `ClientInfo` gains `isGuest`.

### Events (`shared/protocol.ts`)

| Direction | Event | Payload |
|---|---|---|
| server → client | `lobby:rooms` | **adds** `online: OnlinePlayer[]` |
| server → client | `player:removed` *(new)* | `RemovalNotice` |
| client → server | `room:kick` *(new)* | `{ targetId, ban, note }`, ack `ModerationResult` |
| admin → server | `admin:kick`, `admin:ban` *(new)* | `{ clientId, note }`, ack `ModerationResult` |
| admin → server | `admin:closeRoom` *(new)* | `{ roomId, note }`, ack `ModerationResult` |
| admin → server | `admin:watch` *(new)* | `{ roomId: string \| null }` |
| admin → server | `admin:mines` *(new)* | `{ show: boolean }` |
| server → admin | `admin:log` *(new)* | `LogLine[]` (backfill on connect, then live) |
| server → admin | `admin:room` *(new)* | `AdminRoomView \| null` (null when the watched room closes) |

## 9. Code layout

| File | Change |
|---|---|
| `shared/src/moderation.ts` + test | reasons, `parseRemovalNote`, `hostCanModerate`, `hostModerationError` |
| `shared/src/presence.ts` + test | `presenceOf` |
| `server/src/admin/access.ts` + test | `isServerMachine`, `ownAddresses` |
| `server/src/admin/activityLog.ts` + test | ring buffers, listener |
| `server/src/admin/adminNamespace.ts` | the whole `/admin` namespace, moved out of `index.ts` |
| `server/src/supabase.ts` | `adminAccountFromToken` |
| `server/src/match/matchManager.ts` | origin, spectators list, room bans, `minePositions()`, member ids |
| `server/src/rooms/roomManager.ts` | origin on create, `close(roomId)` |
| `server/src/index.ts` | online list, host kick, logging, traffic tap |
| `client/src/components/OnlinePanel.tsx` | lobby online list |
| `client/src/components/ReasonDialog.tsx` | shared kick/ban dialog |
| `client/src/screens/RemovedScreen.tsx` | kicked / banned / closed page |
| `client/src/admin/useAdmin.ts` | admin socket wiring |
| `client/src/admin/GameViewer.tsx`, `TerminalPanel.tsx` | viewer + mine toggle, terminal |
| `client/src/components/Board.tsx`, `Leaderboard.tsx` | optional mines overlay; host buttons + spectator list |

## 10. Testing

**Unit (`npm test`)** — reason parsing, host-moderation rule, presence derivation, the
server-machine check, the activity log, the presence label.

**e2e (`npm run test:e2e`, no database)**

- the online list shows other players with the right status, and never an address
- a nameless socket is not in the online list
- host kick in a casual room: target gets `player:removed`, leaves the room, may rejoin
- host ban: target may not rejoin; kicking a spectator works
- host kick refused for non-hosts, for self, in ranked rooms, in matchmade rooms, without a reason
- admin watch: the viewer receives the room; mines only while toggled on, 11 for Classic
- admin kick, ban (with server disconnect), end game (room destroyed, viewer told)
- the terminal log carries connection, moderation and `game:reveal` traffic lines
- a remote-looking admin connection (forwarding header, no token) is refused with `ADMIN_ONLY`

**Ranked (`npm run test:ranked`, needs the database and migration 0002)** — a remote-looking
admin connection with a non-admin account is refused; the same account after being added to
`admins` is let in.

## 11. Out of scope

Chat and invites (sub-project 2), puzzle mode (sub-project 3), stored bans, the admin password,
AWS stats, and friends.
