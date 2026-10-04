import { createHash, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';

/**
 * Headers a tunnel or reverse proxy adds when it forwards a request. Cloudflare
 * Tunnel, ngrok and VS Code port forwarding (Microsoft dev tunnels, which set
 * X-Forwarded-Host) all connect to the server from localhost, so without this
 * check every visitor through a tunnel would look like the server machine.
 * A browser talking to the server directly sends none of these.
 */
const FORWARDING_HEADERS = [
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'forwarded',
  'via',
  'cf-connecting-ip',
  'true-client-ip',
  'x-client-ip',
];

const LOOPBACK = new Set(['127.0.0.1', '::1']);

/** Node reports IPv4 peers on a dual-stack socket as ::ffff:a.b.c.d. */
function normalise(address: string): string {
  return address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
}

/**
 * True when a connection comes from the machine running the server, directly.
 *
 * One of the ways into the server console, alongside an admin account and
 * ADMIN_TOKEN. It keeps the graded Reset button reachable on the demo laptop
 * even when the database is not.
 */
export function isServerMachine(
  address: string | undefined,
  headers: Record<string, string | string[] | undefined>,
  ownAddresses: string[],
): boolean {
  if (!address) return false;
  if (FORWARDING_HEADERS.some((header) => headers[header] !== undefined)) return false;

  const peer = normalise(address);
  return LOOPBACK.has(peer) || ownAddresses.map(normalise).includes(peer);
}

/** Only the characters an IPv4 or IPv6 address can hold, and no longer than one can be. */
const IP_LIKE = /^[0-9a-fA-F:.]{2,45}$/;

/** A header's single value, or undefined when it is missing or sent more than once. */
function single(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

/**
 * The address to show for a connection: the visitor's own, as far as the
 * server can tell.
 *
 * Behind the Cloudflare tunnel every visitor reaches the server from the
 * tunnel process on this machine, so the peer is always 127.0.0.1. Cloudflare
 * puts the real visitor's address in CF-Connecting-IP (and X-Forwarded-For).
 * Those headers are believed only when the peer is loopback — that is, when
 * the request came through something running on this machine. Anyone
 * connecting from elsewhere could write any header they like, so for them the
 * peer address stands.
 *
 * For display and reports only. Nothing about access is decided by this:
 * `isServerMachine` still refuses every forwarded request.
 */
export function clientAddress(
  address: string | undefined,
  headers: Record<string, string | string[] | undefined>,
): string {
  if (!address) return 'unknown';
  const peer = normalise(address);
  if (!LOOPBACK.has(peer)) return peer;

  const cloudflare = single(headers['cf-connecting-ip']);
  if (cloudflare && IP_LIKE.test(cloudflare)) return normalise(cloudflare);

  // The left-most entry is the original client; later ones are proxies.
  const forwarded = single(headers['x-forwarded-for'])?.split(',')[0]?.trim();
  if (forwarded && IP_LIKE.test(forwarded)) return normalise(forwarded);

  return peer;
}

export interface ConsoleHandshake {
  address?: string;
  headers: Record<string, string | string[] | undefined>;
  auth?: Record<string, unknown>;
}

/**
 * True when the handshake carries the server's ADMIN_TOKEN. No token configured
 * means this route is closed — an unset token never opens the console.
 * Compared through fixed-length digests, so timing does not leak the token.
 */
export function adminTokenMatches(given: unknown, expected: string): boolean {
  if (!expected || typeof given !== 'string') return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/**
 * Who may open the server console: the server machine, the ADMIN_TOKEN (when
 * the server sets one, for a hosted console opened as /admin?token=…), or an
 * admin account. Returns a label for the log, or null to refuse.
 *
 * Any failure in the account lookup refuses the connection. This runs inside
 * socket.io middleware, where a rejected promise would leave the connection
 * hanging and surface as an unhandled rejection in the server process.
 */
export async function adminAccess(
  handshake: ConsoleHandshake,
  own: string[],
  lookupAdmin: (accessToken: string | undefined) => Promise<string | null>,
  adminToken = '',
): Promise<string | null> {
  if (isServerMachine(handshake.address, handshake.headers, own)) return 'server machine';
  if (adminTokenMatches(handshake.auth?.token, adminToken)) return 'admin token';

  const token = handshake.auth?.accessToken;
  try {
    return await lookupAdmin(typeof token === 'string' ? token : undefined);
  } catch {
    return null;
  }
}

/** Every address this machine's network interfaces currently hold. */
export function ownAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .flatMap((iface) => (iface ? [iface.address] : []));
}
