// Деберц — онлайн-сервер кімнат.
// Роздає статичні файли гри (index.html) і WebSocket для синхронізації кімнат.
// Запуск: cd server && npm install && npm start   →  http://localhost:8080

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT) || 8080;
const ROOT = path.resolve(__dirname, "..");
const MAX_STATE_BYTES = 512 * 1024;
const EMPTY_ROOM_TTL_MS = 30 * 60 * 1000; // порожня кімната живе 30 хв (можна перепідключитися)
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // без схожих символів (I, L, O, 0, 1)
const CODE_LENGTH = 6;

/** code -> room */
const rooms = new Map();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function makeCode() {
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = "";
    const bytes = crypto.randomBytes(CODE_LENGTH);
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    if (!rooms.has(code)) return code;
  }
  throw new Error("Не вдалося згенерувати код кімнати");
}

function cleanName(value, fallback) {
  const s = String(value || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 24);
  return s || fallback;
}

function roomInfo(room) {
  return {
    code: room.code,
    name: room.name,
    isPublic: room.isPublic,
    hostName: room.hostName,
    memberCount: room.members.size,
    hasGame: !!room.state,
    createdAt: room.createdAt,
  };
}

function membersOf(room) {
  return [...room.members.entries()].map(([id, m]) => ({ id, name: m.name, host: id === room.hostId }));
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg, exceptId) {
  for (const [id, m] of room.members) {
    if (id !== exceptId) send(m.ws, msg);
  }
}

function broadcastMembers(room) {
  broadcast(room, { type: "members", hostId: room.hostId, members: membersOf(room) });
}

function detach(ws) {
  const code = ws.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  ws.roomCode = null;
  if (!room) return;
  const cid = ws.clientId;
  const member = room.members.get(cid);
  if (member && member.ws === ws) {
    room.members.delete(cid);
    if (room.members.size === 0) {
      room.emptyAt = Date.now();
    } else {
      if (room.hostId === cid) {
        // Хост вийшов — хостом стає найстаріший учасник.
        room.hostId = room.members.keys().next().value;
        room.hostName = room.members.get(room.hostId).name;
      }
      broadcastMembers(room);
    }
  }
}

function joinRoom(ws, room, name) {
  const existing = room.members.get(ws.clientId);
  if (existing && existing.ws !== ws) {
    // Той самий пристрій перепідключився — замінюємо старе з'єднання.
    existing.ws.roomCode = null;
    try { existing.ws.close(); } catch (e) { /* ignore */ }
  }
  room.members.set(ws.clientId, { ws, name });
  room.emptyAt = null;
  ws.roomCode = room.code;
}

function handleMessage(ws, raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch (e) {
    return send(ws, { type: "error", message: "Некоректне повідомлення" });
  }
  if (!msg || typeof msg !== "object") return;

  switch (msg.type) {
    case "create": {
      detach(ws);
      const code = makeCode();
      const name = cleanName(msg.nickname, "Гравець");
      const room = {
        code,
        name: cleanName(msg.roomName, "Партія Деберц"),
        isPublic: !!msg.isPublic,
        hostId: ws.clientId,
        hostName: name,
        members: new Map(),
        state: null,
        createdAt: Date.now(),
        emptyAt: null,
      };
      rooms.set(code, room);
      if (msg.state && typeof msg.state === "object") room.state = limitState(msg.state);
      joinRoom(ws, room, name);
      send(ws, { type: "joined", room: roomInfo(room), members: membersOf(room), hostId: room.hostId, state: room.state, you: ws.clientId });
      return;
    }
    case "join": {
      detach(ws);
      const code = String(msg.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      const room = rooms.get(code);
      if (!room) return send(ws, { type: "error", message: "Кімнату з таким кодом не знайдено", fatal: true });
      const name = cleanName(msg.nickname, "Гравець");
      joinRoom(ws, room, name);
      send(ws, { type: "joined", room: roomInfo(room), members: membersOf(room), hostId: room.hostId, state: room.state, you: ws.clientId });
      broadcastMembers(room);
      return;
    }
    case "state": {
      const room = ws.roomCode && rooms.get(ws.roomCode);
      if (!room || !room.members.has(ws.clientId)) return send(ws, { type: "error", message: "Ви не у кімнаті" });
      if (!msg.state || typeof msg.state !== "object") return;
      room.state = limitState(msg.state);
      if (!room.state) return send(ws, { type: "error", message: "Стан гри завеликий" });
      broadcast(room, { type: "state", game: room.state, from: ws.clientId }, ws.clientId);
      return;
    }
    case "close": {
      const room = ws.roomCode && rooms.get(ws.roomCode);
      if (!room || room.hostId !== ws.clientId) return send(ws, { type: "error", message: "Закрити кімнату може лише хост" });
      broadcast(room, { type: "closed" }, ws.clientId);
      for (const m of room.members.values()) m.ws.roomCode = null;
      rooms.delete(room.code);
      ws.roomCode = null;
      return;
    }
    case "leave": {
      detach(ws);
      return;
    }
    default:
      return;
  }
}

function limitState(state) {
  const json = JSON.stringify(state);
  if (json.length > MAX_STATE_BYTES) return null;
  return JSON.parse(json);
}

// ---- HTTP: статика + список публічних кімнат ----
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/rooms") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
    const list = [...rooms.values()].filter((r) => r.isPublic && r.members.size > 0).map(roomInfo);
    return res.end(JSON.stringify(list));
  }
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
    return res.end("ok");
  }

  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT) || file.includes(path.sep + "server" + path.sep) || file.includes(".git")) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Не знайдено");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
    res.end(data);
  });
});

// ---- WebSocket ----
const wss = new WebSocketServer({ server, maxPayload: MAX_STATE_BYTES + 4096 });

wss.on("connection", (ws, req) => {
  ws.isAlive = true;
  ws.clientId = null;
  ws.roomCode = null;
  ws.on("pong", () => { ws.isAlive = true; });

  // Перший кадр клієнта — його стабільний id (щоб перепідключатися до тієї ж кімнати).
  ws.on("message", (raw) => {
    const text = raw.toString();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch (e) { /* handled below */ }
    if (!ws.clientId) {
      const cid = parsed && typeof parsed.clientId === "string" ? parsed.clientId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) : "";
      ws.clientId = cid || crypto.randomUUID();
    }
    handleMessage(ws, text);
  });
  ws.on("close", () => detach(ws));
  ws.on("error", () => {});
});

// Keepalive + прибирання порожніх кімнат.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.members.size === 0 && room.emptyAt && now - room.emptyAt > EMPTY_ROOM_TTL_MS) rooms.delete(code);
  }
}, 30 * 1000).unref();

server.listen(PORT, () => {
  console.log(`Деберц запущено: http://localhost:${PORT}`);
});
