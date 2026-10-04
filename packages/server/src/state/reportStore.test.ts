import type { PlayerReport } from '@fmm/shared';
import { describe, expect, it } from 'vitest';
import { REPORT_KEEP_MS, ReportStore } from './reportStore.js';

const party = {
  nickname: 'Bob',
  profileId: null,
  isGuest: true,
  guestId: null,
  sessionId: null,
  address: '198.51.100.7',
};

function report(id: string, createdAt: number): PlayerReport {
  return {
    id,
    createdAt,
    reason: 'harassment',
    details: '',
    roomId: null,
    reporter: party,
    target: { ...party, nickname: 'Eve', clientId: 'sock-eve' },
    status: 'open',
    handledAt: null,
  };
}

describe('ReportStore', () => {
  it('lists newest first', () => {
    const store = new ReportStore();
    store.add(report('a', 1));
    store.add(report('b', 2));
    expect(store.list().map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('keeps only the newest when full', () => {
    const store = new ReportStore(2);
    store.add(report('a', 1));
    store.add(report('b', 2));
    store.add(report('c', 3));
    expect(store.list().map((r) => r.id)).toEqual(['c', 'b']);
  });

  it('marks a report handled, and open again', () => {
    const store = new ReportStore();
    store.add(report('a', 1));
    expect(store.setStatus('a', 'resolved', 50)).toMatchObject({ status: 'resolved', handledAt: 50 });
    expect(store.setStatus('a', 'open', 60)).toMatchObject({ status: 'open', handledAt: null });
    expect(store.setStatus('missing', 'dismissed', 70)).toBeUndefined();
  });

  it('hands out copies', () => {
    const store = new ReportStore();
    store.add(report('a', 1));
    store.list()[0]!.status = 'dismissed';
    expect(store.get('a')?.status).toBe('open');
  });

  it('merges reports loaded from the database by id, newest first', () => {
    const store = new ReportStore();
    store.add(report('live', 30));
    store.addAll([report('old', 10), report('live', 30), report('mid', 20)]);
    expect(store.list().map((r) => r.id)).toEqual(['live', 'mid', 'old']);
  });

  it('forgets reports past the keep period', () => {
    const store = new ReportStore();
    store.add(report('old', 0));
    store.add(report('new', REPORT_KEEP_MS));
    expect(store.prune(REPORT_KEEP_MS + 1)).toBe(1);
    expect(store.list().map((r) => r.id)).toEqual(['new']);
  });
});
