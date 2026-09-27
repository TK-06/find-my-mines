import { afterEach, describe, expect, it, vi } from 'vitest';
import { contain, respond, settleWithin } from './safety.js';

describe('contain', () => {
  it('passes every argument through and runs the handler normally', () => {
    const seen: unknown[] = [];
    contain((...args: unknown[]) => seen.push(...args), () => undefined)('a', 2, null);
    expect(seen).toEqual(['a', 2, null]);
  });

  it('turns a thrown error into a report instead of letting it escape', () => {
    const reports: unknown[] = [];
    const wrapped = contain(
      (payload: { roomId: string }) => payload.roomId,
      (error) => reports.push(error),
    );
    expect(() => wrapped(undefined as never)).not.toThrow();
    expect(reports).toHaveLength(1);
  });

  it('hands the failing call’s arguments to the report', () => {
    let reportedArgs: unknown[] = [];
    contain(
      (..._args: unknown[]) => {
        throw new Error('boom');
      },
      (_error, args) => {
        reportedArgs = args;
      },
    )('x', 1);
    expect(reportedArgs).toEqual(['x', 1]);
  });

  it('reports a rejected promise from an async handler', async () => {
    const reports: unknown[] = [];
    contain(
      async () => {
        throw new Error('later');
      },
      (error) => reports.push(error),
    )();
    await new Promise((r) => setTimeout(r, 0));
    expect(reports).toHaveLength(1);
  });
});

describe('respond', () => {
  it('calls a real acknowledgement', () => {
    const got: unknown[] = [];
    respond((value: unknown) => got.push(value), { ok: true });
    expect(got).toEqual([{ ok: true }]);
  });

  it('ignores anything that is not a function — a client can send any value there', () => {
    expect(() => respond(5, { ok: true })).not.toThrow();
    expect(() => respond('ack', { ok: true })).not.toThrow();
    expect(() => respond(undefined, { ok: true })).not.toThrow();
    expect(() => respond({}, { ok: true })).not.toThrow();
  });
});

describe('settleWithin', () => {
  afterEach(() => vi.useRealTimers());

  it('resolves with the value when the work finishes in time', async () => {
    expect(await settleWithin(Promise.resolve('fast'), 1000, 'fallback')).toBe('fast');
  });

  it('resolves with the fallback when the work takes too long', async () => {
    vi.useFakeTimers();
    const pending = settleWithin(new Promise<string>(() => undefined), 5000, 'fallback');
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toBe('fallback');
  });

  it('resolves with the fallback when the work fails', async () => {
    expect(await settleWithin(Promise.reject(new Error('down')), 1000, 'fallback')).toBe('fallback');
  });
});
