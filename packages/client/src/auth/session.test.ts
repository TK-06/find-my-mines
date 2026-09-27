import { describe, expect, it } from 'vitest';
import { identityChanged, tokenAuth } from './session.js';

describe('identityChanged', () => {
  it('ignores events while we are still learning who is signed in', () => {
    expect(identityChanged(undefined, 'user-a')).toBe(false);
    expect(identityChanged(undefined, null)).toBe(false);
  });

  it('ignores SIGNED_IN for the same user — every other tab broadcasts that on page load', () => {
    expect(identityChanged('user-a', 'user-a')).toBe(false);
  });

  it('ignores a guest staying a guest', () => {
    expect(identityChanged(null, null)).toBe(false);
  });

  it('reports a guest signing in', () => {
    expect(identityChanged(null, 'user-a')).toBe(true);
  });

  it('reports a user signing out', () => {
    expect(identityChanged('user-a', null)).toBe(true);
  });

  it('reports a switch to a different account', () => {
    expect(identityChanged('user-a', 'user-b')).toBe(true);
  });
});

describe('tokenAuth', () => {
  const handshake = (getToken: () => Promise<string | undefined>) =>
    new Promise<object>((resolve) => tokenAuth(getToken)(resolve));

  it('sends the current access token in the handshake', async () => {
    expect(await handshake(async () => 'tok')).toEqual({ accessToken: 'tok' });
  });

  it('sends an empty handshake for a guest', async () => {
    expect(await handshake(async () => undefined)).toEqual({});
  });

  it('falls back to a guest handshake if the session lookup fails', async () => {
    expect(
      await handshake(async () => {
        throw new Error('storage unavailable');
      }),
    ).toEqual({});
  });

  describe('with extra handshake fields', () => {
    const extra = { sessionId: 'tab-1234567890abcdef' };
    const withExtra = (getToken: () => Promise<string | undefined>) =>
      new Promise<object>((resolve) => tokenAuth(getToken, extra)(resolve));

    it('sends them alongside the access token', async () => {
      expect(await withExtra(async () => 'tok')).toEqual({ ...extra, accessToken: 'tok' });
    });

    it('still sends them for a guest — a guest can hold a seat through a reconnect too', async () => {
      expect(await withExtra(async () => undefined)).toEqual(extra);
    });

    it('still sends them when the session lookup fails', async () => {
      expect(
        await withExtra(async () => {
          throw new Error('storage unavailable');
        }),
      ).toEqual(extra);
    });
  });
});
