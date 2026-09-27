import {
  ADMIN_NAMESPACE,
  PUBLIC_SERVER_URL,
  SERVER_URL,
  type AdminToServerEvents,
  type ClientToServerEvents,
  type ServerToAdminEvents,
  type ServerToClientEvents,
} from '@fmm/shared';
import { io, type Socket } from 'socket.io-client';
import { currentAccessToken } from './auth/supabase.js';
import { tokenAuth } from './auth/session.js';

/**
 * The server address comes from the shared source-code constant — the client
 * never asks the user for an IP or port (assignment requirement).
 *
 * In dev the Vite server is on :5173 while the game server is on :3000, so we
 * connect to SERVER_URL explicitly. In production the client either talks to
 * PUBLIC_SERVER_URL (hosted: client on Vercel, server on Render) or, when that
 * is empty, to the origin that served it. VITE_SERVER_URL overrides both so a
 * Vercel build can be repointed from its dashboard without a commit.
 */
const isDev = import.meta.env.DEV;
const hostedServer =
  (import.meta.env.VITE_SERVER_URL as string | undefined) || PUBLIC_SERVER_URL;
const target = isDev ? SERVER_URL : hostedServer || window.location.origin;

/**
 * Identifies this tab across reconnects, so the server can hand a held seat
 * back after a refresh or a dropped connection. Per tab (sessionStorage): a
 * second tab is a second player.
 */
function tabSessionId(): string {
  const key = 'fmm.session';
  // getRandomValues, not randomUUID: the LAN demo runs over plain http, where
  // randomUUID does not exist.
  const fresh = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const id = fresh();
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    // Storage blocked: reconnects within this page load still work.
    return fresh();
  }
}

const sessionId = tabSessionId();

/**
 * Not auto-connected: the /admin console imports this module too, and a game
 * socket opened there would show up as a phantom client in the server's own
 * "clients online" count. `useGame` connects it, and only the game screen
 * uses `useGame`.
 *
 * The handshake carries the Supabase access token, read at the moment the
 * connection opens, so the server can verify who this connection belongs to —
 * no token means guest — and the tab's session id, so a dropped connection can
 * take its held seat back.
 */
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(target, {
  autoConnect: false,
  transports: ['websocket', 'polling'],
  auth: tokenAuth(currentAccessToken, { sessionId }),
});

/**
 * The console sends the same token: away from the server machine, an account
 * listed as an admin is let in. When the server sets ADMIN_TOKEN, opening
 * /admin?token=<value> is a third way in.
 */
export const adminSocket: Socket<ServerToAdminEvents, AdminToServerEvents> = io(
  `${target}${ADMIN_NAMESPACE}`,
  {
    autoConnect: false,
    transports: ['websocket', 'polling'],
    auth: tokenAuth(currentAccessToken, {
      token: new URLSearchParams(window.location.search).get('token') ?? '',
    }),
  },
);
