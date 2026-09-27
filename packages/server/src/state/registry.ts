import type { ClientInfo, Seat } from '@fmm/shared';

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
      nickname: '(joining…)',
      seat: 'spectator',
      connectedAt: Date.now(),
      address,
      roomId: null,
      isGuest: true,
    });
  }

  remove(id: string): void {
    this.clients.delete(id);
  }

  /** Set once the server has resolved who the client is. */
  setIdentity(id: string, nickname: string, isGuest: boolean): void {
    const client = this.clients.get(id);
    if (!client) return;
    client.nickname = nickname;
    client.isGuest = isGuest;
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
}
