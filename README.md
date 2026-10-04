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

The assignment requires one machine running *server + client* and another running *client only*,
which connects straight to the server. Nobody types an IP or a port: the second machine's client
reads the server's address from source code, as the spec requires.

**Computer A — server and client**

1. Run `ipconfig` and note the Wi-Fi adapter's IPv4 address, e.g. `192.168.1.20`.
2. `npm run build && npm start`
3. Open `http://localhost:3000`. This client connects to the server on the same machine.
4. The server's display is the terminal (client count and list, reprinted on every change) and
   `http://localhost:3000/admin`, which has the **Reset** button and opens without a login on
   this machine.

**Computer B — client only**

1. Clone the repo and run `npm install`. No `.env` is needed; without one the client plays as a
   guest, which is all the demo needs.
2. In **`packages/shared/src/config.ts`**, set `SERVER_HOST` to computer A's IP. This is the
   server address the spec says must be set in source code.
3. `npm run dev:client`
4. Open `http://localhost:5173`. The client connects to `http://<A's IP>:3000` from that
   constant; the player only enters a nickname.

**Before the demo**

- Put both machines on the same network. Campus Wi-Fi often blocks traffic between devices; test
  in the room beforehand and keep a phone hotspot as the fallback.
- Allow Node.js through Windows Firewall on computer A (private networks) — Windows asks the
  first time `npm start` runs. Keep `CORS_ORIGIN` unset or `*` in A's `.env`.
- Check from computer B: `curl http://<A's IP>:3000/health` answers `{"ok":true,…}`.

> Opening `http://<A's IP>:3000` in computer B's browser also works, but then the player types
> the address and `SERVER_HOST` is not used: a built client connects to whichever address served
> it. Fine for casual play; use the steps above for the graded setup.

---

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Server + client with hot reload |
| `npm run build` | Bundle the client to `packages/client/dist` |
| `npm start` | Run the server, serving the built client |
| `npm test` | Unit tests (866) |
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
