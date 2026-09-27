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
 * This is one of the two ways into the server console — the other is an admin
 * account. It keeps the graded Reset button reachable on the demo laptop even
 * when the database is not.
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

export interface ConsoleHandshake {
  address?: string;
  headers: Record<string, string | string[] | undefined>;
  auth?: Record<string, unknown>;
}

/**
 * Who may open the server console: the server machine, or an admin account.
 * Returns a label for the log, or null to refuse.
 *
 * Any failure in the account lookup refuses the connection. This runs inside
 * socket.io middleware, where a rejected promise would leave the connection
 * hanging and surface as an unhandled rejection in the server process.
 */
export async function adminAccess(
  handshake: ConsoleHandshake,
  own: string[],
  lookupAdmin: (accessToken: string | undefined) => Promise<string | null>,
): Promise<string | null> {
  if (isServerMachine(handshake.address, handshake.headers, own)) return 'server machine';

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
