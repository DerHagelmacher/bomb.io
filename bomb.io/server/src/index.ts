import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

/* ---------- Typen ---------- */

type Player = {
  id: string;          // socket.id
  nickname: string;
  ready: boolean;
  x: number;
  y: number;
  alive: boolean;
  lastMoveAt: number;
  wins: number;
};

type Lobby = {
  id: string;
  ownerId: string;
  players: Record<string, Player>;
  maxPlayers: number;
  createdAt: number;
  started: boolean;
  endAt?: number;

  bombHolderId?: string | null;
  bombEndAt?: number | null;

  round: number;
  eliminationOrder: string[];
};

/* ---------- Konstante Spielfeldwerte ---------- */

const FIELD_WIDTH = 400;
const FIELD_HEIGHT = 300;

const MATCH_DURATION_MS = 2 * 60 * 1000;    // Sicherheitsende nach 2 Minuten
const BOMB_DURATION_MS = 15_000;            // 15 Sekunden Fixdauer pro Bombe
const BOMB_TOUCH_RADIUS = 20;               // Hitbox-Radius in Pixel
const AFK_THRESHOLD_MS = 3_000;             // ab 3s Stillstand gilt AFK

/* ---------- Speicher ---------- */

const lobbies = new Map<string, Lobby>();
const lobbyIntervals = new Map<string, NodeJS.Timeout>();

/* ---------- Helfer ---------- */

function makeLobbyId(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function alivePlayers(lobby: Lobby): Player[] {
  return Object.values(lobby.players).filter((p) => p.alive);
}

function lobbyToDTO(lobby: Lobby) {
  return {
    id: lobby.id,
    ownerId: lobby.ownerId,
    started: lobby.started,
    maxPlayers: lobby.maxPlayers,
    round: lobby.round,
    players: Object.values(lobby.players).map((p) => ({
      id: p.id,
      nickname: p.nickname,
      ready: p.ready,
      alive: p.alive,
      wins: p.wins,
    })),
  };
}

function sendLobby(io: Server, lobbyId: string) {
  const lobby = lobbies.get(lobbyId);
  if (!lobby) return;
  io.to(lobbyId).emit("lobby:update", lobbyToDTO(lobby));
}

function sendMatchState(io: Server, lobby: Lobby) {
  if (!lobby.started || !lobby.endAt) return;
  const remainingMs = Math.max(0, lobby.endAt - Date.now());

  const bomb =
    lobby.bombHolderId && lobby.bombEndAt
      ? {
          holderId: lobby.bombHolderId,
          remainingMs: Math.max(0, lobby.bombEndAt - Date.now()),
        }
      : undefined;

  io.to(lobby.id).emit("match:state", {
    lobbyId: lobby.id,
    remainingMs,
    players: alivePlayers(lobby).map((p) => ({
      id: p.id,
      nickname: p.nickname,
      x: p.x,
      y: p.y,
    })),
    bomb,
  });
}

function cleanupLobbyIfEmpty(lobbyId: string) {
  const lobby = lobbies.get(lobbyId);
  if (!lobby) return;
  if (Object.keys(lobby.players).length === 0) {
    console.log("[cleanup] Lobby geloescht:", lobbyId);
    const interval = lobbyIntervals.get(lobbyId);
    if (interval) {
      clearInterval(interval);
      lobbyIntervals.delete(lobbyId);
    }
    lobbies.delete(lobbyId);
  }
}

/**
 * Bombe ggf. weitergeben, wenn Bombentraeger einen anderen Spieler beruehrt.
 * WICHTIG: bombEndAt wird NICHT zurueckgesetzt – Timer laeuft weiter.
 */
function tryTransferBomb(lobby: Lobby, moverId: string) {
  if (!lobby.bombHolderId) return;
  if (lobby.bombHolderId !== moverId) return;

  const holder = lobby.players[moverId];
  if (!holder || !holder.alive) return;

  const others = alivePlayers(lobby).filter((p) => p.id !== moverId);

  for (const other of others) {
    const dx = other.x - holder.x;
    const dy = other.y - holder.y;
    const dist = Math.hypot(dx, dy);

    if (dist <= BOMB_TOUCH_RADIUS) {
      lobby.bombHolderId = other.id;
      console.log("[bomb] transfer", holder.nickname, "→", other.nickname);
      return;
    }
  }
}

/**
 * Explosion der Bombe: Spieler fliegt raus, ggf. neuer Bombentraeger oder Winner.
 */
function handleBombExplosion(
  io: Server,
  lobby: Lobby,
  now: number,
  interval: NodeJS.Timeout
) {
  const holderId = lobby.bombHolderId;
  if (!holderId) return;

  const loser = lobby.players[holderId];
  if (loser && loser.alive) {
    loser.alive = false;
    loser.ready = false;
    lobby.eliminationOrder.push(loser.id);

    io.to(lobby.id).emit("bomb:exploded", {
      lobbyId: lobby.id,
      loserId: loser.id,
      loserName: loser.nickname,
    });

    console.log("[bomb] exploded on:", loser.nickname);
  }

  const alive = alivePlayers(lobby);

  // Winner?
  if (alive.length <= 1) {
    lobby.started = false;

    const winner = alive[0] ?? null;
    if (winner) {
      winner.wins += 1;
    }

    const standingsIds: string[] = [];
    if (winner) standingsIds.push(winner.id);
    standingsIds.push(...lobby.eliminationOrder.slice().reverse());

    const standings = standingsIds.map((id, index) => {
      const p = lobby.players[id];
      return {
        id,
        nickname: p?.nickname ?? "???",
        place: index + 1,
        wins: p?.wins ?? 0,
      };
    });

    io.to(lobby.id).emit("match:ended", {
      lobbyId: lobby.id,
      reason: "winner",
      winnerId: winner?.id ?? null,
      winnerName: winner?.nickname ?? null,
      standings,
    });

    // ----- Auto-Reset fuer naechste Runde -----
    for (const p of Object.values(lobby.players)) {
      p.alive = true;
      p.ready = false;
      p.x = FIELD_WIDTH / 2;
      p.y = FIELD_HEIGHT / 2;
    }
    lobby.bombHolderId = null;
    lobby.bombEndAt = null;
    lobby.eliminationOrder = [];
    lobby.started = false;
    lobby.endAt = undefined;

    clearInterval(interval);
    lobbyIntervals.delete(lobby.id);
    sendLobby(io, lobby.id);
    return;
  }

  // Neue Bombe an zufaelligen lebenden Spieler, Timer neu 15s
  const next = alive[Math.floor(Math.random() * alive.length)];
  lobby.bombHolderId = next.id;
  lobby.bombEndAt = now + BOMB_DURATION_MS;

  console.log("[bomb] new holder after explosion:", next.nickname);

  sendMatchState(io, lobby);
}

/* ---------- Express + Socket.IO ---------- */

const app = express();
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "http://localhost:5173" },
});

/* ---------- Socket Events ---------- */

io.on("connection", (socket) => {
  console.log("Neuer Client:", socket.id);

  socket.onAny((event, ...args) => {
    console.log("[onAny]", socket.id, "event:", event, "data:", args);
  });

  // Lobby erstellen
  socket.on(
    "lobby:create",
    ({ nickname, maxPlayers = 4 }: { nickname: string; maxPlayers?: number }) => {
      if (!nickname || !nickname.trim()) {
        socket.emit("lobby:error", "Nickname noetig");
        return;
      }

      const id = makeLobbyId();
      const lobby: Lobby = {
        id,
        ownerId: socket.id,
        maxPlayers: Math.max(2, Math.min(8, Number(maxPlayers) || 4)),
        createdAt: Date.now(),
        started: false,
        players: {},
        round: 0,
        eliminationOrder: [],
      };

      lobbies.set(id, lobby);
      socket.join(id);

      lobby.players[socket.id] = {
        id: socket.id,
        nickname: nickname.trim(),
        ready: false,
        x: FIELD_WIDTH / 2,
        y: FIELD_HEIGHT / 2,
        alive: true,
        lastMoveAt: Date.now(),
        wins: 0,
      };

      socket.emit("lobby:created", { lobbyId: id });
      sendLobby(io, id);
    }
  );

  // Lobby beitreten
  socket.on(
    "lobby:join",
    ({ lobbyId, nickname }: { lobbyId: string; nickname: string }) => {
      const id = lobbyId?.toUpperCase();
      const lobby = lobbies.get(id);
      if (!lobby) return socket.emit("lobby:error", "Lobby nicht gefunden");
      if (lobby.started) return socket.emit("lobby:error", "Spiel bereits gestartet");
      if (Object.keys(lobby.players).length >= lobby.maxPlayers) {
        return socket.emit("lobby:error", "Lobby ist voll");
      }

      socket.join(lobby.id);
      const existing = lobby.players[socket.id];

      lobby.players[socket.id] = {
        id: socket.id,
        nickname: nickname?.trim() || existing?.nickname || "Player",
        ready: false,
        x: FIELD_WIDTH / 2,
        y: FIELD_HEIGHT / 2,
        alive: true,
        lastMoveAt: Date.now(),
        wins: existing?.wins ?? 0,
      };

      sendLobby(io, lobby.id);
    }
  );

  // Ready toggeln
  socket.on(
    "lobby:ready",
    ({ lobbyId, ready }: { lobbyId: string; ready: boolean }) => {
      const lobby = lobbies.get(lobbyId);
      if (!lobby) return;
      const p = lobby.players[socket.id];
      if (!p) return;
      p.ready = !!ready;
      sendLobby(io, lobby.id);
    }
  );

  // Lobby verlassen
  socket.on("lobby:leave", ({ lobbyId }: { lobbyId: string }) => {
    const lobby = lobbies.get(lobbyId);
    if (!lobby) return;
    const p = lobby.players[socket.id];
    if (!p) return;

    if (lobby.started && p.alive) {
      p.alive = false;
      lobby.eliminationOrder.push(p.id);
    }

    delete lobby.players[socket.id];
    socket.leave(lobbyId);

    if (lobby.ownerId === socket.id) {
      const next = Object.keys(lobby.players)[0];
      if (next) lobby.ownerId = next;
    }

    sendLobby(io, lobby.id);
    cleanupLobbyIfEmpty(lobby.id);
  });

  // Match starten
  socket.on("match:start", ({ lobbyId }: { lobbyId: string }) => {
    const lobby = lobbies.get(lobbyId);
    if (!lobby) return socket.emit("lobby:error", "Lobby nicht gefunden");
    if (lobby.ownerId !== socket.id) {
      return socket.emit("lobby:error", "Nur Host kann starten");
    }

    const playersArr = alivePlayers(lobby);
    const readyArr = playersArr.filter((p) => p.ready);

    if (readyArr.length < 2) {
      return socket.emit("lobby:error", "Mindestens 2 bereite Spieler noetig");
    }

    const centerX = FIELD_WIDTH / 2;
    const centerY = FIELD_HEIGHT / 2;
    const radius = 80;

    playersArr.forEach((p, index) => {
      const angle = (index / playersArr.length) * Math.PI * 2;
      p.x = centerX + Math.cos(angle) * radius;
      p.y = centerY + Math.sin(angle) * radius;
      p.alive = true;
      p.lastMoveAt = Date.now();
    });

    lobby.round += 1;
    lobby.started = true;
    lobby.endAt = Date.now() + MATCH_DURATION_MS;
    lobby.eliminationOrder = [];

    // Zufaelliger erster Bombentraeger
    const randomIndex = Math.floor(Math.random() * playersArr.length);
    lobby.bombHolderId = playersArr[randomIndex].id;
    lobby.bombEndAt = Date.now() + BOMB_DURATION_MS;

    io.to(lobby.id).emit("match:started", {
      lobbyId: lobby.id,
      t: Date.now(),
      durationMs: MATCH_DURATION_MS,
      round: lobby.round,
    });

    const oldInterval = lobbyIntervals.get(lobby.id);
    if (oldInterval) clearInterval(oldInterval);

    const interval = setInterval(() => {
      const currentLobby = lobbies.get(lobby.id);
      if (!currentLobby || !currentLobby.started || !currentLobby.endAt) {
        clearInterval(interval);
        lobbyIntervals.delete(lobby.id);
        return;
      }

      const now = Date.now();
      const remaining = currentLobby.endAt - now;

      if (remaining <= 0) {
        currentLobby.started = false;
        sendMatchState(io, currentLobby);
        io.to(currentLobby.id).emit("match:ended", {
          lobbyId: currentLobby.id,
          reason: "time",
        });

        // Auto-Reset auch bei Zeitablauf
        for (const p of Object.values(currentLobby.players)) {
          p.alive = true;
          p.ready = false;
          p.x = FIELD_WIDTH / 2;
          p.y = FIELD_HEIGHT / 2;
        }
        currentLobby.bombHolderId = null;
        currentLobby.bombEndAt = null;
        currentLobby.eliminationOrder = [];
        currentLobby.started = false;
        currentLobby.endAt = undefined;

        clearInterval(interval);
        lobbyIntervals.delete(currentLobby.id);
        sendLobby(io, currentLobby.id);
        return;
      }

      if (currentLobby.bombHolderId && currentLobby.bombEndAt) {
        const holder = currentLobby.players[currentLobby.bombHolderId];
        let bombRemaining = currentLobby.bombEndAt - now;

        if (holder && holder.alive) {
          const idleMs = now - holder.lastMoveAt;
          if (idleMs > AFK_THRESHOLD_MS) {
            // AFK → Bombe tickt schneller (einfacher Speedup)
            bombRemaining -= 1000;
          }
        }

        if (bombRemaining <= 0) {
          handleBombExplosion(io, currentLobby, now, interval);
          return;
        }
      }

      sendMatchState(io, currentLobby);
    }, 1000);

    lobbyIntervals.set(lobby.id, interval);
    sendMatchState(io, lobby);
    sendLobby(io, lobby.id);
  });

  // Spieler-Bewegung
  socket.on(
    "player:move",
    ({ lobbyId, dx, dy }: { lobbyId: string; dx: number; dy: number }) => {
      const lobby = lobbies.get(lobbyId);
      if (!lobby || !lobby.started) return;
      const p = lobby.players[socket.id];
      if (!p || !p.alive) return;

      p.x += dx;
      p.y += dy;
      p.lastMoveAt = Date.now();

      p.x = Math.max(0, Math.min(FIELD_WIDTH, p.x));
      p.y = Math.max(0, Math.min(FIELD_HEIGHT, p.y));

      tryTransferBomb(lobby, socket.id);
      sendMatchState(io, lobby);
    }
  );

  // Disconnect
  socket.on("disconnect", () => {
    console.log("Client weg:", socket.id);

    for (const lobby of lobbies.values()) {
      if (lobby.players[socket.id]) {
        const wasOwner = lobby.ownerId === socket.id;
        const p = lobby.players[socket.id];

        if (lobby.started && p.alive) {
          p.alive = false;
          lobby.eliminationOrder.push(p.id);
        }

        delete lobby.players[socket.id];

        if (wasOwner) {
          const next = Object.keys(lobby.players)[0];
          if (next) lobby.ownerId = next;
        }

        sendLobby(io, lobby.id);
        cleanupLobbyIfEmpty(lobby.id);
      }
    }
  });
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Server laeuft auf Port ${PORT}`);
});
