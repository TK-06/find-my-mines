import { describe, expect, it } from 'vitest';
import { fromRow } from './reportRecorder.js';

const party = {
  nickname: 'Bob',
  profileId: null,
  isGuest: true,
  guestId: '0123456789abcdef0123456789abcdef',
  sessionId: null,
  address: '198.51.100.7',
};

const row = {
  id: '6a2b1f2e-0000-4000-8000-000000000001',
  created_at: '2026-10-03T10:00:00.000Z',
  reason: 'harassment',
  details: 'kept spamming',
  room_id: 'K7Q2',
  status: 'open',
  handled_at: null,
  reporter: party,
  target: { ...party, nickname: 'Eve', clientId: 'sock' },
};

describe('fromRow', () => {
  it('reads a stored report back', () => {
    expect(fromRow(row)).toEqual({
      id: row.id,
      createdAt: Date.parse(row.created_at),
      reason: 'harassment',
      details: 'kept spamming',
      roomId: 'K7Q2',
      reporter: party,
      target: row.target,
      status: 'open',
      handledAt: null,
    });
  });

  it('reads the handled time', () => {
    expect(fromRow({ ...row, status: 'resolved', handled_at: '2026-10-03T11:00:00.000Z' })?.handledAt).toBe(
      Date.parse('2026-10-03T11:00:00.000Z'),
    );
  });

  it('drops rows that are not ours', () => {
    expect(fromRow({ ...row, reason: 'afk' })).toBeNull();
    expect(fromRow({ ...row, status: 'deleted' })).toBeNull();
    expect(fromRow({ ...row, created_at: 'never' })).toBeNull();
    expect(fromRow({ ...row, reporter: null as never })).toBeNull();
  });
});
