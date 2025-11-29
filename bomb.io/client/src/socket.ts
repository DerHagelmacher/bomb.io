import { io } from "socket.io-client";

const baseUrl = import.meta.env.DEV
  ? "http://localhost:3001"              // Dev → direkt Backend
  : "https://bombio.notascam.ch";        // Produktion → Domain, kein Port

export const socket = io(baseUrl, {
  transports: ["websocket"],             // verhindert Polling-Probleme bei TLS
  path: "/socket.io/",                   // wichtig: Caddy forwardet genau diesen Pfad
  withCredentials: false,
});
