export type TPlayer = { id: string; x: number; y: number; alive: boolean };

export function makeLobbyId(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export function alivePlayers(lobby: { players: Record<string, TPlayer> }) {
  return Object.values(lobby.players).filter((p) => p.alive);
}

export function tryTransferBomb(
  lobby: { bombHolderId: string | null; players: Record<string, TPlayer> },
  moverId: string
) {
  if (!lobby.bombHolderId) return;
  if (lobby.bombHolderId !== moverId) return;

  const holder = lobby.players[moverId];
  if (!holder || !holder.alive) return;

  const others = Object.values(lobby.players).filter((p) => p.id !== moverId);

  for (const other of others) { 
    const dx = other.x - holder.x;
    const dy = other.y - holder.y;
    const dist = Math.hypot(dx, dy);

    if (dist <= 20) {
      lobby.bombHolderId = other.id;
      return;
    }
  }
}
