# Find My Mines — architecture & roadmap

The living design document. `README.md` covers how to run it; this covers how it is built,
why, and what comes next.

---

## 1. Stack

| Layer | Choice | Why |
|---|---|---|
| Transport | **Socket.IO** over WebSocket | Explicitly listed in the assignment's own hints. Gives rooms, acks, auto-reconnect and namespaces for free. |
| Server | Node 22 + TypeScript + Express | One process serves the sockets, the game client and the admin console. |
| Client | React 18 + Vite | Fast HMR; the creativity marks reward a UI that looks built rather than sketched. |
| Tests | Vitest + a socket smoke test | Engine logic unit-tested; the wire protocol tested end-to-end. |
| Packaging | npm workspaces, Docker | Three packages with a frozen contract, so the group can work in parallel. |

Runs on Node ≥ 20. No database — all state is in memory, which is correct for a single
match and keeps the demo dependency-free.

---

## 2. Package boundaries

```
packages/shared   ← depended on by both others; depends on nothing
packages/server   ← depends on shared
packages/client   ← depends on shared
```

**`@fmm/shared`** — the contract.
- `config.ts` — server address, the Classic preset, turn length, and the bounds custom rooms must stay inside.
- `types.ts` — the client-safe view of the world, including `RoomConfig` and `RoomSummary`.
- `protocol.ts` — every socket event, typed. **This is the group's boundary — freeze it first.**
- `rooms.ts` — room-config validation and coercion. Pure, so the server and the create-game form run the *same* checks.
- `engine/` — pure game logic. No I/O, no sockets, no React.

**`@fmm/server`** — the authority.
- `state/registry.ts` — who is connected and which room they are in (drives the count + list requirement).
- `rooms/roomManager.ts` — every open room: create, join, spectate, leave, destroy-when-empty.
- `match/matchManager.ts` — one room's rules: seating, turns, scoring, rematch, reset.
- `match/turnTimer.ts` — the countdown. Server-side, always.
- The `/admin` namespace lives in `index.ts` alongside the game namespace.

**`@fmm/client`** — a renderer.
- Holds no game rules. It draws whatever `state:sync` last told it and forwards clicks.
- `screens/LobbyScreen.tsx` — the landing page: game list and create-game form.
- `components/Leaderboard.tsx` — live in-match ranking, any number of players.

### Why the engine sits in `shared`

It is pure logic, so it belongs where everything can reach it: the server runs it as the
authority, the client reuses its types, the future AI bot will simulate moves with it, and
tests exercise it with zero mocking.

Sharing the engine *code* is safe. Sharing engine *state* would not be — so `Board.bombs`
never gets serialised. `MatchManager.publicState()` is the only projection sent to clients,
and it contains just the cells that have actually been uncovered.

### Rooms

One `MatchManager` per room, each with its own `RoomConfig`. Every match event is emitted to
that room's socket.io room (`io.to(roomId)`), so games are fully isolated from each other.

The **host is derived, never stored**: it is always the earliest-joined seated player. That
makes "the host leaves, the first player who joined takes over" automatic — there is no
bookkeeping to drift out of sync.

---

## 3. Data flow

```
  Player clicks a covered cell
        │
        │  game:reveal { row, col }
        ▼
  Server: is the match live? is it your turn? is the cell still covered?
        │  (any "no" → error:msg, nothing changes)
        ▼
  engine.revealCell()  →  bomb or empty? adjacent count? match over?
        │
        ├── bomb  → +1 point, SAME player keeps the turn, timer keeps running
        ├── empty → turn passes to the opponent, timer restarts at 10s
        └── last bomb → match:ended
        │
        ▼
  io.emit('cell:revealed', { cell, state })   → every client redraws
  pushAdminState()                            → server console redraws
```

The client never decides any of this. It cannot end its own turn, extend its own countdown,
or reveal a cell twice — every one of those is rejected server-side.

---

## 4. How each graded requirement is met

### Fundamental implementation (10 pts)

| Requirement | Where |
|---|---|
| Socket-based client–server model | `server/src/index.ts`, `client/src/socket.ts` |
| Client needs no IP/port entry | `shared/src/config.ts` — `SERVER_URL` is a source constant |
| Server shows connected count + list | `/admin` console **and** the server's stdout (`printConsole()`) |
| Nickname + welcome message | `player:join` ack returns `"Welcome, <name>."` |
| 11 bombs on a 6×6 grid | `engine/board.ts` — partial Fisher–Yates, exact by construction |
| Name and score on the client | `components/Leaderboard.tsx` |
| Random first player | `matchManager.startMatch()` |
| All slots start covered | `board.revealed` initialised to `false` |
| 10-second turn countdown | `match/turnTimer.ts`, server-authoritative |
| Bomb → keep the turn | `engine/game.ts` → `keepsTurn` |
| Empty → adjacent count, then disabled | `RevealedCell.adjacent`; the button renders `disabled` |
| 1 point per bomb | `outcome.pointsAwarded` |
| Match ends when all bombs found | `allBombsFound()` |
| Win/Lost + both scores + rematch | `components/ResultOverlay.tsx` |
| Previous winner starts the rematch | `matchManager.lastWinnerId` |
| Server reset button | `/admin` → `admin:reset` → `roomManager.reset()`; per-room or all rooms |

### Verification

`npm test` — 42 unit tests: the engine, plus room-config validation and custom board sizes.

`npm run test:e2e` — 51 assertions against a running server, covering every row above plus
the room layer: nickname and lobby, invalid configs rejected, room creation, non-hosts
blocked from starting, a full match, spectators, rematch voting, per-room reset, an
unlimited free-for-all room where turns rotate through four players, leaderboard ordering,
host succession, and rooms destroyed when the last member leaves.

**Note on the graded path:** the Classic preset is the default in the create-game form, so
the 6×6 / 11-mine / 2-player behaviour is what a grader sees without changing any setting.

---

## 5. Open question for the instructor

The spec says:

> *"Each player has 10 seconds per turn to find bombs. If a bomb is found, the player
> continues their turn until time runs out; otherwise, the turn passes to another player."*

Read literally, finding a bomb does **not** restart the countdown — the player keeps picking
inside the same 10-second window. That is what is implemented.

The other reading is that each bomb grants a fresh 10 seconds. If your instructor means that,
set `BOMB_RESETS_TIMER = true` in `shared/src/config.ts`. Nothing else changes.

---

## 6. Roadmap

Extras score **zero** unless the fundamentals are complete, so they are strictly ordered
after them. Max 10 extra points; an AI feature is mandatory to claim any AI points.

### Phase A — extra features

| # | Feature | AI? | Pts | Notes |
|---|---|:--:|:--:|---|
| 1 | **AI opponent bot** | Yes | 2 | Solo mode with difficulty levels. Does real constraint propagation over the revealed adjacency numbers, not random guessing. Runs the shared engine to simulate. **Mandatory for AI points — build this first.** |
| 2 | **LLM hint / taunt assistant** | Yes | 2 | The solver picks the move; Claude only phrases the hint or the trash talk. Degrades to solver-only with no API key, so the demo never depends on the network. |
| 3 | **Chat + emotes** | No | 1 | Same socket, new events, scoped to the room. Cheap. |
| 4 | **Persistent leaderboard** | No | 1 | The live in-match leaderboard is **done**. This is the all-time table on the landing page — needs storage (SQLite or a JSON file) plus a stable player id across reconnects. |

### Phase B — game modes ✅ done

- **Multiple concurrent rooms** — landing page lists every game; join or spectate. One
  `MatchManager` per room, isolated by socket.io rooms.
- **Free-for-all (3+ players)** — rooms take a fixed limit or no limit; turns rotate through
  every seat.
- **Configurable board** — map size, mine count and player limit are set when creating a
  room, validated by the same pure function on both sides.
- **Spectator mode** — extra clients watch read-only, and are promoted into free seats when
  the next match starts.
- **Live leaderboard** — ranked in-match scoring on the gameplay page.

Remaining from this phase: the **persistent** cross-match leaderboard, listed in Phase A
above since it is now the only scoring feature left.

### Phase C — deployment

Container-first, so nothing about the app changes between local, EC2 and Kubernetes.

1. **Single EC2 instance** (t3.micro, free tier) — the demo target.
   - `docker compose up -d`
   - Open port 3000 in the security group.
   - Set `SERVER_HOST` in `shared/src/config.ts` to the instance's public IP, rebuild.
2. **Kubernetes — only if genuinely wanted.** Be aware of what it costs you here:
   - Socket.IO connections are sticky, so >1 replica needs session affinity on the Ingress
     **plus** the Redis adapter so broadcasts reach players on other pods.
   - Room state is in memory on one process, so you would run `replicas: 1` — an EC2 box
     with a control plane attached. Scaling past one pod means moving room state out of
     process (Redis) as well as adding the Redis adapter.
   - EKS bills ~$73/month for the control plane. Use **k3d or minikube locally** if the goal
     is learning k8s rather than serving real traffic.

---

## 7. Working as a group

The protocol in `shared/src/protocol.ts` is the seam. Agree on it, then these split cleanly:

| Track | Files | Depends on |
|---|---|---|
| Server rules | `server/src/match/**` | protocol |
| Game UI | `client/src/components/**`, `App.tsx` | protocol |
| Server console | `client/src/admin/**` | protocol |
| AI bot | new `packages/bot` | protocol + `shared/engine` |

Changing `protocol.ts` breaks everyone at once — TypeScript will say so immediately, which is
the point. Discuss protocol changes before making them.

### Conventions

- The server is the only source of truth. If the client computes a game outcome, that is a bug.
- Every new rule goes in `shared/engine` with a unit test, not inline in a socket handler.
- Add an assertion to `scripts/smoke-test.mjs` for anything that crosses the wire.
