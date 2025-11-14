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

// -------------------- In-memory rooms --------------------
const rooms = {};
let quickWaiting = null; // single quickplay queue

// Generate 6-character room id
const makeRoomId = () =>
  crypto.randomBytes(4).toString("hex").slice(0, 6).toUpperCase();

function createRoom(roomId) {
  rooms[roomId] = {
    chess: new Chess(),
    white: null,
    black: null,
    watchers: new Set(),
    timers: { w: 300, b: 300 },
    timerInterval: null,
    isTimerRunning: false
  };
  return rooms[roomId];
}

// ----------------- TIMER HELPERS -----------------
function startRoomTimer(roomId) {
  const room = rooms[roomId];
  if (!room || room.isTimerRunning) return;

  room.isTimerRunning = true;

  if (room.timerInterval) clearInterval(room.timerInterval);

  room.timerInterval = setInterval(() => {
    const turn = room.chess.turn(); // 'w' or 'b'
    if (!turn) return;

    room.timers[turn]--;
    io.to(roomId).emit("timers", room.timers);

    if (room.timers[turn] <= 0) {
      clearInterval(room.timerInterval);
      room.timerInterval = null;
      room.isTimerRunning = false;

      const winner = turn === "w" ? "Black" : "White";
      io.to(roomId).emit("gameover", `${winner} (timeout)`);
    }
  }, 1000);
}

function stopRoomTimer(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  if (room.timerInterval) clearInterval(room.timerInterval);
  room.timerInterval = null;
  room.isTimerRunning = false;
}

// -------------------- ROUTES --------------------
app.get("/", (req, res) => res.render("index"));
app.get("/quickplay", (req, res) => res.render("quickplay"));

app.get("/create-room", (req, res) => {
  const roomId = makeRoomId();
  createRoom(roomId);
  res.redirect(`/room/${roomId}`);
});

app.get("/room/:id", (req, res) => {
  const id = req.params.id.toUpperCase();
  if (!rooms[id]) createRoom(id);
  res.render("room", { roomId: id });
});

// -------------------- SOCKET --------------------
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // -------------- QUICKPLAY --------------
  socket.on("enterQuickplay", () => {
    if (!quickWaiting) {
      quickWaiting = socket.id;
      socket.emit("looking", { text: "Looking for players..." });
      return;
    }

    // Match found
    const p1 = quickWaiting;
    const p2 = socket.id;
    quickWaiting = null;

    const roomId = makeRoomId();
    const room = createRoom(roomId);

    room.white = p1;
    room.black = p2;

    io.to(p1).emit("matched", { roomId });
    io.to(p2).emit("matched", { roomId });
  });

  // -------------- JOIN ROOM --------------
  socket.on("joinRoom", (roomId) => {
    roomId = roomId.toUpperCase();
    socket.join(roomId);

    if (!rooms[roomId]) createRoom(roomId);
    const room = rooms[roomId];

    // Assign side
    let role = null;
    if (!room.white) {
      room.white = socket.id;
      role = "w";
    } else if (!room.black) {
      room.black = socket.id;
      role = "b";
    } else {
      room.watchers.add(socket.id);
      role = null; // spectator
    }

    socket.data.roomId = roomId;
    socket.emit("init", {
      role,
      fen: room.chess.fen(),
      timers: room.timers
    });

    // If second player joined → start timer and notify both
    if (room.white && room.black && !room.isTimerRunning) {
      startRoomTimer(roomId);
      io.to(roomId).emit("boardstate", room.chess.fen());
      io.to(roomId).emit("timers", room.timers);
    }
  });

  // -------------- MOVE --------------
  socket.on("move", ({ roomId, move }) => {
    if (!rooms[roomId]) return;

    const room = rooms[roomId];
    const turn = room.chess.turn(); // 'w' or 'b'

    // Enforce turn-based play
    if (turn === "w" && socket.id !== room.white) return;
    if (turn === "b" && socket.id !== room.black) return;

    const result = room.chess.move(move);
    if (!result) return;

    // Broadcast move
    io.to(roomId).emit("move", move);
    io.to(roomId).emit("boardstate", room.chess.fen());

    stopRoomTimer(roomId);
    startRoomTimer(roomId);

    if (room.chess.isGameOver()) {
      stopRoomTimer(roomId);
      let winner = "Draw";
      if (room.chess.isCheckmate())
        winner = room.chess.turn() === "w" ? "Black" : "White";

      io.to(roomId).emit("gameover", winner);
    }
  });

  // -------------- RESET --------------
  socket.on("resetgame", (roomId) => {
    if (!rooms[roomId]) return;
    const room = rooms[roomId];

    room.chess = new Chess();
    room.timers = { w: 300, b: 300 };
    stopRoomTimer(roomId);

    io.to(roomId).emit("boardstate", room.chess.fen());
    io.to(roomId).emit("timers", room.timers);
  });

  // -------------- DISCONNECT --------------
  socket.on("disconnect", () => {
    if (quickWaiting === socket.id) quickWaiting = null;

    for (const roomId of Object.keys(rooms)) {
      const room = rooms[roomId];

      if (room.white === socket.id) room.white = null;
      if (room.black === socket.id) room.black = null;
      room.watchers.delete(socket.id);

      if (!room.white && !room.black) {
        stopRoomTimer(roomId);
        delete rooms[roomId];
        console.log("Deleted empty room:", roomId);
      }
    }
  });
});

// -------------------- START SERVER --------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`)
);