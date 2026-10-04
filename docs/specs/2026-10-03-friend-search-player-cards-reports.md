# Friend search, player cards and reports

**Date:** 2026-10-03 · **Status:** built (see ROADMAP.md) · **Designs:** the owner picked A1 and B1
from a canvas of options (type-ahead dropdown; popover beside the name).

## What and why

Three things that make other players easier to reach — and to report:

1. **Find a friend by typing a few letters** instead of their exact username. Friends come first in
   the results.
2. **Click a name in Online now** to see a card about that player: rating, record, last results,
   **View profile** (left) and **Add friend** (right), with **Report** tucked behind a ⋯ button.
3. **Report a player.** Guests may report too. Admins see reports live on `/admin`, with what the
   server knows about both people — account id, the guest cookie's random id, the tab id and the IP
   address — so a returning guest can be recognised.

None of this touches the graded game. Classic rooms, the turn timer, scoring and the console's
client list and Reset are unchanged.

## A1 — type-ahead in the Friends card

- `+ Add friend` opens a search box (was: an exact-username form). From **2 letters**, after a
  **200 ms** pause, the browser searches `profiles` (publicly readable since 0001) with
  `ILIKE '%text%'`, `%`, `_` and `\` escaped so they match literally. Friends are searched on their
  own as well, so twenty strangers whose names sort first can never push a friend out.
- Ranking (`rankResults`, pure, tested): **friends first**, then everyone else; inside each group,
  people online now first, then names that *start* with the text, then by name. You never find
  yourself. At most 8 rows.
- Each row's one action: **Add** (send a request), **Accept** (they asked first), a **requested**
  tag, or — for a friend — their live **Invite / Join / Ask / Watch**, else a **friends** tag.
- Keyboard: ↑ ↓ move, Enter does the highlighted row's action, Esc clears, then closes. The input is
  an ARIA combobox over a listbox; row buttons are for the mouse and stay out of the Tab order.
- Files: `client/src/data/playerSearch.ts`, `client/src/components/FriendSearch.tsx`,
  `FriendsPanel.tsx`.

## B1 — player cards

- Every name in Online now is a button. Your own name opens your profile; anyone else's opens a
  card. One card at a time; clicking the same name closes it, another name switches.
- Desktop: a popover to the left of the online list, arrow pointing at the name. Phones (≤ 820 px,
  where the list sits above the games): the same card as a **bottom sheet** over a dimmed page.
- An account's card: picture, name, where they are, **Elo · #rank**, ranked win rate, ranked games,
  the last 5 results (W solid, L outlined, D grey — told apart by letter and fill, not colour),
  **View profile** and the friend button (`cardFriendButton`, pure, tested): Add friend / Accept
  request / Requested / Friends; a guest viewer sees it disabled with "Sign in to add friends."
- A guest's card: name, where they are, and "no profile to open or friend to add". The ⋯ menu is
  still there.
- ⋯ menu: **Copy username**, **Report player…**.
- Esc closes the menu first, then the card; a press outside closes it; focus returns to the name.
- **View profile** opens a new public page, **`/u/<username>`**: the same tiles, rating line,
  heatmap and recent matches as your own profile, read-only, with the friend button. Visiting your
  own name there offers your real profile page.
- Files: `PlayerCard.tsx`, `OnlinePanel.tsx`, `screens/PlayerProfileScreen.tsx`, `router.tsx`
  (`pathForPlayer`, `playerNameFromPath`; `useRoute` now also returns the path),
  `queries.ts` (`fetchProfileByUsername`), `friends.ts` (`friendshipWith`).

## Reports

### Protocol (talked through with the owner; `protocol.ts` is the group's seam)

- `player:join` payload gains an optional `guestId`.
- `player:report { targetId, reason, details? } → ModerationResult` (client → server).
- `admin:report { id, status } → ModerationResult` and `admin:reports (PlayerReport[])` on `/admin`.
- Rules in `shared/src/reports.ts` (pure, tested): reasons *offensive name or picture, harassment in
  chat, cheating or abusing a bug, spam in world chat, something else*; details folded and capped at
  300 characters; "something else" needs a few words; guest ids are exactly 32 lowercase hex.

### What the server records

The client sends only the target, the reason and the details. Everything else comes from the
server's own records of both connections (`partyOf` in `server/src/index.ts`):

| Field | Source | Strength |
|---|---|---|
| nickname, account id | verified identity at `player:join` | solid for accounts |
| guest id | the `fmm_guest` cookie's random id, sent with `player:join`, kept only if it is 32 hex | a hint: cookies clear |
| tab id | the handshake's per-tab `sessionId` | a hint |
| IP address | `clientAddress()` — the peer, or behind the tunnel the tunnel's `CF-Connecting-IP` | a hint: NAT, shared networks |
| room | where the reported player (else the reporter) is | |

**Real addresses behind the tunnel.** Through Cloudflare Tunnel every peer is `127.0.0.1`.
`clientAddress` believes `CF-Connecting-IP` (then the first `X-Forwarded-For` entry) **only when the
peer is loopback** — i.e. the request came through something on this machine — and only if it looks
like an IP. The console's client list now shows real addresses too. Admin access is unaffected:
`isServerMachine` still refuses every forwarded request.

### Limits

`ReportLimit` (pure, tested): the same reporter → same target once per **10 minutes**, and **5
reports per reporter per 10 minutes**. People are keyed by account id, else guest id, else tab id,
so a second tab of the same account gets no fresh allowance. Self-reports (same socket or same
account) are refused; so is a target who is no longer online.

### Storage and retention

- Memory first (`ReportStore`, newest first, ≤ 500): a report always reaches the console, with or
  without a database.
- Supabase table `public.reports` (**migration 0005**): RLS on, no policies, no grants to anon or
  authenticated — only the server's service role touches it. Loaded back at start-up.
- **90 days**, then deleted: from memory and the database at start-up and once a day.
- Without the table the server logs once (`run supabase/migrations/0005_reports.sql`) and keeps
  reports in memory only.

### Console

A **Player reports** card under Connected clients: open reports first (handled ones fold away),
each with the reason, time, room, "X reported Y", details, both parties' identifiers, and
**Resolve / Dismiss** (or **Reopen**). While the reported player is still connected, **Kick** and
**Ban** use the existing reason dialog. Every status change is logged under *moderation* and pushed
to every open console.

### Privacy

The privacy page now says the guest cookie holds a random id, what a report stores, who sees it,
and that reports go after 90 days; the terms mention reporting. `POLICY_UPDATED` is 3 October 2026.

## Tests

- Unit: `shared/src/reports.test.ts`, `server/src/state/reportLimit.test.ts`,
  `reportStore.test.ts`, `persistence/reportRecorder.test.ts`, `admin/access.test.ts`
  (`clientAddress`), `client/src/data/playerSearch.test.ts`, `friendsModel.test.ts`
  (`cardFriendButton`), `guestCookie.test.ts` (the id), `router.test.ts` (`/u/<name>`).
- e2e (`scripts/smoke-test.mjs`, section *player reports*): a guest reports a guest and the console
  gets it with guest ids, address and connection id; logged under moderation; the 10-minute repeat,
  self-report, offline target, bad reason, "something else" without words, over-long details and a
  nameless reporter are refused; the console resolves and refuses bad statuses; a malformed guest id
  is not kept; both new events are in the malformed-message fuzz.
- Checked by hand: the search pattern against the real profiles table (escaping is literal); the
  card, menu, report dialog and console in a browser; the phone sheet at 375 px; `/u/<name>`.

## Not done (on purpose)

- The search box is only on the Friends card (signed in). A global "find a player" spotlight (design
  A3) was not picked.
- Reporting from a profile page: a report needs the player's live connection, so it lives in the
  online list.
- No block list.
