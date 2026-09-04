# Find My Mines — project guide

Online mine-hunting game over Socket.IO. **Net-Centric course assignment, 25 points.**
Group project.

Read `scaffold.md` for the full architecture and roadmap; `README.md` for how to run it.
This file is the short version plus the things that will bite you.

---

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Server (:3000) + Vite client (:5173), hot reload |
| `npm run build` | Bundle client to `packages/client/dist` |
| `npm start` | Server serving the built client — one origin, one port |
| `npm test` | Unit tests (engine + room config) |
| `npm run test:e2e` | Full socket flow — **requires a running server** |
| `npm run typecheck` | TypeScript across all three packages |

Before claiming anything works: `npm run typecheck && npm test`, then start the server and
run `npm run test:e2e`. All three must pass.

---

## Architecture

```
packages/shared   ← types, protocol, room rules, pure engine. Depends on nothing.
packages/server   ← Socket.IO, rooms, match state, /admin
packages/client   ← React: nickname → lobby → game, plus /admin console
```

**One `MatchManager` per room.** Every match event is emitted to that room's socket.io room
(`io.to(roomId)`), so games are isolated. `RoomManager` owns the room map and membership.

**The host is derived, never stored** — always the earliest-joined seated player. That makes
host succession automatic when someone leaves. Do not add a `hostId` field.

### Key files

| File | Role |
|---|---|
| `shared/src/protocol.ts` | **The contract.** Every socket event, typed. |
| `shared/src/config.ts` | Server address, Classic preset, turn length, custom-room bounds |
| `shared/src/rooms.ts` | Room-config validation — pure, run by BOTH server and create-form |
| `shared/src/engine/` | Board generation, reveal, scoring. No I/O. |
| `server/src/rooms/roomManager.ts` | Create / join / spectate / leave / destroy |
| `server/src/match/matchManager.ts` | One room's rules: seating, turns, scoring, rematch |
| `server/src/index.ts` | Socket wiring, `/admin` namespace, static client, stdout console |
| `client/src/useGame.ts` | All socket wiring for the client. No game rules. |
| `client/src/screens/LobbyScreen.tsx` | Landing page: game list + create form |
| `client/src/components/Leaderboard.tsx` | Live in-match ranking |

---

## Rules to follow

1. **The server is authoritative.** If the client decides a game outcome, that is a bug. The
   client renders what `state:sync` last told it and forwards clicks.
2. **Mine positions never leave the server.** `Board.bombs` is not serialised;
   `publicState()` is the only projection sent to clients. Do not add board data to it.
3. **Game rules go in `shared/engine` with a unit test**, never inline in a socket handler.
4. **Anything that crosses the wire gets an assertion in `scripts/smoke-test.mjs`.** The unit
   tests cannot catch protocol regressions.
5. **`protocol.ts` is the group's seam.** Changing it breaks everyone at once (TypeScript will
   say so immediately — that is the point). Discuss before changing it.
6. **Validate untrusted input on the server.** `room:create` runs `validateRoomConfig` before
   creating anything; the form runs the same function only so the user sees the message sooner.

---

## Grading constraints — do not break these

Extra features score **zero** if the fundamental implementation is incomplete. Protect the
fundamentals before adding anything.

- **Classic must stay the create-game default** (6×6, 11 mines, 2 players). A grader should
  see spec behaviour without touching a setting.
- **Clients must never prompt for IP or port.** The address is a source constant,
  `SERVER_URL` in `shared/src/config.ts`. Change `SERVER_HOST` there to deploy.
- **The server must display the connected-client count and list** — this exists twice on
  purpose: the `/admin` console *and* `printConsole()` on stdout. Keep both.
- **The server needs a working Reset button** that clears the board and all scores,
  cumulative totals included.
- Turn timer is **server-authoritative** (`match/turnTimer.ts`). Never let the client time turns.

### Open question for the instructor

The spec says a player who finds a mine *"continues their turn until time runs out."* Read
literally, the countdown does **not** restart. That is what is implemented. If the instructor
means a fresh 10 seconds per mine, set `BOMB_RESETS_TIMER = true` in `shared/src/config.ts`.
One line, nothing else changes.

---

## Gotchas — all of these actually happened

- **This folder is inside OneDrive.** `node_modules` in a synced folder can cause slow installs
  and occasional `EPERM` lock errors. If installs fail that way, exclude this folder from
  OneDrive sync. (Deliberate choice — do not suggest moving the repo.)
- **Vite must stay on a single version.** `vitest` pulls Vite 7 at the root; the client is
  pinned to `vite@^7` with `@vitejs/plugin-react@^5` to match. Two copies produce a confusing
  "Plugin is not assignable to PluginOption" type error. Check with
  `find . -name vite -maxdepth 4 -type d -path "*node_modules*"`.
- **`tsx watch` orphans survive process kills and hold port 3000**, so the next start dies with
  `EADDRINUSE`. Free it:
  `Get-NetTCPConnection -LocalPort 3000 -State Listen | %{ Stop-Process -Id $_.OwningProcess -Force }`
- **VS Code holds sockets to `:3000`** (Simple Browser / live-preview extensions), which inflates
  the "clients online" number. Close those before demoing. Verify who is connected with
  `Get-NetTCPConnection -RemotePort 3000 -State Established | Group-Object OwningProcess`.
- **Turns expire after 10 seconds.** When driving the UI in a browser automation test, do not
  sleep between clicks — the turn passes and the clicks are correctly rejected as out-of-turn.
  This looks exactly like a rendering bug and is not one.
- **`npm run test:e2e` needs the server already running.** It does not start one.
- **Absolute client-count assertions are fragile** — any stray tab adds a socket. Assert
  "contains our clients" instead.

---

## Git

The repo owner handles git. Do not run state-changing git commands (commit, push, branch,
merge, reset, checkout, stash, tag) unless explicitly asked in that message. Read-only git
(`status`, `log`, `diff`, `show`) is always fine.
