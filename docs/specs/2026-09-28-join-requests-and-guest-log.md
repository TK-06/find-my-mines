# Join requests, guest game log, and a pure Classic

**Status:** built 2026-09-28 overnight from the owner's brief; decisions below were made without a
review round and are listed so the team can challenge them. **Scope:** continues
`2026-09-27-admin-and-online-list.md`.

---

## 1. The brief

1. Players can **ask to join** a game: pressing Join opens a window — "Request to join this room"
   with **Cancel**, **Request**, and an **×** in the corner. The host gets a **popup** with
   **Accept** and **Decline**.
2. The lobby's **Online now** list can also start that join.
3. **Guests** can see **their own** game log.
4. **Classic stays the original assignment version** for the professor.

## 2. Decisions

| Topic | Decision | Why |
|---|---|---|
| What "Classic" means | A room whose board and seats equal the Classic preset: 6×6, 11 mines, 2 players | Derived from the config, so no new field and nothing to keep in sync |
| Classic behaviour | Anyone joins directly; **no join requests, no host kick/ban**. Admin powers still apply | The grader sees exactly the spec |
| Who uses join requests | Custom rooms whose creator ticked **Players ask to join** (on by default for Custom in the form, off when an API caller omits it) | Showcases the feature without changing any existing flow or test |
| Host kick/ban | Now Custom + Casual + created by a player (Classic excluded) | Matches "custom casual no-Elo" from the owner's first brief |
| Spectating | Always direct, even in ask-to-join rooms | The request is about taking a seat |
| Accepted mid-match | Seated as a spectator until the next match — the existing rule for anyone joining a live match | No special case |
| Requests per player | One pending at a time; asking elsewhere, joining, creating, queueing or disconnecting withdraws it | Keeps the host's list honest |
| Room closes with requests pending | Each requester is told "the room closed" | No one waits forever |
| Who sees requests | Everyone in the room (`joinRequests` in the room state); only the host can answer | Host succession needs no extra bookkeeping |
| Guest history | The server tells each seated player the id of the match it just recorded; a guest's browser keeps those ids (`localStorage`, newest 50) and **Mine** on the game log shows those matches | Accurate per browser, no schema change, no trust in a guest's claimed name |

## 3. Protocol additions

| Direction | Event | Payload |
|---|---|---|
| client → server | `room:requestJoin` | `{ roomId }`, ack `ModerationResult` |
| client → server | `room:cancelRequest` | — |
| client → server | `room:answerRequest` | `{ requesterId, accept }`, ack `ModerationResult` |
| server → client | `room:requestResolved` | `{ roomId, roomName, outcome: 'accepted' \| 'declined' \| 'closed', byName }` |
| server → client | `match:recorded` | `{ matchId }` — sent to the match's seated players after the database write |

Changed types: `RoomConfig.joinByRequest: boolean`; `PublicMatchState.joinRequests:
{ id, nickname, isGuest }[]`.

`room:join` on an ask-to-join room is refused server-side ("ask the host"), so a client cannot
skip the approval.

## 4. Pure rules (shared, unit-tested)

- `isClassicConfig(config)`
- `coerceRoomConfig` forces `joinByRequest: false` on a Classic board
- `hostCanModerate(origin, config)` — created, casual, not Classic
- `joinRequestError({ joinByRequest, alreadyMember, alreadyRequested, banned, full })`
- guest history: `addGuestMatch(list, entry, limit)`

## 5. Also fixed: two tabs reloading each other forever

Signed in with two tabs open, the tabs reloaded each other endlessly. supabase-js broadcasts
`SIGNED_IN` to every other tab whenever a tab loads with a stored session (and
`TOKEN_REFRESHED` about hourly); the client reloaded on *any* auth event, so each reload
triggered the next. Now it reloads only when the signed-in **identity changes**, and the socket
reads the access token itself at handshake time (which also removes a race where the first
handshake could go out before the stored session was restored).
