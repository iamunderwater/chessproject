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

// -------------------- In-memory data --------------------
const rooms = Object.create(null);
let quickWaiting = null;

// -------------------- Helpers --------------------
const makeRoomId = () => crypto.randomBytes(4).toString("hex").slice(0, 6).toUpperCase();

function createRoom(roomId) {
  const room = {
    chess: new Chess(),
    white: null,
    black: null,
    watchers: new Set(),
    timers: { w: 300, b: 300 },
    timerInterval: null,
    isTimerRunning: false
  };
  rooms[roomId] = room;
  return room;
}

function isSocketConnected(id) {
  if (!id) return false;
  return !!io.sockets.sockets.get(id);
}

function startRoomTimer(roomId) {
  const room = rooms[roomId];
  if (!room || room.isTimerRunning) return;
  room.isTimerRunning = true;
  if (room.timerInterval) clearInterval(room.timerInterval);

  room.timerInterval = setInterval(() => {
    const turn = room.chess.turn();
    if (!turn) return;
    if (room.timers[turn] > 0) room.timers[turn]--;
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
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
    room.timerInterval = null;
  }
  room.isTimerRunning = false;
}

function cleanRoomIfEmpty(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  if (!room.white && !room.black && room.watchers.size === 0) {
    stopRoomTimer(roomId);
    delete rooms[roomId];
    console.log(`Deleted empty room ${roomId}`);
  }
}

// -------------------- Routes --------------------
app.get("/", (req, res) => res.render("index"));
app.get("/quickplay", (req, res) => res.render("quickplay"));
app.get("/create-room", (req, res) => {
  const id = makeRoomId();
  createRoom(id);
  res.redirect(`/room/${id}`);
});
app.get("/room/:id", (req, res) => {
  const roomId = req.params.id.toUpperCase();
  if (!rooms[roomId]) createRoom(roomId);
  res.render("room", { roomId });
});

// -------------------- Socket.IO --------------------
io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  function joinSocketRoom(roomId) {
    try { socket.join(roomId); } catch (e) {}
  }
  function leaveSocketRoom(roomId) {
    try { socket.leave(roomId); } catch (e) {}
  }

  // ---- JOIN ROOM (idempotent, defensive)
  socket.on("joinRoom", (data) => {
    let roomId = "";
    let forcedRole = null;

    if (typeof data === "string") {
      roomId = data.toUpperCase();
    } else if (data && typeof data === "object") {
      roomId = String(data.roomId || "").toUpperCase();
      forcedRole = data.role; // may be 'w' or 'b' or null
    } else {
      socket.emit("info", { text: "Invalid joinRoom payload" });
      return;
    }

    if (!roomId) {
      socket.emit("info", { text: "Missing room id" });
      return;
    }

    if (!rooms[roomId]) createRoom(roomId);
    const room = rooms[roomId];

    joinSocketRoom(roomId);
    socket.data.currentRoom = roomId;

    console.log(`joinRoom: socket=${socket.id} forcedRole=${forcedRole} room=${roomId} white=${room.white} black=${room.black}`);

    // If this socket already owns a seat, re-init
    if (room.white === socket.id) {
      socket.emit("init", { role: "w", fen: room.chess.fen(), timers: room.timers });
      return;
    }
    if (room.black === socket.id) {
      socket.emit("init", { role: "b", fen: room.chess.fen(), timers: room.timers });
      return;
    }

    // If forced role provided (quickplay flow), try assign safely
    if (forcedRole === "w" || forcedRole === "b") {
      const seat = forcedRole === "w" ? "white" : "black";
      const other = seat === "white" ? "black" : "white";

      // If seat is free or prior occupant disconnected -> assign
      if (!room[seat] || !isSocketConnected(room[seat])) {
        room[seat] = socket.id;
        socket.emit("init", { role: forcedRole, fen: room.chess.fen(), timers: room.timers });
        console.log(`Assigned ${seat} to ${socket.id} in ${roomId}`);

        // If both seats present & connected -> start
        if (room.white && room.black && isSocketConnected(room.white) && isSocketConnected(room.black)) {
          startRoomTimer(roomId);
          io.to(roomId).emit("boardstate", room.chess.fen());
          io.to(roomId).emit("timers", room.timers);
        }
        return;
      }

      // seat occupied by connected socket -> watcher
      room.watchers.add(socket.id);
      socket.emit("init", { role: null, fen: room.chess.fen(), timers: room.timers });
      socket.emit("boardstate", room.chess.fen());
      socket.emit("timers", room.timers);
      return;
    }

    // FRIEND ROOM: fill white then black, but don't overwrite connected sockets
    if (!room.white || !isSocketConnected(room.white)) {
      room.white = socket.id;
      socket.emit("init", { role: "w", fen: room.chess.fen(), timers: room.timers });

      if (room.black && isSocketConnected(room.black)) {
        startRoomTimer(roomId);
        io.to(roomId).emit("boardstate", room.chess.fen());
        io.to(roomId).emit("timers", room.timers);
      } else {
        socket.emit("waiting", {
          text: "Waiting for your friend to join...",
          link: `${getBaseUrl(socket.request)}/room/${roomId}`
        });
      }
      return;
    }

    if (!room.black || !isSocketConnected(room.black)) {
      room.black = socket.id;

      io.to(room.white).emit("init", { role: "w", fen: room.chess.fen(), timers: room.timers });
      io.to(room.black).emit("init", { role: "b", fen: room.chess.fen(), timers: room.timers });

      startRoomTimer(roomId);
      io.to(roomId).emit("boardstate", room.chess.fen());
      io.to(roomId).emit("timers", room.timers);
      return;
    }

    // both seats filled -> watcher
    room.watchers.add(socket.id);
    socket.emit("init", { role: null, fen: room.chess.fen(), timers: room.timers });
    socket.emit("boardstate", room.chess.fen());
    socket.emit("timers", room.timers);
  });

  // ---- QUICKPLAY queue
  socket.on("enterQuickplay", () => {
  // If this socket is already the waiting one
  if (quickWaiting && quickWaiting.socketId === socket.id) {
    socket.emit("info", { text: "Already searching..." });
    return;
  }

  // No one waiting -> this user becomes waiting
  if (!quickWaiting) {
    quickWaiting = { socketId: socket.id, createdAt: Date.now() };
    socket.data.isInQuickplay = true;
    socket.emit("looking", { text: "Looking for available players..." });
    console.log("Quickplay: waiting:", socket.id);
    return;
  }

  // Someone IS waiting -> match them
  const waitingId = quickWaiting.socketId;
  const waitingSocket = io.sockets.sockets.get(waitingId);

  // If waiting socket disconnected, replace them
  if (!waitingSocket) {
    quickWaiting = { socketId: socket.id, createdAt: Date.now() };
    socket.data.isInQuickplay = true;
    socket.emit("looking", { text: "Looking for available players..." });
    return;
  }

  // Create the game room
  const roomId = makeRoomId();
  const room = createRoom(roomId);

  // Tell both clients who they SHOULD be,
  // but seat assignment will happen inside joinRoom (forcedRole)
  io.to(waitingId).emit("matched", { roomId, role: "w" });
  io.to(socket.id).emit("matched", { roomId, role: "b" });

  // Pre-init (so UI loads instantly)
  io.to(waitingId).emit("init", { role: "w", fen: room.chess.fen(), timers: room.timers });
  io.to(socket.id).emit("init", { role: "b", fen: room.chess.fen(), timers: room.timers });

  // Clean queue
  quickWaiting = null;
  waitingSocket.data.isInQuickplay = false;
  socket.data.isInQuickplay = false;

  console.log(`Quickplay matched ${waitingId} <> ${socket.id} -> room ${roomId}`);
});

  // ---- MOVE handling
  socket.on("move", (data) => {
    try {
      const roomId = socket.data.currentRoom || (data && data.roomId);
      if (!roomId || !rooms[roomId]) return;

      const room = rooms[roomId];
      const mv = (data && data.move) || data;
      if (!mv || !mv.from || !mv.to) return;

      const turn = room.chess.turn();
      if ((turn === "w" && socket.id !== room.white) || (turn === "b" && socket.id !== room.black)) {
        // not this player's turn
        return;
      }

      const result = room.chess.move(mv, { sloppy: true });
      if (!result) return;

      io.to(roomId).emit("move", mv);
      io.to(roomId).emit("boardstate", room.chess.fen());
      io.to(roomId).emit("timers", room.timers);

      stopRoomTimer(roomId);
      startRoomTimer(roomId);

      if (room.chess.isGameOver()) {
        stopRoomTimer(roomId);
        let winner = "Draw";
        if (room.chess.isCheckmate()) {
          winner = room.chess.turn() === "w" ? "Black" : "White";
        }
        io.to(roomId).emit("gameover", winner);
      }
    } catch (err) {
      console.log("Move error:", err && err.message);
    }
  });

  // ---- Reset game
  socket.on("resetgame", (roomId) => {
    roomId = String(roomId || socket.data.currentRoom || "").toUpperCase();
    if (!rooms[roomId]) return;
    const room = rooms[roomId];
    room.chess = new Chess();
    room.timers = { w: 300, b: 300 };
    stopRoomTimer(roomId);
    io.to(roomId).emit("boardstate", room.chess.fen());
    io.to(roomId).emit("timers", room.timers);
  });

  // ---- Disconnect
  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);

    if (quickWaiting && quickWaiting.socketId === socket.id) quickWaiting = null;

    const roomId = socket.data.currentRoom;
    if (roomId && rooms[roomId]) {
      const room = rooms[roomId];

      if (room.white === socket.id) room.white = null;
      if (room.black === socket.id) room.black = null;
      if (room.watchers.has(socket.id)) room.watchers.delete(socket.id);

      io.to(roomId).emit("info", { text: "A player left the game." });

      if (!room.white && !room.black) {
        stopRoomTimer(roomId);
        delete rooms[roomId];
        console.log(`Room ${roomId} deleted because both players left.`);
      }
    }
  });

  // ---- Utility
  function getBaseUrl(req) {
    const r = req || socket.request;
    if (!r) return `${serverAddress()}`;
    const protocol = r.headers && r.headers["x-forwarded-proto"] ? r.headers["x-forwarded-proto"] : "http";
    const host = r.headers && r.headers.host ? r.headers.host : `localhost:${process.env.PORT || 3000}`;
    return `${protocol}://${host}`;
  }
  function serverAddress() {
    return `http://localhost:${process.env.PORT || 3000}`;
  }
});

// quickplay-raw (unchanged)
app.get("/views/quickplay-raw", (req, res) => {
  res.send(`<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Quickplay</title></head><body>
  <p>Looking for available players...</p>
  <script src="/socket.io/socket.io.js"></script>
  <script>
    const s = io();
    s.on('connect', ()=> {
      s.emit('enterQuickplay');
    });
    s.on('matched', (d)=> {
      if(d && d.roomId) {
        window.location = '/room/' + d.roomId;
      }
    });
    s.on('looking',(d)=> {
      document.body.innerHTML = '<p>' + (d && d.text ? d.text : 'Looking...') + '</p>';
    });
  </script>
  </body></html>`);
});

// start
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));