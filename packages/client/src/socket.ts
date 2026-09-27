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
 * Not auto-connected: the /admin console imports this module too, and a game
 * socket opened there would show up as a phantom client in the server's own
 * "clients online" count. `useGame` connects it, and only the game screen
 * uses `useGame`.
 */
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(target, {
  autoConnect: false,
  transports: ['websocket', 'polling'],
});

/**
 * Attaches the Supabase access token to the handshake so the server can verify
 * who this connection belongs to. Called before connecting, and again after a
 * sign-in or sign-out so the next connection carries the right identity.
 */
export function setAccessToken(accessToken: string | undefined): void {
  socket.auth = accessToken ? { accessToken } : {};
}

export const adminSocket: Socket<ServerToAdminEvents, AdminToServerEvents> = io(
  `${target}${ADMIN_NAMESPACE}`,
  {
    autoConnect: false,
    transports: ['websocket', 'polling'],
    // Only checked when the server sets ADMIN_TOKEN: open /admin?token=<value>.
    auth: { token: new URLSearchParams(window.location.search).get('token') ?? '' },
  },
);
