import {
  ADMIN_ONLY_ERROR,
  parseRemovalNote,
  type AdminRoomView,
  type AdminState,
  type AdminToServerEvents,
  type ModerationResult,
  type RemovalNote,
  type ServerToAdminEvents,
} from '@fmm/shared';
import type { Namespace, Socket } from 'socket.io';
import type { RoomManager } from '../rooms/roomManager.js';
import { contain, respond, settleWithin } from '../safety.js';
import { adminAccountFromToken } from '../supabase.js';
import { adminAccess, ownAddresses } from './access.js';
import type { ActivityLog } from './activityLog.js';

type AdminNamespace = Namespace<AdminToServerEvents, ServerToAdminEvents>;
type AdminSocket = Socket<AdminToServerEvents, ServerToAdminEvents>;

/** How long the admin-account check may take before the console is refused. */
const ADMIN_LOOKUP_TIMEOUT_MS = 5000;

/** What the console needs from the game server. Keeps this file free of game sockets. */
export interface AdminDeps {
  adminIo: AdminNamespace;
  rooms: RoomManager;
  log: ActivityLog;
  state(): AdminState;
  isConnected(clientId: string): boolean;
  /** Out of their room and the queue, shown the kicked page; stays connected. */
  kick(clientId: string, note: RemovalNote): void;
  /** Kicked, shown the banned page, disconnected. */
  ban(clientId: string, note: RemovalNote): void;
  /** Every member told, room destroyed. False when the room does not exist. */
  closeRoom(roomId: string, note: RemovalNote): boolean;
  /** The graded Reset button: one room, or all of them. */
  reset(roomId?: string): void;
}

export interface AdminConsole {
  /** Refresh the stat tiles and lists on every open console. */
  pushState(): void;
  /** Re-send this room to whoever is watching it. Batched to once per tick. */
  roomChanged(roomId: string): void;
  /** Re-send every watched room. */
  allRoomsChanged(): void;
}

interface Watcher {
  roomId: string | null;
  showMines: boolean;
}

/**
 * The server console's namespace: access gate, live state, the terminal feed,
 * the game viewer with its mine toggle, and the moderation controls.
 */
export function attachAdminNamespace(deps: AdminDeps): AdminConsole {
  const { adminIo, rooms, log } = deps;

  const watchers = new Map<string, Watcher>();
  const pending = new Set<string>();
  let flushQueued = false;

  function viewFor(watcher: Watcher): AdminRoomView | null {
    const room = watcher.roomId ? rooms.get(watcher.roomId) : undefined;
    if (!room) return null;
    return {
      state: room.publicState(),
      // The one place mine positions leave the server: this admin socket, for
      // the room it is watching, while its toggle is on.
      mines: watcher.showMines ? (room.minePositions() ?? []) : null,
    };
  }

  function sendView(socketId: string): void {
    const watcher = watchers.get(socketId);
    if (!watcher) return;
    const view = viewFor(watcher);
    // The room is gone: tell the viewer once, then stop watching it.
    if (!view) watcher.roomId = null;
    adminIo.sockets.get(socketId)?.emit('admin:room', view);
  }

  function flush(): void {
    flushQueued = false;
    for (const [socketId, watcher] of watchers) {
      if (watcher.roomId && pending.has(watcher.roomId)) sendView(socketId);
    }
    pending.clear();
  }

  function roomChanged(roomId: string): void {
    pending.add(roomId);
    if (flushQueued) return;
    flushQueued = true;
    // A single reveal fires several room events; send the viewer one update.
    setImmediate(flush);
  }

  // ── access: the server machine, or an admin account ────────────────────
  // An unreachable database must not leave the console hanging: after a few
  // seconds the account lookup counts as "not an admin".
  const lookupAdmin = (token: string | undefined) =>
    settleWithin(adminAccountFromToken(token), ADMIN_LOOKUP_TIMEOUT_MS, null);

  adminIo.use((socket, next) => {
    void adminAccess(socket.handshake, ownAddresses(), lookupAdmin)
      .then((access) => {
        if (access) {
          socket.data.access = access;
          next();
          return;
        }
        log.add('admin', `refused a console connection from ${socket.handshake.address}`);
        next(new Error(ADMIN_ONLY_ERROR));
      })
      .catch(() => next(new Error(ADMIN_ONLY_ERROR)));
  });

  adminIo.on('connection', contain((socket: AdminSocket) => {
    /** socket.on with failures contained, like the game namespace. */
    const listen = <E extends keyof AdminToServerEvents>(
      event: E,
      handler: AdminToServerEvents[E],
    ): void => {
      socket.on(
        event,
        contain(handler as (...args: unknown[]) => unknown, (error, args) => {
          console.error(`[admin] ${event} failed:`, error);
          log.add('error', `console ${event} failed — ${error instanceof Error ? error.message : String(error)}`);
          respond(args.at(-1), { ok: false, error: 'The server could not handle that request.' });
        }) as never,
      );
    };

    watchers.set(socket.id, { roomId: null, showMines: false });

    socket.emit('admin:state', deps.state());
    // Backfill first, so the line below arrives once, live.
    socket.emit('admin:log', log.recent());
    log.add('admin', `console opened from ${socket.handshake.address} (${socket.data.access})`);

    listen('admin:reset', (payload) => {
      // A room id resets that room; anything else is "Reset all".
      const roomId = typeof payload?.roomId === 'string' ? payload.roomId : undefined;
      log.add('admin', `reset ${roomId ?? 'ALL rooms'}`);
      deps.reset(roomId);
    });

    const moderate = (
      clientId: unknown,
      rawNote: unknown,
      act: (id: string, note: RemovalNote) => void,
    ): ModerationResult => {
      const parsed = parseRemovalNote(rawNote);
      if (!parsed.ok) return { ok: false, error: parsed.error };

      const id = String(clientId ?? '');
      if (!deps.isConnected(id)) return { ok: false, error: 'That client is no longer connected.' };

      act(id, parsed.note);
      return { ok: true };
    };

    listen('admin:kick', (payload, ack) => {
      respond(ack, moderate(payload?.clientId, payload?.note, deps.kick));
    });

    listen('admin:ban', (payload, ack) => {
      respond(ack, moderate(payload?.clientId, payload?.note, deps.ban));
    });

    listen('admin:closeRoom', (payload, ack) => {
      const parsed = parseRemovalNote(payload?.note);
      if (!parsed.ok) {
        respond(ack, { ok: false, error: parsed.error });
        return;
      }
      const roomId = typeof payload?.roomId === 'string' ? payload.roomId : '';
      const closed = deps.closeRoom(roomId, parsed.note);
      respond(ack, closed ? { ok: true } : { ok: false, error: 'That room no longer exists.' });
    });

    listen('admin:watch', (payload) => {
      const watcher = watchers.get(socket.id);
      if (!watcher) return;
      watcher.roomId = typeof payload?.roomId === 'string' ? payload.roomId : null;
      // Every room starts with its mines hidden; showing them is a deliberate act.
      watcher.showMines = false;
      sendView(socket.id);
    });

    listen('admin:mines', (payload) => {
      const watcher = watchers.get(socket.id);
      if (!watcher) return;
      watcher.showMines = payload?.show === true;
      if (watcher.roomId) {
        log.add('admin', `${watcher.showMines ? 'showed' : 'hid'} the mines of ${watcher.roomId}`);
      }
      sendView(socket.id);
    });

    socket.on(
      'disconnect',
      contain(
        (reason: string) => {
          watchers.delete(socket.id);
          log.add('admin', `console closed (${reason})`);
        },
        (error) => console.error('[admin] disconnect cleanup failed:', error),
      ),
    );
  }, (error) => console.error('[admin] could not set up a console:', error)));

  return {
    pushState: () => adminIo.emit('admin:state', deps.state()),
    roomChanged,
    allRoomsChanged: () => {
      for (const watcher of watchers.values()) {
        if (watcher.roomId) roomChanged(watcher.roomId);
      }
    },
  };
}
