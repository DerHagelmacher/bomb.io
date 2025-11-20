import { io } from "socket.io-client";

const baseUrl =
  import.meta.env.DEV
    ? "http://localhost:3001"      // Entwicklung
    : window.location.origin;      // Produktion: https://bombio.notascam.ch

export const socket = io(baseUrl);
