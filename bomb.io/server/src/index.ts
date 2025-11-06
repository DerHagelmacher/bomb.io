import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

io.on("connection", (socket) => {
  console.log("Neuer Client:", socket.id);
  socket.on("disconnect", () => console.log("Client weg:", socket.id));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server läuft auf :${PORT}`));
