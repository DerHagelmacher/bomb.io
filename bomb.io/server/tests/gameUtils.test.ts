import { makeLobbyId, alivePlayers, tryTransferBomb, TPlayer } from "../src/utils/gameUtils";

test("makeLobbyId returns 6 uppercase characters", () => {
  const id = makeLobbyId();
  expect(id).toHaveLength(6);
  expect(id).toMatch(/^[A-Z0-9]+$/);
});

test("alivePlayers returns only alive players", () => {
  const lobby: { players: Record<string, TPlayer> } = {
    players: {
      a: { id: "a", x: 0, y: 0, alive: true },
      b: { id: "b", x: 10, y: 0, alive: false },
      c: { id: "c", x: 0, y: 0, alive: true },
    },
  };

  const result = alivePlayers(lobby);

  expect(result.length).toBe(2);
  expect(result.map((p) => p.id)).toContain("a");
  expect(result.map((p) => p.id)).toContain("c");
});

test("tryTransferBomb transfers bomb when within radius", () => {
  // Arrange
  const lobby: {
    bombHolderId: string | null;
    players: Record<string, TPlayer>;
  } = {
    bombHolderId: "a",
    players: {
      a: { id: "a", x: 0, y: 0, alive: true },
      b: { id: "b", x: 10, y: 0, alive: true },
    }
  };

  tryTransferBomb(lobby, "a");

  expect(lobby.bombHolderId).toBe("b");
});

test("tryTransferBomb does NOT transfer bomb when players are outside radius", () => {
  const lobby: {
    bombHolderId: string | null;
    players: Record<string, TPlayer>;
  } = {
    bombHolderId: "a",
    players: {
      a: { id: "a", x: 0, y: 0, alive: true },
      b: { id: "b", x: 50, y: 0, alive: true },
    }
  };

  tryTransferBomb(lobby, "a");

  expect(lobby.bombHolderId).toBe("a");
});

test("tryTransferBomb does nothing when bomb holder is dead", () => {
  const lobby: {
    bombHolderId: string | null;
    players: Record<string, TPlayer>;
  } = {
    bombHolderId: "a",
    players: {
      a: { id: "a", x: 0, y: 0, alive: false },
      b: { id: "b", x: 5, y: 0, alive: true },
    }
  };

  tryTransferBomb(lobby, "a");

  expect(lobby.bombHolderId).toBe("a");
});

test("alivePlayers returns empty array when no players are alive", () => {
  const lobby: { players: Record<string, TPlayer> } = {
    players: {
      a: { id: "a", x: 0, y: 0, alive: false },
      b: { id: "b", x: 10, y: 0, alive: false },
    }
  };

  const result = alivePlayers(lobby);

  expect(result.length).toBe(0);
});
