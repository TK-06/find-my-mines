import type { ChatMessage, LobbyMessage, ModerationResult, PlayerPublic, RoomSummary } from '@fmm/shared';
import { useEffect, useState } from 'react';
import { badgeText, unreadCount } from '../data/layout.js';
import { RoomChat } from './RoomChat.js';
import { Sheet } from './Sheet.js';
import { WorldChat } from './WorldChat.js';

interface WorldProps {
  messages: LobbyMessage[];
  rooms: RoomSummary[];
  connected: boolean;
  myId: string | null;
  onSay: (text: string) => Promise<ModerationResult>;
  onJoin: (roomId: string) => void;
}

interface RoomProps {
  /** Which room, so a new room starts with nothing unread. */
  roomId: string;
  messages: ChatMessage[];
  players: PlayerPublic[];
  connected: boolean;
  onSay: (text: string) => Promise<ModerationResult>;
}

interface Props {
  world: WorldProps;
  /**
   * The room's chat as a second tab. Only on a phone, where the game screen
   * has no room for the chat card; elsewhere the card stays beside the board.
   */
  room: RoomProps | null;
}

type Tab = 'room' | 'world';

/** The newest line's time, or 0. */
const newest = (messages: readonly { at: number }[]) => messages[messages.length - 1]?.at ?? 0;

/**
 * The chat button in the bottom-right corner of every page. It opens the world
 * chat — and, in a room on a phone, the room's chat on a tab of its own — as a
 * sheet from the bottom of the screen (a corner panel on a desktop).
 *
 * The badge counts lines from other people since you last had that tab open.
 * Lines older than the page count as read: a returning player is not greeted
 * by a badge for the history the server sends on arrival.
 */
export function ChatDock({ world, room }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>(room ? 'room' : 'world');
  const [worldSeen, setWorldSeen] = useState(() => Date.now());
  const [roomSeen, setRoomSeen] = useState(() => Date.now());

  const roomId = room?.roomId ?? null;

  // A new room: nothing in it has been read yet, and it is what you want to see.
  useEffect(() => {
    setRoomSeen(Date.now());
    setTab(roomId ? 'room' : 'world');
  }, [roomId]);

  // Whatever is on screen is read, including lines that land while it is open.
  useEffect(() => {
    if (!open) return;
    if (tab === 'world') setWorldSeen((seen) => Math.max(seen, Date.now(), newest(world.messages)));
    else if (room) setRoomSeen((seen) => Math.max(seen, Date.now(), newest(room.messages)));
  }, [open, tab, world.messages, room]);

  const worldUnread = unreadCount(world.messages, worldSeen, world.myId);
  const roomUnread = room ? unreadCount(room.messages, roomSeen, world.myId) : 0;
  const total = worldUnread + roomUnread;
  const badge = badgeText(total);
  const showing: Tab = room ? tab : 'world';

  const tabs = room ? (
    <div className="sheet-tabs" role="tablist" aria-label="Chats">
      {(['room', 'world'] as const).map((which) => {
        const unread = which === 'room' ? roomUnread : worldUnread;
        return (
          <button
            key={which}
            type="button"
            role="tab"
            aria-selected={showing === which}
            className={`sheet-tab${showing === which ? ' active' : ''}`}
            onClick={() => setTab(which)}
          >
            {which === 'room' ? 'Room' : 'World'}
            {showing !== which && unread > 0 && <span className="sheet-tab-count">{badgeText(unread)}</span>}
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <>
      {!open && (
        <button
          type="button"
          className="chat-fab"
          aria-label={badge ? `Chat, ${total} unread` : 'Chat'}
          onClick={() => setOpen(true)}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 5h16v11H9l-5 4z" />
          </svg>
          {badge && (
            <span className="chat-fab-badge" aria-hidden="true">
              {badge}
            </span>
          )}
        </button>
      )}

      {open && (
        <Sheet
          title={room ? 'Chat' : 'World chat'}
          className="chat-sheet"
          headExtra={tabs}
          onClose={() => setOpen(false)}
        >
          {showing === 'room' && room ? (
            <RoomChat
              key={room.roomId}
              embedded
              messages={room.messages}
              players={room.players}
              connected={room.connected}
              onSay={room.onSay}
            />
          ) : (
            <WorldChat
              embedded
              messages={world.messages}
              rooms={world.rooms}
              connected={world.connected}
              myId={world.myId}
              onSay={world.onSay}
              onJoin={(roomId) => {
                setOpen(false);
                world.onJoin(roomId);
              }}
            />
          )}
        </Sheet>
      )}
    </>
  );
}
