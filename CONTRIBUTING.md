# Contributing

Everything you need to work on Find My Mines without breaking someone else's branch.

Read **[ROADMAP.md](./ROADMAP.md)** first — it says what is built, what is left, and who is
blocked on what.

---

## 1. Setup

```bash
git clone <repo>
cd netCen
npm install
```

### Environment

Copy the template and fill it in:

```bash
cp .env.example .env
```

| Variable | Where it comes from | Secret? |
|---|---|---|
| `SUPABASE_URL`, `VITE_SUPABASE_URL` | Supabase dashboard → Settings → API | No |
| `VITE_SUPABASE_ANON_KEY` | Same page, the **publishable** key | No — safe in the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page, the **secret** key | **YES** |
| `VITE_OAUTH_PROVIDERS` | Leave empty unless Google/GitHub OAuth apps exist | No |
| `ADMIN_TOKEN` | Only on a hosted server — opens `/admin?token=<value>`. Leave empty locally | **YES** |
| `VITE_SERVER_URL` | Only for the Vercel build — the Render server's address. See `DEPLOY.md` | No |

> **The secret key bypasses all database security.** Never commit it, never paste it in
> Discord/LINE/chat, never give it a `VITE_` prefix. Ask the project owner for it over a
> private channel. `.env` is gitignored — keep it that way.

**You can skip Supabase entirely.** With no keys the server runs guest-only and the whole
game still works. That is enough to develop most features.

### Run it

```bash
npm run dev
```

| What | Where |
|---|---|
| Game | http://localhost:5173 |
| Profile / Rankings | `/profile`, `/ranks` |
| Server console (Server tab) | http://localhost:5173/admin |
| Game log (admins only, a tab of the console) | http://localhost:5173/admin#games |

Open two browser windows to play against yourself.

---

## 2. Before you push — all four must pass

```bash
npm run typecheck
npm test
npm run start        # in another terminal, then:
npm run test:e2e
```

If you touched anything Supabase-related, also run `npm run test:ranked`.

**`npm run test:e2e` must pass with `.env` deleted.** That is a hard rule: the game has to
work without a database, so the demo survives a network problem. If your change breaks that,
the change is wrong, not the test.

---

## 3. Where things live

```
packages/shared   types, socket protocol, room rules, Elo, matchmaking, game engine
packages/server   Socket.IO, rooms, matchmaking queue, Supabase writes, /admin
packages/client   React: auth → lobby → game, plus profile/rankings and the admin console (server + game log)
```

`shared` depends on nothing. Both others depend on it.

---

## 4. Rules

These are not style preferences — breaking them causes real bugs.

1. **The server decides everything.** The client draws what `state:sync` last told it and
   forwards clicks. If client code decides a game outcome, that is a bug.
2. **Mine positions never reach a player's or spectator's client.** `Board.bombs` is not
   serialised. Do not add board data to `publicState()`. The one exception: a verified admin
   watching a room with the mine toggle on gets them through `MatchManager.minePositions()`,
   on the `/admin` namespace only.
3. **Game rules go in `shared/` with a unit test**, never inline in a socket handler. Pure
   functions there test with no mocks, no sockets, no database.
4. **Anything crossing the wire gets an assertion in `scripts/smoke-test.mjs`.** Unit tests
   cannot catch protocol regressions.
5. **`shared/src/protocol.ts` is the seam between all three packages.** Changing it breaks
   everyone at once — TypeScript will tell you immediately, which is the point. **Discuss
   before changing it.**
6. **Validate untrusted input on the server.** The client form may run the same validator for
   a faster message, but the server's check is the one that counts. Register socket handlers
   with `listen(...)`, never bare `socket.on(...)`; read payload fields defensively
   (`text(payload, 'roomId')`, `payload?.x`), never by destructuring; reply with
   `respond(ack, …)`, never `ack(…)`. Anyone can send anything, and one throw in a bare
   handler used to crash the whole server.
7. **Never trust what a client says about who it is.** Identity comes from the verified
   Supabase token; no token means guest.
8. **Ratings are written by the server only.** A database trigger blocks everything else.
9. **Update `ROADMAP.md` in the same commit.** Feature, fix, or decision — the roadmap must
   never lag the code.

---

## 5. Branching, commits, versions

**Agreed 2026-10-03.** One feature (or fix) at a time, each on its own branch, one commit, merged
onto `main` with a merge commit, and tagged with its version.

1. **Branch** named after the thing being built: `feat/<thing>` or `fix/<thing>`.
2. **Bump the version** in the same commit: `APP_VERSION` in `packages/client/src/version.ts` (the
   footer shows it and links to its tag) and `"version"` in the root `package.json`. A feature bumps
   the minor number (3.4.0 → 3.5.0); a fix bumps the patch (3.4.0 → 3.4.1). Add a line to
   `ROADMAP.md` in the same commit.
3. **Commit** as `v<version> feat: <what>` or `v<version> fix: <what>`.
4. **Merge** onto `main` with a merge commit, never a fast-forward, so each feature stays one
   visible unit in the history.
5. **Tag** the merge commit `v<version>` (annotated).
6. **Push** `main` with its tags when a batch is ready. Once automatic deploy lands (v3.10.0),
   pushing `main` puts it live, so only push what passed all four checks above.

```powershell
git switch -c feat/daily-challenge
# ...work, then the four checks in §2...
git add -A
git commit -m "v3.5.0 feat: daily challenge in Puzzle"
git switch main
git merge --no-ff feat/daily-challenge -m "Merge feat/daily-challenge (v3.5.0)"
git tag -a v3.5.0 -m "v3.5.0: daily challenge in Puzzle"
git push origin main --follow-tags
```

Changing `shared/src/protocol.ts` still needs a word with the group first: one person's change to
the contract breaks everyone at once.

---

## 6. Splitting work

`protocol.ts` is the boundary, so these tracks rarely collide:

| Track | Files |
|---|---|
| Game rules / Elo / matchmaking logic | `packages/shared/src/**` |
| Server, rooms, persistence | `packages/server/src/**` |
| Game UI | `packages/client/src/components/**`, `App.tsx` |
| Profile / log / rankings | `packages/client/src/screens/**`, `data/**` |
| Server console | `packages/client/src/admin/**` |
| Database | `supabase/migrations/**` |

Agree on any `protocol.ts` change **before** two people start building against it.

---

## 7. Gotchas that have actually bitten us

- **Port 3000 stays held after you stop the server.** `tsx watch` orphans survive. On Windows:
  ```powershell
  Get-NetTCPConnection -LocalPort 3000 -State Listen | %{ Stop-Process -Id $_.OwningProcess -Force }
  ```
- **VS Code holds sockets to `:3000`** via Simple Browser / live-preview extensions, which
  inflates the "clients online" number. Close those before demoing.
- **Turns expire after 10 seconds.** In browser tests, do not sleep between clicks — the turn
  passes and clicks are correctly rejected. It looks exactly like a rendering bug and is not.
- **Vite must stay on one version.** `vitest` pulls Vite 7 at the root; the client is pinned
  to match. Two copies give a confusing "Plugin is not assignable to PluginOption" error.
- **This repo lives inside OneDrive.** If `npm install` fails with `EPERM`, exclude the folder
  from OneDrive sync.
- **Grepping the bundle for `service_role` gives false positives** — supabase-js contains that
  string legitimately. Grep for the key's actual value instead.
- **The client only follows a room it knows it is in.** `useGame` ignores room events for any
  room other than `activeRoom`, so a late update never pulls a leaver back in. Any new server
  path that seats a player must tell the client the room id **before** the room's first
  `state:sync` — an ack with `roomId`, `queue:matched`, or `room:requestResolved` all do.
  Seating someone silently leaves them on the lobby while the server thinks they are playing.
- **A dropped seated player keeps their seat for 30 s** (`RECONNECT_GRACE_SECONDS`), keyed by
  the tab's `sessionId`. Test sockets that send a `sessionId` and then close leave held seats
  behind for 30 s; sockets without one leave at once, as before.

---

## 8. The assignment

This is graded coursework (25 points). Two things must not regress:

- **Classic stays the create-game default** — 6×6, 11 mines, 2 players, Casual. A grader
  should see the specified behaviour without touching a setting. A Classic room also keeps the
  original rules: anyone joins directly, and the host cannot kick or ban (`isClassicConfig` in
  `shared/src/rooms.ts`). Extras like ask-to-join live in Custom rooms.
- **"Play as guest" stays one click.** A grader must never need an account.

The fundamentals are worth 10 points and extras score **zero** if the fundamentals are
incomplete. Protect them before adding anything new.
