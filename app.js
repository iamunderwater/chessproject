const express = require("express");
const socketio = require("socket.io");
const http = require("http");
const { Chess } = require("chess.js");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = socketio(server);

app.set("view engine", "ejs");
app.use(express.static(path.join(__dirname, "public")));

const rooms = Object.create(null);
let quickWaiting = null;

const makeRoomId = () =>
  crypto.randomBytes(4).toString("hex").slice(0, 6).toUpperCase();

function createRoom(id) {
  rooms[id] = {
    chess: new Chess(),
    white: null,
    black: null,
    watchers: new Set(),
    timers: { w: 300, b: 300 },
    isTimerRunning: false,
    timerInterval: null
  };
  return rooms[id];
}

function startTimer(id) {
  const room = rooms[id];
  if (!room || room.isTimerRunning) return;
  room.isTimerRunning = true;

  room.timerInterval = setInterval(() => {
    const turn = room.chess.turn();
    if (!turn) return;

    room.timers[turn]--;
    io.to(id).emit("timers", room.timers);

    if (room.timers[turn] <= 0) {
      clearInterval(room.timerInterval);
      room.timerInterval = null;
      room.isTimerRunning = false;

      const winner = turn === "w" ? "Black" : "White";
      io.to(id).emit("gameover", `${winner} (timeout)`);
    }
  }, 1000);
}

function stopTimer(id) {
  const room = rooms[id];
  if (!room) return;
  if (room.timerInterval) clearInterval(room.timerInterval);
  room.isTimerRunning = false;
  room.timerInterval = null;
}

app.get("/", (req, res) => {
  res.render("index");
});

app.get("/quickplay", (req, res) => {
  res.render("quickplay");
});

app.get("/create-room", (req, res) => {
  const id = makeRoomId();
  createRoom(id);
  res.redirect(`/room/${id}`);
});

app.get("/room/:id", (req, res) => {
  const id = req.params.id.toUpperCase();
  if (!rooms[id]) createRoom(id);
  res.render("room", { roomId: id });
});

// ==================================================================
// SOCKET.IO
// ==================================================================
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // =================== JOIN ROOM ======================
  socket.on("joinRoom", (payload) => {
    let roomId = null;
    let requestedRole = null;

    if (typeof payload === "string") {
      roomId = payload.toUpperCase();
    } else {
      roomId = String(payload.roomId).toUpperCase();
      requestedRole = payload.role; // 'w' | 'b' | null
    }

    if (!rooms[roomId]) createRoom(roomId);
    const room = rooms[roomId];
    socket.join(roomId);
    socket.data.roomId = roomId;

    // If Quickplay gave us a role → honor it
    if (requestedRole === "w") {
      room.white = socket.id;
      socket.emit("init", { role: "w", fen: room.chess.fen(), timers: room.timers });

      if (room.black) {
        startTimer(roomId);
        io.to(roomId).emit("boardstate", room.chess.fen());
        io.to(roomId).emit("timers", room.timers);
      }
      return;
    }

    if (requestedRole === "b") {
      room.black = socket.id;
      socket.emit("init", { role: "b", fen: room.chess.fen(), timers: room.timers });

      if (room.white) {
        startTimer(roomId);
        io.to(roomId).emit("boardstate", room.chess.fen());
        io.to(roomId).emit("timers", room.timers);
      }
      return;
    }

    // ========== FRIEND MODE ==========
    if (!room.white) {
      room.white = socket.id;
      socket.emit("init", { role: "w", fen: room.chess.fen(), timers: room.timers });

      socket.emit("waiting", {
        text: "Waiting for your friend to join...",
        link: `${getUrl(socket)}/room/${roomId}`
      });

      return;
    } else if (!room.black) {
      room.black = socket.id;

      io.to(room.white).emit("init", { role: "w", fen: room.chess.fen(), timers: room.timers });
      io.to(room.black).emit("init", { role: "b", fen: room.chess.fen(), timers: room.timers });

      startTimer(roomId);
      io.to(roomId).emit("boardstate", room.chess.fen());
      io.to(roomId).emit("timers", room.timers);

      return;
    }

    // WATCHER MODE
    room.watchers.add(socket.id);
    socket.emit("init", { role: null, fen: room.chess.fen(), timers: room.timers });
    socket.emit("boardstate", room.chess.fen());
    socket.emit("timers", room.timers);
  });

  // =================== QUICKPLAY ======================
  socket.on("enterQuickplay", () => {
    if (!quickWaiting) {
      quickWaiting = socket.id;
      socket.emit("looking", { text: "Looking for available players..." });
      return;
    }

    const p1 = quickWaiting;
    const p2 = socket.id;
    quickWaiting = null;

    const roomId = makeRoomId();
    createRoom(roomId);

    io.to(p1).emit("matched", { roomId, role: "w" });
    io.to(p2).emit("matched", { roomId, role: "b" });

    // VERY IMPORTANT: forceJoin also includes the role via URL
    io.to(p1).emit("forceJoin", { roomId, role: "w" });
    io.to(p2).emit("forceJoin", { roomId, role: "b" });
  });

  // =================== MOVE ======================
  socket.on("move", (data) => {
    const roomId = socket.data.roomId;
    if (!rooms[roomId]) return;

    const room = rooms[roomId];
    const mv = data.move;

    const turn = room.chess.turn();
    if (turn === "w" && socket.id !== room.white) return;
    if (turn === "b" && socket.id !== room.black) return;

    if (!room.chess.move(mv)) return;

    io.to(roomId).emit("move", mv);
    io.to(roomId).emit("boardstate", room.chess.fen());
    io.to(roomId).emit("timers", room.timers);

    stopTimer(roomId);
    startTimer(roomId);

    if (room.chess.isGameOver()) {
      stopTimer(roomId);
      let w = "Draw";
      if (room.chess.isCheckmate()) {
        w = room.chess.turn() === "w" ? "Black" : "White";
      }
      io.to(roomId).emit("gameover", w);
    }
  });

  // =================== RESET ======================
  socket.on("resetgame", () => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room) return;

    room.chess = new Chess();
    room.timers = { w: 300, b: 300 };
    stopTimer(roomId);

    io.to(roomId).emit("boardstate", room.chess.fen());
    io.to(roomId).emit("timers", room.timers);
  });

  // =================== DISCONNECT ======================
  socket.on("disconnect", () => {
    if (quickWaiting === socket.id) quickWaiting = null;

    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room) return;

    if (room.white === socket.id) room.white = null;
    if (room.black === socket.id) room.black = null;
    room.watchers.delete(socket.id);

    io.to(roomId).emit("info", { text: "A player left the game." });

    if (!room.white && !room.black) {
      stopTimer(roomId);
      delete rooms[roomId];
    }
  });
});

function getUrl(socket) {
  const h = socket.request.headers.host;
  const proto = socket.request.headers["x-forwarded-proto"] || "http";
  return `${proto}://${h}`;
}

server.listen(process.env.PORT || 3000, () =>
  console.log("Server started.")
);