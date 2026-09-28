import { describe, expect, it } from 'vitest';
import { INVITE_COOLDOWN_MS, InviteLimit } from './inviteLimit.js';

describe('InviteLimit', () => {
  it('waits ten seconds between invites to the same friend', () => {
    expect(INVITE_COOLDOWN_MS).toBe(10_000);
  });

  it('lets the first invite through', () => {
    expect(new InviteLimit().tryInvite('ana', 'ben', 0)).toBe(0);
  });

  it('refuses the same friend again too soon, saying how long is left', () => {
    const limit = new InviteLimit();
    limit.tryInvite('ana', 'ben', 1_000);
    expect(limit.tryInvite('ana', 'ben', 5_000)).toBe(6_000);
  });

  it('lets it through again once the cooldown has passed', () => {
    const limit = new InviteLimit();
    limit.tryInvite('ana', 'ben', 0);
    expect(limit.tryInvite('ana', 'ben', 10_000)).toBe(0);
  });

  it('does not restart the clock on a refused attempt — spamming the button buys nothing', () => {
    const limit = new InviteLimit();
    limit.tryInvite('ana', 'ben', 0);
    expect(limit.tryInvite('ana', 'ben', 9_000)).toBeGreaterThan(0);
    expect(limit.tryInvite('ana', 'ben', 10_000)).toBe(0);
  });

  it('leaves invites to other friends alone', () => {
    const limit = new InviteLimit();
    limit.tryInvite('ana', 'ben', 0);
    expect(limit.tryInvite('ana', 'cy', 1)).toBe(0);
  });

  it('leaves the friend inviting back alone — the limit is one direction', () => {
    const limit = new InviteLimit();
    limit.tryInvite('ana', 'ben', 0);
    expect(limit.tryInvite('ben', 'ana', 1)).toBe(0);
  });

  it('leaves other players inviting the same friend alone', () => {
    const limit = new InviteLimit();
    limit.tryInvite('ana', 'ben', 0);
    expect(limit.tryInvite('cy', 'ben', 1)).toBe(0);
  });

  it('never mixes up two pairs whose ids run together', () => {
    const limit = new InviteLimit();
    limit.tryInvite('a', 'bc', 0);
    expect(limit.tryInvite('ab', 'c', 1)).toBe(0);
  });

  it('forgets pairs once they have cooled down, so a long-running server does not grow', () => {
    const limit = new InviteLimit(1_000);
    limit.tryInvite('ana', 'ben', 0);
    limit.tryInvite('ana', 'cy', 0);
    expect(limit.size).toBe(2);
    limit.tryInvite('dee', 'eve', 5_000);
    expect(limit.size).toBe(1);
  });
});
