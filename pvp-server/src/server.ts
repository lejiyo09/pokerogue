import { WebSocketServer } from "ws";
import { attachConnection } from "./app.js";

// `PORT` is assigned by the hosting platform (e.g. Render) in production; `0.0.0.0` is required
// there so the service is reachable from outside its container - binding to the default loopback
// address would make it unreachable. Both stay equally correct for local development (`ws://localhost:8081`
// is still reachable through `0.0.0.0`).
const PORT = Number(process.env.PORT ?? 8081);
const HOST = "0.0.0.0";

const wss = new WebSocketServer({ host: HOST, port: PORT });

wss.on("connection", attachConnection);

console.log(`PokéRogue PvP server listening on ws://${HOST}:${PORT} (ws://localhost:${PORT} locally)`);
