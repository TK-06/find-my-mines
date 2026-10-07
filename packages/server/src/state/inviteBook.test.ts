import { describe, expect, it } from 'vitest';
import { INVITE_BOOK_MAX, INVITE_BOOK_TTL_MS, InviteBook } from './inviteBook.js';

const invite = (id: string, from = 'ana', to = 'ben', roomId = 'ABCD') => ({
  id,
  fromProfileId: from,
  toProfileId: to,
  roomId,
});

describe('InviteBook', () => {
  it('remembers an invite for a little longer than the popup lives', () => {
    // The popup goes after 60 s; the extra seconds cover a last-moment Decline.
    expect(INVITE_BOOK_TTL_MS).toBeGreaterThan(60_000);
    expect(INVITE_BOOK_TTL_MS).toBeLessThanOrEqual(90_000);
  });

  it('hands the invite back to the account it was sent to', () => {
    const book = new InviteBook();
    book.remember(invite('i1', 'ana', 'ben', 'ROOM'), 0);
    expect(book.decline('i1', 'ben', 1_000)).toMatchObject({
      id: 'i1',
      fromProfileId: 'ana',
      toProfileId: 'ben',
      roomId: 'ROOM',
    });
  });

  it('accepts a decline once: a second one for the same invite finds nothing', () => {
    const book = new InviteBook();
    book.remember(invite('i1'), 0);
    expect(book.decline('i1', 'ben', 1)).not.toBeNull();
    expect(book.decline('i1', 'ben', 2)).toBeNull();
    expect(book.size).toBe(0);
  });

  it('ignores an id nobody sent', () => {
    const book = new InviteBook();
    book.remember(invite('i1'), 0);
    expect(book.decline('forged', 'ben', 1)).toBeNull();
    expect(book.size).toBe(1);
  });

  it('ignores a decline from anyone but the invited account — and does not use the invite up', () => {
    const book = new InviteBook();
    book.remember(invite('i1', 'ana', 'ben'), 0);
    // The sender cannot decline their own invite, nor can a bystander.
    expect(book.decline('i1', 'ana', 1)).toBeNull();
    expect(book.decline('i1', 'cy', 2)).toBeNull();
    // Ben still can.
    expect(book.decline('i1', 'ben', 3)).not.toBeNull();
  });

  it('ignores a guest, who has no account to have been invited as', () => {
    const book = new InviteBook();
    book.remember(invite('i1'), 0);
    expect(book.decline('i1', null, 1)).toBeNull();
    expect(book.decline('i1', undefined, 1)).toBeNull();
    expect(book.decline('i1', '', 1)).toBeNull();
    expect(book.size).toBe(1);
  });

  it('ignores an id that is not a string', () => {
    const book = new InviteBook();
    book.remember(invite('i1'), 0);
    for (const bad of [undefined, null, 7, {}, [], ['i1'], true]) {
      expect(book.decline(bad, 'ben', 1)).toBeNull();
    }
    expect(book.size).toBe(1);
  });

  it('forgets an invite once it has run out', () => {
    const book = new InviteBook(1_000);
    book.remember(invite('i1'), 0);
    expect(book.decline('i1', 'ben', 999)).not.toBeNull();

    book.remember(invite('i2'), 0);
    expect(book.decline('i2', 'ben', 1_000)).toBeNull();
    expect(book.size).toBe(0);
  });

  it('does not let one invite shield another from expiring', () => {
    const book = new InviteBook(1_000);
    book.remember(invite('old'), 0);
    book.remember(invite('new'), 900);
    expect(book.decline('old', 'ben', 1_100)).toBeNull();
    expect(book.decline('new', 'ben', 1_100)).not.toBeNull();
  });

  it('keeps invites to different friends and from different players apart', () => {
    const book = new InviteBook();
    book.remember(invite('i1', 'ana', 'ben'), 0);
    book.remember(invite('i2', 'ana', 'cy'), 0);
    book.remember(invite('i3', 'dee', 'ben'), 0);
    expect(book.decline('i2', 'ben', 1)).toBeNull();
    expect(book.decline('i2', 'cy', 1)?.fromProfileId).toBe('ana');
    expect(book.decline('i3', 'ben', 1)?.fromProfileId).toBe('dee');
    expect(book.decline('i1', 'ben', 1)?.fromProfileId).toBe('ana');
  });

  it('stays bounded: past the cap the oldest invites are the ones forgotten', () => {
    const book = new InviteBook(60_000, 3);
    for (const id of ['a', 'b', 'c', 'd', 'e']) book.remember(invite(id), 0);
    expect(book.size).toBe(3);
    expect(book.decline('a', 'ben', 1)).toBeNull();
    expect(book.decline('b', 'ben', 1)).toBeNull();
    expect(book.decline('c', 'ben', 1)).not.toBeNull();
    expect(book.decline('e', 'ben', 1)).not.toBeNull();
  });

  it('has a generous default cap, so ordinary play never hits it', () => {
    expect(INVITE_BOOK_MAX).toBeGreaterThanOrEqual(500);
  });

  it('prunes on its own as time passes, so a long-running server does not grow', () => {
    const book = new InviteBook(1_000);
    for (const id of ['a', 'b', 'c']) book.remember(invite(id), 0);
    expect(book.size).toBe(3);
    book.remember(invite('later'), 5_000);
    expect(book.size).toBe(1);
  });
});
