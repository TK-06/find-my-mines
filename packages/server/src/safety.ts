/**
 * Keeping one bad message from taking the server down.
 *
 * Socket.IO runs event handlers with no try/catch around them, so an exception
 * in any handler — say, a client sending `room:join` with no payload — becomes
 * an uncaught exception and kills the process, ending every match on the
 * server. Everything that runs on a client's behalf, or on a timer, goes
 * through `contain`.
 */

/**
 * Wraps a handler so a throw, or a rejected promise from an async handler, is
 * reported instead of escaping. The failure stays with that one event.
 */
export function contain<A extends unknown[]>(
  handler: (...args: A) => unknown,
  onError: (error: unknown, args: A) => void,
): (...args: A) => void {
  return (...args: A) => {
    try {
      const result = handler(...args);
      if (result instanceof Promise) result.catch((error: unknown) => onError(error, args));
    } catch (error) {
      onError(error, args);
    }
  };
}

/**
 * Calls a Socket.IO acknowledgement if the client actually sent one. The
 * argument in that position is whatever the client chose to send — a number,
 * a string — and calling it blindly would throw.
 */
export function respond<T>(ack: unknown, value: T): void {
  if (typeof ack === 'function') (ack as (result: T) => void)(value);
}

/**
 * The work's result if it succeeds within `ms`, otherwise `fallback`. For
 * calls to the database, which must never leave a player hanging when it is
 * slow or unreachable.
 */
export function settleWithin<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}
