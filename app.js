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

  // join socket.io room & record currentRoom
  joinSocketRoom(roomId);
  socket.data.currentRoom = roomId;

  // helper to check connection & clear dead seats
  const ensureSeatState = () => {
    if (room.white && !isSocketConnected(room.white)) {
      console.log(`joinRoom: clearing stale white ${room.white} in ${roomId}`);
      room.white = null;
    }
    if (room.black && !isSocketConnected(room.black)) {
      console.log(`joinRoom: clearing stale black ${room.black} in ${roomId}`);
      room.black = null;
    }
  };

  ensureSeatState();

  console.log(`joinRoom: socket=${socket.id} forcedRole=${forcedRole} room=${roomId} white=${room.white} black=${room.black}`);

  // If this socket already owns a seat, re-init (idempotent)
  if (room.white === socket.id) {
    socket.emit("init", { role: "w", fen: room.chess.fen(), timers: room.timers });
    return;
  }
  if (room.black === socket.id) {
    socket.emit("init", { role: "b", fen: room.chess.fen(), timers: room.timers });
    return;
  }

  // Helper to finalize after assignment: start timers if both present & connected
  const finalizeIfReady = () => {
    if (room.white && room.black && isSocketConnected(room.white) && isSocketConnected(room.black)) {
      startRoomTimer(roomId);
      io.to(roomId).emit("boardstate", room.chess.fen());
      io.to(roomId).emit("timers", room.timers);
    } else {
      // send board/timers to the joining socket so they see current state
      socket.emit("boardstate", room.chess.fen());
      socket.emit("timers", room.timers);
    }
  };

  // -------------------- Forced-role flow (quickplay) --------------------
  if (forcedRole === "w" || forcedRole === "b") {
    const desiredSeat = forcedRole === "w" ? "white" : "black";
    const otherSeat = desiredSeat === "white" ? "black" : "white";

    // If other seat is same socket (just in case), treat as re-init
    if (room[otherSeat] === socket.id) {
      // This is an odd case — don't overwrite; make this socket a watcher
      console.log(`joinRoom: socket ${socket.id} already occupying other seat ${otherSeat} in ${roomId}; adding as watcher`);
      room.watchers.add(socket.id);
      socket.emit("init", { role: null, fen: room.chess.fen(), timers: room.timers });
      socket.emit("boardstate", room.chess.fen());
      socket.emit("timers", room.timers);
      return;
    }

    // If desired seat is free (or held by disconnected socket) -> claim it
    if (!room[desiredSeat] || !isSocketConnected(room[desiredSeat])) {
      room[desiredSeat] = socket.id;
      socket.emit("init", { role: forcedRole, fen: room.chess.fen(), timers: room.timers });
      console.log(`Assigned ${desiredSeat} to ${socket.id} in ${roomId}`);

      // If other seat exists but was stale, ensure it's null (ensureSeatState already cleared stale)
      finalizeIfReady();
      return;
    }

    // Desired seat occupied by connected socket -> cannot claim it, become watcher
    console.log(`joinRoom: desired seat ${desiredSeat} is occupied by connected socket ${room[desiredSeat]}; adding ${socket.id} as watcher`);
    room.watchers.add(socket.id);
    socket.emit("init", { role: null, fen: room.chess.fen(), timers: room.timers });
    socket.emit("boardstate", room.chess.fen());
    socket.emit("timers", room.timers);
    return;
  }

  // -------------------- Friend-room (no forced role) --------------------
  // Try to fill white first if free; otherwise fill black if free.
  if (!room.white) {
    room.white = socket.id;
    socket.emit("init", { role: "w", fen: room.chess.fen(), timers: room.timers });
    console.log(`Assigned white to ${socket.id} in ${roomId} (friend join)`);

    if (room.black && isSocketConnected(room.black)) {
      // both present -> start
      finalizeIfReady();
    } else {
      // waiting for second player
      socket.emit("waiting", {
        text: "Waiting for your friend to join...",
        link: `${getBaseUrl(socket.request)}/room/${roomId}`
      });
    }
    return;
  }

  if (!room.black) {
    // If white exists but is disconnected (should have been cleared earlier), claim white instead
    if (!isSocketConnected(room.white)) {
      room.white = socket.id;
      socket.emit("init", { role: "w", fen: room.chess.fen(), timers: room.timers });
      console.log(`Reclaimed white for ${socket.id} in ${roomId} (friend join)`);
      finalizeIfReady();
      return;
    }

    // Normal fill black
    room.black = socket.id;
    io.to(room.white).emit("init", { role: "w", fen: room.chess.fen(), timers: room.timers });
    io.to(room.black).emit("init", { role: "b", fen: room.chess.fen(), timers: room.timers });
    console.log(`Assigned black to ${socket.id} in ${roomId} (friend join)`);

    finalizeIfReady();
    return;
  }

  // -------------------- Both seats filled -> watcher --------------------
  console.log(`joinRoom: both seats taken in ${roomId}; adding ${socket.id} as watcher`);
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

  // Save seats on server side and make sockets join the socket.io room
  room.white = waitingId;
  room.black = socket.id;

  // Have both sockets join the socket.io room and record currentRoom
  try { waitingSocket.join(roomId); } catch (e) {}
  try { socket.join(roomId); } catch (e) {}
  waitingSocket.data.currentRoom = roomId;
  socket.data.currentRoom = roomId;

  // Tell both clients who they SHOULD be
  io.to(waitingId).emit("matched", { roomId, role: "w" });
  io.to(socket.id).emit("matched", { roomId, role: "b" });

  // Send init + full board/timers for both
  io.to(waitingId).emit("init", { role: "w", fen: room.chess.fen(), timers: room.timers });
  io.to(socket.id).emit("init", { role: "b", fen: room.chess.fen(), timers: room.timers });

  // Broadcast boardstate/timers to the room
  io.to(roomId).emit("boardstate", room.chess.fen());
  io.to(roomId).emit("timers", room.timers);

  // Start timers only if both sockets are connected
  if (isSocketConnected(room.white) && isSocketConnected(room.black)) {
    startRoomTimer(roomId);
  }

  // Clean queue
  quickWaiting = null;
  if (waitingSocket) waitingSocket.data.isInQuickplay = false;
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