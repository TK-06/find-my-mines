import { describe, expect, it } from 'vitest';
import {
  MAX_REMARK_LENGTH,
  describeReasons,
  hostCanModerate,
  hostModerationError,
  parseRemovalNote,
} from './moderation.js';

describe('parseRemovalNote', () => {
  it('accepts a single known reason with no remark', () => {
    expect(parseRemovalNote({ reasons: ['afk'], remark: '' })).toEqual({
      ok: true,
      note: { reasons: ['afk'], remark: '' },
    });
  });

  it('accepts a remark with no reasons', () => {
    expect(parseRemovalNote({ reasons: [], remark: 'kept stalling' })).toEqual({
      ok: true,
      note: { reasons: [], remark: 'kept stalling' },
    });
  });

  it('trims the remark', () => {
    const result = parseRemovalNote({ reasons: ['other'], remark: '   spam links  ' });
    expect(result.ok && result.note.remark).toBe('spam links');
  });

  it('drops unknown reasons rather than trusting the client', () => {
    const result = parseRemovalNote({ reasons: ['afk', 'made-up', 42], remark: '' });
    expect(result.ok && result.note.reasons).toEqual(['afk']);
  });

  it('removes duplicate reasons and keeps them in the canonical order', () => {
    const result = parseRemovalNote({ reasons: ['cheating', 'afk', 'cheating'], remark: '' });
    expect(result.ok && result.note.reasons).toEqual(['afk', 'cheating']);
  });

  it('rejects a note with no reason and no remark', () => {
    expect(parseRemovalNote({ reasons: [], remark: '   ' }).ok).toBe(false);
  });

  it('rejects a note whose only reasons are unknown', () => {
    expect(parseRemovalNote({ reasons: ['nonsense'], remark: '' }).ok).toBe(false);
  });

  it('rejects a remark over the length limit', () => {
    const result = parseRemovalNote({ reasons: ['afk'], remark: 'x'.repeat(MAX_REMARK_LENGTH + 1) });
    expect(result.ok).toBe(false);
  });

  it('accepts a remark exactly at the length limit', () => {
    const result = parseRemovalNote({ reasons: [], remark: 'x'.repeat(MAX_REMARK_LENGTH) });
    expect(result.ok).toBe(true);
  });

  it('rejects input that is not an object', () => {
    expect(parseRemovalNote(null).ok).toBe(false);
    expect(parseRemovalNote('afk').ok).toBe(false);
    expect(parseRemovalNote(undefined).ok).toBe(false);
  });

  it('treats a missing reasons array as empty', () => {
    expect(parseRemovalNote({ remark: 'rude' })).toEqual({
      ok: true,
      note: { reasons: [], remark: 'rude' },
    });
  });
});

describe('describeReasons', () => {
  it('joins reason labels and quotes the remark', () => {
    expect(describeReasons({ reasons: ['afk', 'cheating'], remark: 'asleep' })).toBe(
      'Inactive / AFK · Cheating · "asleep"',
    );
  });

  it('omits the remark when there is none', () => {
    expect(describeReasons({ reasons: ['offensive-name'], remark: '' })).toBe('Offensive name');
  });
});

/** A Custom board: three seats, so not the graded Classic configuration. */
const custom = { rows: 6, cols: 6, mineCount: 11, maxPlayers: 3, mode: 'casual' as const };
const classicBoard = { rows: 6, cols: 6, mineCount: 11, maxPlayers: 2, mode: 'casual' as const };

describe('hostCanModerate', () => {
  it('allows a casual Custom room a player created', () => {
    expect(hostCanModerate('created', custom)).toBe(true);
  });

  it('refuses a ranked room, where a kick could dodge a rating loss', () => {
    expect(hostCanModerate('created', { ...custom, mode: 'ranked' })).toBe(false);
  });

  it('refuses a matchmade room, where nobody chose to host', () => {
    expect(hostCanModerate('matchmaking', custom)).toBe(false);
  });

  it('refuses a Classic room, which keeps the original assignment rules', () => {
    expect(hostCanModerate('created', classicBoard)).toBe(false);
  });
});

describe('hostModerationError', () => {
  const base = {
    origin: 'created' as const,
    config: custom,
    actorId: 'host',
    hostId: 'host',
    targetId: 'bob',
    targetInRoom: true,
  };

  it('allows the host to remove another member of a casual Custom room', () => {
    expect(hostModerationError(base)).toBeNull();
  });

  it('refuses anyone who is not the host', () => {
    expect(hostModerationError({ ...base, actorId: 'carol' })).toMatch(/host/i);
  });

  it('refuses in a ranked room', () => {
    expect(hostModerationError({ ...base, config: { ...custom, mode: 'ranked' } })).toMatch(/casual/i);
  });

  it('refuses in a matchmade room', () => {
    expect(hostModerationError({ ...base, origin: 'matchmaking' })).toMatch(/casual/i);
  });

  it('refuses in a Classic room', () => {
    expect(hostModerationError({ ...base, config: classicBoard })).toMatch(/custom/i);
  });

  it('refuses a host removing themselves', () => {
    expect(hostModerationError({ ...base, targetId: 'host' })).toMatch(/yourself/i);
  });

  it('refuses a target outside the room', () => {
    expect(hostModerationError({ ...base, targetInRoom: false })).toMatch(/not in this room/i);
  });
});
