import { supabase } from '../auth/supabase.js';
import { isMissingColumn, pictureUrl } from './avatar.js';
import {
  MISSING_TABLE_MESSAGE,
  isMissingTable,
  requestPlan,
  toFriendships,
  type Friendship,
  type FriendshipRecord,
} from './friendsModel.js';

/**
 * Friendships, read and written straight from the browser.
 *
 * Unlike queries.ts this does write — with the player's own session, fenced by
 * migration 0003: you can only ask as yourself, only the person asked can
 * accept, and either of you can remove the row. The game server reads the same
 * table with the service role before relaying an invite, so nothing here can
 * fake a friendship.
 *
 * Nothing throws. Every call returns something the panel can show, and with
 * Supabase unconfigured the list is simply empty.
 */

export interface FriendsLoad {
  friendships: Friendship[];
  /** Profile picture addresses by the other person's profile id. Only people with one. */
  pictures: ReadonlyMap<string, string>;
  /** Why the list could not be read, or null. */
  error: string | null;
  /** The table does not exist yet — migration 0003 has not been run. */
  missingTable: boolean;
}

export interface FriendsResult {
  ok: boolean;
  /** Why it failed — or, on success, anything worth telling the player. */
  message?: string;
  missingTable?: boolean;
}

const COLUMNS = 'requester_id, addressee_id, status';

interface DbError {
  code?: string;
  message: string;
}

function failed(error: DbError | null, fallback: string): FriendsResult {
  if (isMissingTable(error)) return { ok: false, message: MISSING_TABLE_MESSAGE, missingTable: true };
  if (error) console.error('[friends]', error.message);
  return { ok: false, message: fallback };
}

/**
 * Usernames and picture addresses by profile id. Profiles are publicly
 * readable. Before migration 0004 there is no picture column, and asking for
 * it fails the whole read, so the names are asked for again on their own.
 */
async function profilesById(
  ids: string[],
): Promise<{ names: Map<string, string>; pictures: Map<string, string> }> {
  const names = new Map<string, string>();
  const pictures = new Map<string, string>();
  if (!supabase || ids.length === 0) return { names, pictures };

  type Row = { id: string; username: string; avatar_path?: string | null };
  const first = await supabase.from('profiles').select('id, username, avatar_path').in('id', ids);
  let rows: Row[] | null = first.data;
  let error = first.error;
  if (isMissingColumn(error)) {
    const again = await supabase.from('profiles').select('id, username').in('id', ids);
    rows = again.data;
    error = again.error;
  }
  if (error) console.error('[friends] could not load names:', error.message);

  for (const row of rows ?? []) {
    names.set(row.id, row.username);
    const url = pictureUrl(row.id, row.avatar_path);
    if (url) pictures.set(row.id, url);
  }
  return { names, pictures };
}

/** Everything between me and anyone: requests both ways, and friends. */
export async function listFriendships(myId: string): Promise<FriendsLoad> {
  const none = new Map<string, string>();
  if (!supabase) return { friendships: [], pictures: none, error: null, missingTable: false };

  try {
    // No filter needed: row-level security returns only rows this player is in.
    const { data, error } = await supabase.from('friendships').select(COLUMNS);
    if (error) {
      const result = failed(error, 'Could not load your friends.');
      return {
        friendships: [],
        pictures: none,
        error: result.message ?? null,
        missingTable: result.missingTable === true,
      };
    }

    const records = (data ?? []) as FriendshipRecord[];
    const others = records.map((r) => (r.requester_id === myId ? r.addressee_id : r.requester_id));
    const { names, pictures } = await profilesById([...new Set(others)]);
    return { friendships: toFriendships(records, myId, names), pictures, error: null, missingTable: false };
  } catch (error) {
    console.error('[friends] load failed:', error);
    return { friendships: [], pictures: none, error: 'Could not load your friends.', missingTable: false };
  }
}

/**
 * Asks someone to be friends, by their exact username. If they already asked
 * you, this accepts theirs instead — that is what both of you want.
 */
export async function sendFriendRequest(myId: string, username: string): Promise<FriendsResult> {
  if (!supabase) return { ok: false, message: 'Accounts are not configured.' };
  const clean = username.trim();
  if (!clean) return { ok: false, message: 'Type their username.' };

  try {
    const { data: target, error: lookupError } = await supabase
      .from('profiles')
      .select('id, username')
      .eq('username', clean)
      .maybeSingle();
    if (lookupError) return failed(lookupError, 'Could not look that player up.');
    if (!target) return { ok: false, message: `Nobody is called “${clean}”. Usernames must match exactly.` };

    const targetId = target.id as string;
    const name = target.username as string;

    let existing: Friendship | undefined;
    if (targetId !== myId) {
      // Both ids on both sides matches either direction; a row with the same
      // id twice cannot exist.
      const { data: rows, error } = await supabase
        .from('friendships')
        .select(COLUMNS)
        .in('requester_id', [myId, targetId])
        .in('addressee_id', [myId, targetId]);
      if (error) return failed(error, 'Could not check your friends list.');
      existing = toFriendships((rows ?? []) as FriendshipRecord[], myId, new Map([[targetId, name]]))[0];
    }

    switch (requestPlan(myId, targetId, existing)) {
      case 'self':
        return { ok: false, message: 'That’s you — add someone else.' };
      case 'already-friends':
        return { ok: false, message: `You’re already friends with ${name}.` };
      case 'already-requested':
        return { ok: false, message: `You already asked ${name} — waiting for them to accept.` };
      case 'accept-theirs': {
        const accepted = await acceptFriendRequest(myId, targetId);
        return accepted.ok
          ? { ok: true, message: `${name} had already asked you — you’re friends now.` }
          : accepted;
      }
      case 'send':
        break;
    }

    // Status and timestamps are left to the database's defaults; the policy
    // only lets a request in as 'pending' from yourself.
    const { error: insertError } = await supabase
      .from('friendships')
      .insert({ requester_id: myId, addressee_id: targetId });
    if (insertError) {
      // 23505: a row for this pair appeared since the check above — they asked
      // at the same moment, or another tab of yours did.
      if (insertError.code === '23505') {
        return { ok: false, message: `There is already a request between you and ${name}.` };
      }
      return failed(insertError, 'Could not send the request.');
    }
    return { ok: true, message: `Request sent to ${name}.` };
  } catch (error) {
    console.error('[friends] request failed:', error);
    return { ok: false, message: 'Could not send the request.' };
  }
}

/**
 * What is between me and one other player, for their player card: the
 * friendship from my side, null for nothing yet, or 'unknown' when it could
 * not be read (no table, no connection) — the card then offers no button.
 */
export async function friendshipWith(myId: string, otherId: string): Promise<Friendship | null | 'unknown'> {
  if (!supabase || myId === otherId) return 'unknown';
  try {
    const { data, error } = await supabase
      .from('friendships')
      .select(COLUMNS)
      .in('requester_id', [myId, otherId])
      .in('addressee_id', [myId, otherId]);
    if (error) {
      failed(error, 'Could not check your friends list.');
      return 'unknown';
    }
    return toFriendships((data ?? []) as FriendshipRecord[], myId, new Map())[0] ?? null;
  } catch (error) {
    console.error('[friends] could not check a friendship:', error);
    return 'unknown';
  }
}

/** Accepts a request `fromId` sent me. Only the person asked may do this. */
export async function acceptFriendRequest(myId: string, fromId: string): Promise<FriendsResult> {
  if (!supabase) return { ok: false, message: 'Accounts are not configured.' };

  try {
    const { data, error } = await supabase
      .from('friendships')
      .update({ status: 'accepted' })
      .eq('requester_id', fromId)
      .eq('addressee_id', myId)
      .eq('status', 'pending')
      .select('requester_id');
    if (error) return failed(error, 'Could not accept the request.');
    // Nothing matched: they cancelled it in the meantime.
    if (!data?.length) return { ok: false, message: 'That request is no longer there.' };
    return { ok: true };
  } catch (error) {
    console.error('[friends] accept failed:', error);
    return { ok: false, message: 'Could not accept the request.' };
  }
}

/** Declines a request, cancels one I sent, or unfriends — whichever row is there. */
export async function removeFriendship(myId: string, otherId: string): Promise<FriendsResult> {
  if (!supabase) return { ok: false, message: 'Accounts are not configured.' };

  try {
    const { error } = await supabase
      .from('friendships')
      .delete()
      .in('requester_id', [myId, otherId])
      .in('addressee_id', [myId, otherId]);
    if (error) return failed(error, 'Could not update your friends list.');
    return { ok: true };
  } catch (error) {
    console.error('[friends] remove failed:', error);
    return { ok: false, message: 'Could not update your friends list.' };
  }
}
