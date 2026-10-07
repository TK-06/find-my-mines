import { useEffect, useMemo, useRef, useState } from 'react';
import type { HeadToHead } from './headToHead.js';
import { fetchHeadToHeads } from './queries.js';

/**
 * How you have done against each of your friends, for the stats line on the
 * Friends card's rows — read once for all of them (`fetchHeadToHeads`), never
 * one read per friend.
 *
 * Refreshed the way the friends list is: when the card appears, whenever the
 * set of friends changes (one accepted or removed), and when the window
 * regains focus — which is when a game played in another tab has finished. It
 * lives with the card rather than in App, so the reads are only made where the
 * numbers are shown.
 *
 * `undefined` until the first read is back, `null` when it failed (the rows
 * then show a dash), otherwise a record for each friend. Nothing here throws,
 * and a failure never touches the list itself.
 */
export function useFriendRecords(
  userId: string | null,
  friendIds: readonly string[],
): ReadonlyMap<string, HeadToHead> | null | undefined {
  const [records, setRecords] = useState<ReadonlyMap<string, HeadToHead> | null | undefined>(undefined);
  const loadCount = useRef(0);

  // The list is a new array on every render; what matters is who is in it.
  const key = [...friendIds].sort().join(',');
  const ids = useMemo(() => (key ? key.split(',') : []), [key]);

  useEffect(() => {
    if (!userId) return;
    let live = true;

    const load = async () => {
      const mine = ++loadCount.current;
      let result: Awaited<ReturnType<typeof fetchHeadToHeads>> = null;
      try {
        result = await fetchHeadToHeads(userId, ids);
      } catch (error) {
        console.error('[friends] records load failed:', error);
      }
      // Gone from the screen, or a newer read started while this one was out.
      if (live && mine === loadCount.current) setRecords(result);
    };

    void load();
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      live = false;
      window.removeEventListener('focus', onFocus);
    };
  }, [userId, ids]);

  return records;
}
