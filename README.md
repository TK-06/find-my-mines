# Find My Mines

An online mine-hunting game built on a client–server socket architecture.
Net-Centric course assignment.

Players take turns uncovering slots on a grid hiding mines. Find a mine and you score a
point and keep going; hit an empty slot and it reveals how many mines surround it, then your
turn ends. The match ends when every mine has been found.

Enter a nickname, then pick a game from the landing page — **join** it, or **spectate** if
it is full. **Create game** opens a room of your own: the **Classic** preset is the graded
6×6 / 11-mine / 2-player configuration, and **Custom** lets you set board size, mine count,
and a player limit (or no limit at all).

> **Working on this?** Start with **[CONTRIBUTING.md](./CONTRIBUTING.md)** for setup and the
> rules, and **[ROADMAP.md](./ROADMAP.md)** for what is built and what is left.
> Architecture and design decisions live in **[scaffold.md](./scaffold.md)**.

---

## Quick start

```bash
npm install
npm run dev
```

| What | Where |
|---|---|
| Game client | http://localhost:5173 |
| Profile | http://localhost:5173/profile |
| Game log | http://localhost:5173/games |
| Server console | http://localhost:5173/admin |
| Server (API + sockets) | http://localhost:3000 |

Open the game in **two browser windows** and enter a nickname in each. In the first, create
a game (Classic is the default). In the second, join it from the list. The **host** — the
player who created the room — presses **Start match**.

If the host leaves, the earliest-joined remaining player becomes host. When the last person
leaves, the room disappears.

### Production mode (one port, what you deploy)

```bash
npm run build   # bundles the client
npm start       # server serves the client AND the sockets on :3000
```

Then the game is at `http://localhost:3000` and the console at `http://localhost:3000/admin`.

---

## Playing across two computers

The assignment requires one machine running *server + client* and another running *client only*.

1. Find the server machine's LAN IP (`ipconfig` on Windows).
2. Set `SERVER_HOST` in **`packages/shared/src/config.ts`** to that IP.
3. `npm run build && npm start` on the server machine.
4. On the second machine, open `http://<that-ip>:3000`.

Players never type an address — the client reads it from source, as the spec requires.

> If the second machine can't connect, allow port 3000 through the server machine's firewall.

---

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Server + client with hot reload |
| `npm run build` | Bundle the client to `packages/client/dist` |
| `npm start` | Run the server, serving the built client |
| `npm test` | Engine and room-config unit tests (42 tests) |
| `npm run test:e2e` | Full lobby + match flow over real sockets — **needs the server running** |
| `npm run typecheck` | TypeScript across all three packages |

### Docker

```bash
docker compose up --build      # http://localhost:3000
```

---

## Layout

```
packages/
  shared/   types, socket protocol, room rules, and the pure game engine
  server/   Socket.IO server, room manager, match state, admin console API
  client/   React nickname → lobby → game UI, plus the /admin server console
scripts/
  smoke-test.mjs   end-to-end socket test
```

The server is **authoritative**: it owns every board, turn order and countdown. Mine
positions never leave the server — clients only receive cells that have actually been
uncovered, so you cannot read the answers out of the network traffic.

Each room is its own socket.io room, so a reveal in one game is invisible to every other
game on the server.

## Configuration

**`packages/shared/src/config.ts`** holds the server address, the Classic preset, the turn
length, and the bounds custom rooms must stay inside. Environment variables (see
`.env.example`) exist only to let Docker and EC2 override the port without a rebuild.
