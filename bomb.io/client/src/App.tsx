import { useEffect, useMemo, useRef, useState } from "react";
import { socket } from "./socket";

type PlayerDTO = { id: string; nickname: string; ready: boolean };
type LobbyDTO = {
  id: string;
  ownerId: string;
  started: boolean;
  maxPlayers: number;
  players: PlayerDTO[];
};

type MatchPlayer = { id: string; nickname: string; x: number; y: number };
type MatchState = {
  lobbyId: string;
  remainingMs: number;
  players: MatchPlayer[];
};

const MOVE_SPEED = 0.35; // gerne anpassen

export default function App() {
  const [nickname, setNickname] = useState("");
  const [lobbyId, setLobbyId] = useState("");
  const [lobby, setLobby] = useState<LobbyDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [matchState, setMatchState] = useState<MatchState | null>(null);


  // Refs fuer Bewegung
  const pressedKeysRef = useRef<Set<string>>(new Set());
  const lobbyIdRef = useRef<string | null>(null);
  // immer aktuelle LobbyId im Ref halten (fuer Bewegung)
  useEffect(() => {
    lobbyIdRef.current = lobby?.id ?? null;
  }, [lobby?.id]);


  useEffect(() => {
    const onConnect = () => console.log("Verbunden:", socket.id);
    const onLobbyCreated = ({ lobbyId }: { lobbyId: string }) => setLobbyId(lobbyId);
    const onLobbyUpdate = (data: LobbyDTO) => {
      setLobby(data);
      setError(null);
    };
    const onLobbyError = (msg: string) => setError(msg);

    const onMatchStarted = (data: { lobbyId: string; t: number; durationMs: number }) => {
      console.log("match:started", data);
      // eigentlicher Zustand kommt dann mit match:state
    };

    const onMatchState = (state: MatchState) => {
      setMatchState(state);
    };

    const onMatchEnded = ({ lobbyId }: { lobbyId: string }) => {
      console.log("match:ended", lobbyId);
      alert("Match zu Ende");
      setMatchState(null);
    };

    socket.on("connect", onConnect);
    socket.on("lobby:created", onLobbyCreated);
    socket.on("lobby:update", onLobbyUpdate);
    socket.on("lobby:error", onLobbyError);
    socket.on("match:started", onMatchStarted);
    socket.on("match:state", onMatchState);
    socket.on("match:ended", onMatchEnded);

    return () => {
      socket.off("connect", onConnect);
      socket.off("lobby:created", onLobbyCreated);
      socket.off("lobby:update", onLobbyUpdate);
      socket.off("lobby:error", onLobbyError);
      socket.off("match:started", onMatchStarted);
      socket.off("match:state", onMatchState);
      socket.off("match:ended", onMatchEnded);
    };
  }, []);

  const isOwner = useMemo(() => lobby?.ownerId === socket.id, [lobby]);
  const me = useMemo(
    () => lobby?.players.find((p) => p.id === socket.id) || null,
    [lobby]
  );

  const inMatch = !!(lobby && lobby.started && matchState);

    // Pfeiltasten fuer kontinuierliche Bewegung (mit Diagonalen)
  useEffect(() => {
    if (!inMatch) {
      // wenn kein Match, alle Tasten loeschen
      pressedKeysRef.current.clear();
      return;
    }

    const keys = pressedKeysRef.current;
    let lastTime = 0;
    let animId: number;

    function onKeyDown(e: KeyboardEvent) {
      if (
        e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight"
      ) {
        e.preventDefault();
        keys.add(e.key);
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      if (
        e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight"
      ) {
        e.preventDefault();
        keys.delete(e.key);
      }
    }

    function loop(now: number) {
      if (!lastTime) lastTime = now;
      const dt = now - lastTime;
      lastTime = now;

      const lobbyId = lobbyIdRef.current;
      if (lobbyId && keys.size > 0) {
        let vx = 0;
        let vy = 0;

        if (keys.has("ArrowUp")) vy -= 1;
        if (keys.has("ArrowDown")) vy += 1;
        if (keys.has("ArrowLeft")) vx -= 1;
        if (keys.has("ArrowRight")) vx += 1;

        const len = Math.hypot(vx, vy);
        if (len > 0) {
          vx /= len;
          vy /= len;

          const dx = vx * MOVE_SPEED * dt;
          const dy = vy * MOVE_SPEED * dt;

          socket.emit("player:move", { lobbyId, dx, dy });
        }
      }

      animId = requestAnimationFrame(loop);
    }

    animId = requestAnimationFrame(loop);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      if (animId) cancelAnimationFrame(animId);
    };
  }, [inMatch]);



  function createLobby() {
    if (!nickname) return setError("Bitte Nickname eingeben");
    socket.emit("lobby:create", { nickname, maxPlayers: 4 });
  }
  function joinLobby() {
    if (!nickname || !lobbyId) return setError("Lobby-ID und Nickname noetig");
    socket.emit("lobby:join", { lobbyId: lobbyId.toUpperCase(), nickname });
  }
  function toggleReady() {
    if (!lobby) return;
    socket.emit("lobby:ready", { lobbyId: lobby.id, ready: !(me?.ready ?? false) });
  }
  function leaveLobby() {
    if (!lobby) return;
    socket.emit("lobby:leave", { lobbyId: lobby.id });
    setLobby(null);
    setMatchState(null);
  }
  function startMatch() {
    if (!lobby) return;
    socket.emit("match:start", { lobbyId: lobby.id });
  }

  return (
    <div style={{ padding: 24, fontFamily: "Inter, system-ui", maxWidth: 640 }}>
      <h1>Bomb.io – Lobby und Match</h1>

      {!inMatch && !lobby && (
        <section style={{ display: "grid", gap: 8, marginBottom: 16 }}>
          <input
            placeholder="Nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={createLobby}>Lobby erstellen</button>
            <input
              placeholder="Lobby-ID (z. B. A1B2C3)"
              value={lobbyId}
              onChange={(e) => setLobbyId(e.target.value.toUpperCase())}
              style={{ flex: 1 }}
            />
            <button onClick={joinLobby}>Beitreten</button>
          </div>
          {error && <div style={{ color: "crimson" }}>{error}</div>}
        </section>
      )}

      {!inMatch && lobby && (
        <section style={{ display: "grid", gap: 12, marginBottom: 24 }}>
          <div>
            <strong>Lobby:</strong> {lobby.id}{" "}
            <button onClick={() => navigator.clipboard.writeText(lobby.id)}>kopieren</button>
          </div>
          <div>
            <strong>Status:</strong> {lobby.started ? "Gestartet" : "Warten"}
          </div>
          <div>
            <strong>Owner:</strong> {lobby.ownerId === socket.id ? "Du" : lobby.ownerId}
          </div>
          <div>
            <strong>Spieler</strong> ({lobby.players.length}/{lobby.maxPlayers})
            <ul>
              {lobby.players.map((p) => (
                <li key={p.id}>
                  {p.nickname} {p.id === lobby.ownerId ? "👑" : ""}{" "}
                  {p.id === socket.id ? "(Du)" : ""} –{" "}
                  {p.ready ? "bereit" : "nicht bereit"}
                </li>
              ))}
            </ul>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={toggleReady}>
              {me?.ready ? "Nicht bereit" : "Bereit"}
            </button>
            <button onClick={leaveLobby}>Lobby verlassen</button>
            <button onClick={startMatch} disabled={!isOwner}>
              Match starten {isOwner ? "" : "(nur Owner)"}
            </button>
          </div>

          {error && <div style={{ color: "crimson" }}>{error}</div>}
        </section>
      )}

      {inMatch && matchState && (
        <MatchView state={matchState} />
      )}
    </div>
  );
}

/* ---------- einfache Spielfeld-Ansicht ---------- */
function MatchView({ state }: { state: MatchState }) {
  const width = 400;
  const height = 300;

  const secondsLeft = Math.ceil(state.remainingMs / 1000);

  return (
    <section style={{ display: "grid", gap: 8 }}>
      <div>
        <strong>Match in Lobby:</strong> {state.lobbyId}
      </div>
      <div>
        <strong>Restzeit:</strong> {secondsLeft} s
      </div>
      <div
        style={{
          position: "relative",
          width,
          height,
          border: "2px solid #333",
          background: "#111",
        }}
      >
        {state.players.map((p) => (
          <div
            key={p.id}
            title={p.nickname}
            style={{
              position: "absolute",
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: p.id === socket.id ? "#0f0" : "#f00",
              transform: "translate(-50%, -50%)",
              left: p.x,
              top: p.y,
            }}
          />
        ))}
      </div>
      <div>Bewege dich mit den Pfeiltasten.</div>
    </section>
  );
}
