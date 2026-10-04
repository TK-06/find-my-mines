import { describe, expect, it } from 'vitest';
import {
  REPORT_DETAILS_MAX,
  REPORT_REASONS,
  REPORT_REASON_LABELS,
  describeReport,
  isGuestId,
  isReportStatus,
  parseReport,
} from './reports.js';

describe('parseReport', () => {
  it('accepts a known reason with no details', () => {
    expect(parseReport({ targetId: 'abc', reason: 'harassment' })).toEqual({
      ok: true,
      targetId: 'abc',
      reason: 'harassment',
      details: '',
    });
  });

  it('trims the details and folds runs of whitespace', () => {
    const parsed = parseReport({ targetId: 'abc', reason: 'spam', details: '  posts \n\n\n  links   again ' });
    expect(parsed).toEqual({ ok: true, targetId: 'abc', reason: 'spam', details: 'posts links again' });
  });

  it('refuses anything that is not an object', () => {
    for (const input of [null, undefined, 42, 'harassment', []]) {
      expect(parseReport(input).ok).toBe(false);
    }
  });

  it('refuses an unknown or missing reason', () => {
    expect(parseReport({ targetId: 'abc', reason: 'afk' }).ok).toBe(false);
    expect(parseReport({ targetId: 'abc' }).ok).toBe(false);
    expect(parseReport({ targetId: 'abc', reason: ['harassment'] }).ok).toBe(false);
  });

  it('refuses a missing, empty or oversized target', () => {
    expect(parseReport({ reason: 'cheating' }).ok).toBe(false);
    expect(parseReport({ targetId: '', reason: 'cheating' }).ok).toBe(false);
    expect(parseReport({ targetId: {}, reason: 'cheating' }).ok).toBe(false);
    expect(parseReport({ targetId: 'x'.repeat(65), reason: 'cheating' }).ok).toBe(false);
  });

  it('caps the details', () => {
    const exact = parseReport({ targetId: 'a', reason: 'other', details: 'x'.repeat(REPORT_DETAILS_MAX) });
    const over = parseReport({ targetId: 'a', reason: 'other', details: 'x'.repeat(REPORT_DETAILS_MAX + 1) });
    expect(exact.ok).toBe(true);
    expect(over.ok).toBe(false);
  });

  it('needs a few words for "Something else"', () => {
    expect(parseReport({ targetId: 'a', reason: 'other' }).ok).toBe(false);
    expect(parseReport({ targetId: 'a', reason: 'other', details: '  ok ' }).ok).toBe(false);
    expect(parseReport({ targetId: 'a', reason: 'other', details: 'kept saying slurs' }).ok).toBe(true);
  });

  it('ignores a details field that is not a string', () => {
    expect(parseReport({ targetId: 'a', reason: 'cheating', details: { evil: true } })).toEqual({
      ok: true,
      targetId: 'a',
      reason: 'cheating',
      details: '',
    });
  });
});

describe('report labels and statuses', () => {
  it('labels every reason', () => {
    for (const reason of REPORT_REASONS) expect(REPORT_REASON_LABELS[reason]).toMatch(/\w/);
  });

  it('takes only a 32-character lowercase hex string as a guest id', () => {
    expect(isGuestId('0123456789abcdef0123456789abcdef')).toBe(true);
    expect(isGuestId('0123456789ABCDEF0123456789ABCDEF')).toBe(false);
    expect(isGuestId('0123456789abcdef')).toBe(false);
    expect(isGuestId('0123456789abcdef0123456789abcdeg')).toBe(false);
    expect(isGuestId(42)).toBe(false);
  });

  it('knows the three statuses and nothing else', () => {
    expect(['open', 'resolved', 'dismissed'].every(isReportStatus)).toBe(true);
    expect(isReportStatus('deleted')).toBe(false);
    expect(isReportStatus(undefined)).toBe(false);
  });

  it('describes a report in one line', () => {
    const party = { profileId: null, isGuest: true, guestId: null, sessionId: null, address: '1.2.3.4' };
    expect(
      describeReport({
        reason: 'harassment',
        reporter: { ...party, nickname: 'Bob' },
        target: { ...party, nickname: 'Eve', clientId: 'x' },
      }),
    ).toBe('Bob reported Eve — Harassment in chat');
  });
});
