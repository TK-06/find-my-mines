import { describe, expect, it } from 'vitest';
import { isSamePlayer } from './seatHold.js';

const account = { profileId: 'p-1', nickname: 'Taj' };
const guest = { profileId: null, nickname: 'Hana' };

describe('isSamePlayer', () => {
  it('matches an account coming back as the same account', () => {
    expect(isSamePlayer(account, { profileId: 'p-1', nickname: 'Taj' })).toBe(true);
  });

  it('matches an account even after a rename — the account id is what counts', () => {
    expect(isSamePlayer(account, { profileId: 'p-1', nickname: 'Taj2' })).toBe(true);
  });

  it('refuses a different account', () => {
    expect(isSamePlayer(account, { profileId: 'p-2', nickname: 'Taj' })).toBe(false);
  });

  it('refuses an account seat coming back as a guest (signed out in another tab)', () => {
    expect(isSamePlayer(account, { profileId: null, nickname: 'Taj' })).toBe(false);
  });

  it('matches a guest coming back under the same name', () => {
    expect(isSamePlayer(guest, { profileId: null, nickname: 'Hana' })).toBe(true);
  });

  it('refuses a guest seat coming back under another name', () => {
    expect(isSamePlayer(guest, { profileId: null, nickname: 'Ivo' })).toBe(false);
  });

  it('refuses a guest seat coming back signed in (a guest who signed in elsewhere)', () => {
    expect(isSamePlayer(guest, { profileId: 'p-1', nickname: 'Hana' })).toBe(false);
  });
});
