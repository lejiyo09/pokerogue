import { WebSocketServer } from "ws";
import { attachConnection } from "./app.js";

const PORT = Number(process.env.PORT ?? 8081);

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", attachConnection);

console.log(`PokéRogue PvP server listening on ws://localhost:${PORT}`);
