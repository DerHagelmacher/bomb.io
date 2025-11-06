import { useEffect } from "react";
import { socket } from "./socket";

export default function App() {
  useEffect(() => {
    socket.on("connect", () => console.log("Verbunden:", socket.id));
    socket.on("disconnect", () => console.log("Getrennt"));
  }, []);

  return <h1>💣 Bomb.io läuft!</h1>;
}
