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
};

type Lobby = {
  id: string;          // z.B. "A1B2C3"
  ownerId: string;     // socket.id des Lobby-Owners
  players: Record<string, Player>;
  maxPlayers: number;
  createdAt: number;
  started: boolean;
  endAt?: number;
};

/* ---------- Konstante Spielfeldwerte ---------- */
const FIELD_WIDTH = 400;
const FIELD_HEIGHT = 300;
const MOVE_SPEED = 0.25; // optional, kann auf Client-Seite genutzt werden, hier aber nicht noetig
const MATCH_DURATION_MS = 2 * 60 * 1000;


/* ---------- Speicher ---------- */
const lobbies = new Map<string, Lobby>();
const lobbyIntervals = new Map<string, NodeJS.Timeout>();


const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://bombio.notascam.ch",
];
/* ---------- Helfer ---------- */
function makeLobbyId(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function lobbyToDTO(lobby: Lobby) {
  return {
    id: lobby.id,
    ownerId: lobby.ownerId,
    started: lobby.started,
    maxPlayers: lobby.maxPlayers,
    players: Object.values(lobby.players).map((p) => ({
      id: p.id,
      nickname: p.nickname,
      ready: p.ready,
    })),
  };
}

function sendMatchState(io: Server, lobby: Lobby) {
  if (!lobby.started || !lobby.endAt) return;
  const remainingMs = Math.max(0, lobby.endAt - Date.now());
  io.to(lobby.id).emit("match:state", {
    lobbyId: lobby.id,
    remainingMs,
    players: Object.values(lobby.players).map((p) => ({
      id: p.id,
      nickname: p.nickname,
      x: p.x,
      y: p.y,
    })),
  });
}

function broadcastLobby(io: Server, lobbyId: string) {
  const lobby = lobbies.get(lobbyId);
  if (!lobby) return;
  io.to(lobbyId).emit("lobby:update", lobbyToDTO(lobby));
}

function cleanupLobbyIfEmpty(lobbyId: string) {
  const lobby = lobbies.get(lobbyId);
  if (!lobby) return;
  if (Object.keys(lobby.players).length === 0) {
    console.log("[cleanup] Lobby geloescht:", lobbyId);
    // Timer fuer Match stoppen, falls vorhanden
    const interval = lobbyIntervals.get(lobbyId);
    if (interval) {
      clearInterval(interval);
      lobbyIntervals.delete(lobbyId);
    }
    lobbies.delete(lobbyId);
  }
}

/* ---------- Express + Socket.IO ---------- */
const app = express();

app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
app.use(
  cors({
    origin: allowedOrigins,
  })
);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
  },
});

/* ---------- Socket Events ---------- */
io.on("connection", (socket) => {
  console.log("Neuer Client:", socket.id);

  socket.onAny((event, ...args) => {

  });

  // 1) Lobby erstellen
  socket.on(
    "lobby:create",
    ({ nickname, maxPlayers = 4 }: { nickname: string; maxPlayers?: number }) => {
      console.log("[lobby:create] payload:", { nickname, maxPlayers });

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
      };

      lobbies.set(id, lobby);
      socket.join(id);
      lobby.players[socket.id] = {
        id: socket.id,
        nickname: nickname.trim(),
        ready: false,
        x: FIELD_WIDTH / 2,
        y: FIELD_HEIGHT / 2,
      };

      console.log("[lobby:create][OK] lobbyId =", id);

      socket.emit("lobby:created", { lobbyId: id });
      socket.emit("lobby:update", lobbyToDTO(lobby));
    }
  );

  // 2) Lobby beitreten
  socket.on(
    "lobby:join",
    ({ lobbyId, nickname }: { lobbyId: string; nickname: string }) => {
      const id = lobbyId?.toUpperCase();
      const lobby = lobbies.get(id);
      console.log("[lobby:join]", { lobbyId: id, nickname });

      if (!lobby) return socket.emit("lobby:error", "Lobby nicht gefunden");
      if (lobby.started)
        return socket.emit("lobby:error", "Spiel bereits gestartet");
      if (Object.keys(lobby.players).length >= lobby.maxPlayers) {
        return socket.emit("lobby:error", "Lobby ist voll");
      }

      socket.join(lobby.id);
      lobby.players[socket.id] = {
        id: socket.id,
        nickname: nickname || "Player",
        ready: false,
        x: FIELD_WIDTH / 2,
        y: FIELD_HEIGHT / 2,
      };

      broadcastLobby(io, lobby.id);
    }
  );

  // 3) Ready toggeln
  socket.on(
    "lobby:ready",
    ({ lobbyId, ready }: { lobbyId: string; ready: boolean }) => {
      const lobby = lobbies.get(lobbyId);
      if (!lobby) return;
      const p = lobby.players[socket.id];
      if (!p) return;
      p.ready = !!ready;
      broadcastLobby(io, lobby.id);
    }
  );

  // 4) Lobby verlassen
  socket.on("lobby:leave", ({ lobbyId }: { lobbyId: string }) => {
    const lobby = lobbies.get(lobbyId);
    if (!lobby) return;
    delete lobby.players[socket.id];
    socket.leave(lobbyId);

    if (lobby.ownerId === socket.id) {
      const next = Object.keys(lobby.players)[0];
      if (next) lobby.ownerId = next;
    }

    broadcastLobby(io, lobby.id);
    cleanupLobbyIfEmpty(lobby.id);
  });

  // 5) Match starten (2 Minuten)
  socket.on("match:start", ({ lobbyId }: { lobbyId: string }) => {
    const lobby = lobbies.get(lobbyId);
    if (!lobby) return socket.emit("lobby:error", "Lobby nicht gefunden");
    if (lobby.ownerId !== socket.id)
      return socket.emit("lobby:error", "Nur Owner kann starten");

    const playersArr = Object.values(lobby.players);
    const allReady =
      playersArr.length >= 2 && playersArr.every((p) => p.ready);

    if (!allReady) {
      return socket.emit(
        "lobby:error",
        "Nicht alle bereit (mind. 2 Spieler muessen bereit sein)"
      );
    }

    // Startpositionen verteilen (Kreisfoermig)
    const centerX = FIELD_WIDTH / 2;
    const centerY = FIELD_HEIGHT / 2;
    const radius = 80;
    playersArr.forEach((p, index) => {
      const angle = (index / playersArr.length) * Math.PI * 2;
      p.x = centerX + Math.cos(angle) * radius;
      p.y = centerY + Math.sin(angle) * radius;
    });

    lobby.started = true;
    lobby.endAt = Date.now() + MATCH_DURATION_MS;

    io.to(lobby.id).emit("match:started", {
      lobbyId: lobby.id,
      t: Date.now(),
      durationMs: MATCH_DURATION_MS,
    });

    // alten Timer stoppen falls vorhanden
    const oldInterval = lobbyIntervals.get(lobby.id);
    if (oldInterval) {
      clearInterval(oldInterval);
    }

    // neuer Timer: jede Sekunde Match-Status senden
    const interval = setInterval(() => {
      const currentLobby = lobbies.get(lobby.id);
      if (!currentLobby || !currentLobby.started || !currentLobby.endAt) {
        clearInterval(interval);
        lobbyIntervals.delete(lobby.id);
        return;
      }
      const remaining = currentLobby.endAt - Date.now();
      if (remaining <= 0) {
        currentLobby.started = false;
        sendMatchState(io, currentLobby);
        io.to(currentLobby.id).emit("match:ended", {
          lobbyId: currentLobby.id,
        });
        clearInterval(interval);
        lobbyIntervals.delete(currentLobby.id);
        return;
      }
      sendMatchState(io, currentLobby);
    }, 1000);

    lobbyIntervals.set(lobby.id, interval);
    // erste State Nachricht sofort
    sendMatchState(io, lobby);
    broadcastLobby(io, lobby.id);
  });

  // 6) Bewegung des Spielers
    // 6) Bewegung des Spielers (kontinuierlich, dx/dy vom Client)
  socket.on(
  "player:move",
  ({ lobbyId, dx, dy }: { lobbyId: string; dx: number; dy: number }) => {
    const lobby = lobbies.get(lobbyId);
    if (!lobby || !lobby.started) return;
    const p = lobby.players[socket.id];
    if (!p) return;

    p.x += dx;
    p.y += dy;

    p.x = Math.max(0, Math.min(FIELD_WIDTH, p.x));
    p.y = Math.max(0, Math.min(FIELD_HEIGHT, p.y));

    sendMatchState(io, lobby);
  }
);



  // 7) Disconnect
  socket.on("disconnect", () => {
    console.log("Client weg:", socket.id);
    for (const lobby of lobbies.values()) {
      if (lobby.players[socket.id]) {
        delete lobby.players[socket.id];
        if (lobby.ownerId === socket.id) {
          const next = Object.keys(lobby.players)[0];
          if (next) lobby.ownerId = next;
        }
        broadcastLobby(io, lobby.id);
        cleanupLobbyIfEmpty(lobby.id);
      }
    }
  });
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Server laeuft auf Port ${PORT}`);
});
