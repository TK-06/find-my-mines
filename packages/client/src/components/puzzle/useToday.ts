import { dailyKey } from '@fmm/shared';
import { useEffect, useState } from 'react';

/**
 * Today's Daily key, 'YYYY-MM-DD' in Bangkok time, kept current: a page left
 * open across midnight moves on to the new day within a few seconds, without a
 * reload. It only re-renders the screen when the key itself changes.
 */
export function useToday(): string {
  const [today, setToday] = useState(() => dailyKey(Date.now()));
  useEffect(() => {
    const id = window.setInterval(() => setToday(dailyKey(Date.now())), 15_000);
    return () => window.clearInterval(id);
  }, []);
  return today;
}
