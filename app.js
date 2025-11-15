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

// ----------------------------------------------------
// ROOMS STRUCTURE
// ----------------------------------------------------
/**
 rooms[roomId] = {
   chess: new Chess(),
   white: socketId,
   black: socketId,
   watchers: Set,
   timers: { w:sec, b:sec },
   timerInterval: ID,
   isTimerRunning: bool,
   _locked: bool   <-- important fix (prevents Quickplay reassign)
 }
*/
const rooms = Object.create(null);
let quickWaiting = null;

// ----------------------------------------------------
// HELPERS
// ----------------------------------------------------
const makeRoomId = () =>
  crypto.randomBytes(4).toString("hex").slice(0, 6).toUpperCase();

function createRoom(roomId) {
  const room = {
    chess: new Chess(),
    white: null,
    black: null,
    watchers: new Set(),
    timers: { w: 300, b: 300 },
    timerInterval: null,
    isTimerRunning: false,
    _locked: false
  };
  rooms[roomId] = room;
  return room;
}

function startRoomTimer(roomId) {
  const room = rooms[roomId];
  if (!room || room.isTimerRunning) return;

  room.isTimerRunning = true;

  room.timerInterval = setInterval(() => {
    const turn = room.chess.turn();
    if (!turn) return;

    room.timers[turn]--;
    io.to(roomId).emit("timers", room.timers);

    if (room.timers[turn] <= 0) {
      clearInterval(room.timerInterval);
      room.timerInterval = null;
      room.isTimerRunning = false;
      io.to(roomId).emit("gameover",
        turn === "w" ? "Black (timeout)" : "White (timeout)"
      );
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

// ----------------------------------------------------
// ROUTES
// ----------------------------------------------------
app.get("/", (req, res) => res.render("index"));

app.get("/quickplay", (req, res) => res.render("quickplay"));

app.get("/create-room", (req, res) => {
  const id = makeRoomId();
  createRoom(id);
  res.redirect(`/room/${id}`);
});

app.get("/room/:id", (req, res) => {
  const roomId = req.params.id.toUpperCase();

  // Only create if completely new (friend mode)
  if (!rooms[roomId]) createRoom(roomId);

  res.render("room", { roomId });
});

// ----------------------------------------------------
// SOCKET LOGIC
// ----------------------------------------------------
io.on("connection", socket => {
  console.log("Connected:", socket.id);

  // Utility wrappers
  const joinRoom = id => socket.join(id);
  const leaveRoom = id => socket.leave(id);

  // ----------------------------------------------------
  // JOIN ROOM EVENT (AFTER PAGE LOAD)
  // ----------------------------------------------------
  socket.on("joinRoom", roomId => {
    roomId = String(roomId).toUpperCase();
    if (!rooms[roomId]) return;

    const room = rooms[roomId];
    socket.data.currentRoom = roomId;
    joinRoom(roomId);

    // If Quickplay assigned roles → DO NOT change them
    if (room.white === socket.id) {
      socket.emit("init", { role: "w", fen: room.chess.fen(), timers: room.timers });
      return;
    }
    if (room.black === socket.id) {
      socket.emit("init", { role: "b", fen: room.chess.fen(), timers: room.timers });
      return;
    }

    // FRIEND MODE → if not locked
    if (!room._locked) {
      if (!room.white) {
        room.white = socket.id;
        socket.emit("init", { role: "w", fen: room.chess.fen(), timers: room.timers });
        socket.emit("waiting", {
          text: "Waiting for your friend to join...",
          link: `${reqBase(socket.request)}/room/${roomId}`
        });
        return;
      }

      if (!room.black) {
        room.black = socket.id;

        io.to(room.white).emit("init", {
          role: "w",
          fen: room.chess.fen(),
          timers: room.timers
        });
        io.to(room.black).emit("init", {
          role: "b",
          fen: room.chess.fen(),
          timers: room.timers
        });

        startRoomTimer(roomId);
        io.to(roomId).emit("boardstate", room.chess.fen());
        io.to(roomId).emit("timers", room.timers);
        return;
      }
    }

    // Otherwise this is a WATCHER
    room.watchers.add(socket.id);
    socket.emit("init", {
      role: null,
      fen: room.chess.fen(),
      timers: room.timers
    });
  });

  // ----------------------------------------------------
  // QUICKPLAY MATCH-MAKING
  // ----------------------------------------------------
  socket.on("enterQuickplay", () => {
    if (quickWaiting && quickWaiting.socketId === socket.id) return;

    // No one waiting -> become waiting player
    if (!quickWaiting) {
      quickWaiting = { socketId: socket.id };
      socket.data.isInQuickplay = true;
      socket.emit("looking", { text: "Looking for available players..." });
      return;
    }

    // Someone is waiting -> match them
    const oppId = quickWaiting.socketId;
    const opp = io.sockets.sockets.get(oppId);
    quickWaiting = null;

    if (!opp) {
      quickWaiting = { socketId: socket.id };
      return;
    }

    // Make room
    const roomId = makeRoomId();
    const room = createRoom(roomId);

    // LOCK room assignment
    room.white = oppId;
    room.black = socket.id;
    room._locked = true;

    opp.data.currentRoom = roomId;
    socket.data.currentRoom = roomId;

    opp.join(roomId);
    socket.join(roomId);

    // Tell clients to navigate to the room
    io.to(oppId).emit("matched", { roomId });
    io.to(socket.id).emit("matched", { roomId });

    console.log(`Matched: ${oppId} vs ${socket.id} -> ${roomId}`);
  });

  // ----------------------------------------------------
  // MOVE
  // ----------------------------------------------------
  socket.on("move", data => {
    const roomId = socket.data.currentRoom;
    if (!roomId || !rooms[roomId]) return;

    const room = rooms[roomId];
    const mv = data.move;

    const turn = room.chess.turn();
    if ((turn === "w" && room.white !== socket.id) ||
        (turn === "b" && room.black !== socket.id)) return;

    const result = room.chess.move(mv);
    if (!result) return;

    io.to(roomId).emit("move", mv);
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

  // ----------------------------------------------------
  // RESET GAME
  // ----------------------------------------------------
  socket.on("resetgame", roomId => {
    roomId = roomId || socket.data.currentRoom;
    if (!rooms[roomId]) return;

    const room = rooms[roomId];
    room.chess = new Chess();
    room.timers = { w: 300, b: 300 };
    stopRoomTimer(roomId);

    io.to(roomId).emit("boardstate", room.chess.fen());
    io.to(roomId).emit("timers", room.timers);
  });

  // ----------------------------------------------------
  // DISCONNECT
  // ----------------------------------------------------
  socket.on("disconnect", () => {
    if (quickWaiting && quickWaiting.socketId === socket.id)
      quickWaiting = null;

    const roomId = socket.data.currentRoom;
    if (!roomId || !rooms[roomId]) return;

    const room = rooms[roomId];

    if (room.white === socket.id) room.white = null;
    if (room.black === socket.id) room.black = null;
    room.watchers.delete(socket.id);

    if (!room.white && !room.black) {
      stopRoomTimer(roomId);
      delete rooms[roomId];
    }
  });

  function reqBase(req) {
    const proto = req.headers["x-forwarded-proto"] || "http";
    return `${proto}://${req.headers.host}`;
  }
});

// ----------------------------------------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server running on", PORT));