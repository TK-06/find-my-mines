import {
  ADMIN_NAMESPACE,
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
 * connect to SERVER_URL explicitly. In production both are the same origin.
 */
const isDev = import.meta.env.DEV;
const target = isDev ? SERVER_URL : window.location.origin;

/**
 * Not auto-connected: the /admin console imports this module too, and a game
 * socket opened there would show up as a phantom client in the server's own
 * "clients online" count. `useGame` connects it, and only the game screen
 * uses `useGame`.
 */
/**
 * The handshake carries the Supabase access token, read at the moment the
 * connection opens, so the server can verify who this connection belongs to.
 * No token means guest.
 */
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(target, {
  autoConnect: false,
  transports: ['websocket', 'polling'],
  auth: tokenAuth(currentAccessToken),
});

/**
 * The console sends the same token: away from the server machine, only an
 * account listed as an admin is let in.
 */
export const adminSocket: Socket<ServerToAdminEvents, AdminToServerEvents> = io(
  `${target}${ADMIN_NAMESPACE}`,
  { autoConnect: false, transports: ['websocket', 'polling'], auth: tokenAuth(currentAccessToken) },
);
