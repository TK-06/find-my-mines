import type { ClientInfo, OnlinePlayer, Seat } from '@fmm/shared';

const UNNAMED = '(joining…)';

/**
 * Every currently-connected game client.
 *
 * Backs two assignment requirements:
 *   - "The server program must display the number of concurrent clients
 *      currently connected and a list of those connected clients."
 *   - "the server will provide information about the other connected client."
 */
export class ClientRegistry {
  private readonly clients = new Map<string, ClientInfo>();

  add(id: string, address: string): void {
    this.clients.set(id, {
      id,
      nickname: UNNAMED,
      seat: 'spectator',
      connectedAt: Date.now(),
      address,
      roomId: null,
    });
  }

  remove(id: string): void {
    this.clients.delete(id);
  }

  setNickname(id: string, nickname: string): void {
    const client = this.clients.get(id);
    if (client) client.nickname = nickname;
  }

  setSeat(id: string, seat: Seat): void {
    const client = this.clients.get(id);
    if (client) client.seat = seat;
  }

  /** null while the client is on the landing page. */
  setRoom(id: string, roomId: string | null): void {
    const client = this.clients.get(id);
    if (client) client.roomId = roomId;
  }

  get(id: string): ClientInfo | undefined {
    return this.clients.get(id);
  }

  get count(): number {
    return this.clients.size;
  }

  list(): ClientInfo[] {
    return [...this.clients.values()].sort((a, b) => a.connectedAt - b.connectedAt);
  }

  /**
   * Who is online, as sent to game clients: named players only (a socket that
   * has not picked a nickname yet is not someone you can play), and no
   * addresses — those are admin-only.
   */
  roster(): OnlinePlayer[] {
    return this.list()
      .filter((client) => client.nickname !== UNNAMED)
      .map(({ id, nickname, roomId, seat }) => ({ id, nickname, roomId, seat }));
  }
}
