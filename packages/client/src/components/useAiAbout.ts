import type { AiAbout } from '@fmm/shared';
import { useEffect, useState } from 'react';
import type { AboutState } from '../data/aiPlay.js';

/**
 * What the server said about its opponents, kept for the session so the lobby
 * card and the About dialog share one answer — and one request. A failed
 * check is not kept: the next component to ask tries again.
 */
let cached: AiAbout | null = null;
let inflight: Promise<void> | null = null;
const listeners = new Set<(result: AiAbout | null) => void>();

function request(onAbout: () => Promise<AiAbout | null>): void {
  if (inflight) return;
  inflight = onAbout()
    .catch(() => null)
    .then((result) => {
      inflight = null;
      if (result) cached = result;
      for (const listener of listeners) listener(result);
    });
}

/**
 * The server's answer to `ai:about`: 'checking' until it arrives, null if it
 * could not be had. Whoever mounts first asks; everyone else waits on the same
 * request, and hears of the answer however they came to be waiting.
 */
export function useAiAbout(onAbout: () => Promise<AiAbout | null>): AboutState {
  const [about, setAbout] = useState<AboutState>(cached ?? 'checking');

  useEffect(() => {
    listeners.add(setAbout);
    if (cached) setAbout(cached);
    else request(onAbout);
    return () => {
      listeners.delete(setAbout);
    };
  }, [onAbout]);

  return about;
}
