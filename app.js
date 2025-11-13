const express = require("express");
const socket = require("socket.io");
const http = require("http");
const { Chess } = require("chess.js");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = socket(server);

let chess = new Chess();
let players = {};
let timers = { w: 300, b: 300 };
let timerInterval = null;
let isTimerRunning = false;

app.set("view engine", "ejs");
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => res.render("index"));

// --- Timer helpers -------------------------------------------------
function startTimer() {
  if (isTimerRunning) return;
  isTimerRunning = true;
  clearInterval(timerInterval);

  timerInterval = setInterval(() => {
    const turn = chess.turn();

    // Prevent negatives
    if (timers[turn] > 0) timers[turn]--;

    io.emit("timers", timers);

    if (timers[turn] <= 0) {
      clearInterval(timerInterval);
      isTimerRunning = false;
      const winner = turn === "w" ? "Black" : "White";
      io.emit("gameover", `${winner} (timeout)`);
    }
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  isTimerRunning = false;
}

// -------------------------------------------------------------------
io.on("connection", (sock) => {
  let role = null;

  if (!players.white) {
    players.white = sock.id;
    role = "w";
  } else if (!players.black) {
    players.black = sock.id;
    role = "b";
  }

  sock.emit("init", { role, fen: chess.fen(), timers });

  sock.on("disconnect", () => {
    if (sock.id === players.white) delete players.white;
    if (sock.id === players.black) delete players.black;

    // Reset if everyone left
    if (!players.white && !players.black) {
      chess = new Chess();
      timers = { w: 300, b: 300 };
      stopTimer();
    }
  });

  // ------------------- MOVE HANDLER (safe) --------------------------
  sock.on("move", (mv) => {
    try {
      // ignore invalid senders
      if ((chess.turn() === "w" && sock.id !== players.white) ||
          (chess.turn() === "b" && sock.id !== players.black)) return;

      // basic validity
      if (!mv.from || !mv.to || mv.from === mv.to) return;

      // attempt move
      const result = chess.move(mv, { sloppy: true });

      // invalid → ignore
      if (!result) return;

      io.emit("move", mv);
      io.emit("boardstate", chess.fen());
      io.emit("timers", timers);

      // safely restart timer
      stopTimer();
      startTimer();

      // check for end conditions
      if (chess.isGameOver()) {
        stopTimer();
        let winner = "Draw";
        if (chess.isCheckmate())
          winner = chess.turn() === "w" ? "Black" : "White";
        io.emit("gameover", winner);
      }
    } catch (err) {
      console.log("❌ Invalid move ignored:", err.message);
      sock.emit("invalidMove", mv); // optional
    }
  });

  // ------------------- RESET GAME ----------------------------------
  sock.on("resetgame", () => {
    chess = new Chess();
    timers = { w: 300, b: 300 };
    stopTimer();
    io.emit("boardstate", chess.fen());
    io.emit("timers", timers);
  });
});
// -------------------------------------------------------------------

const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`✅ Server running on port ${PORT}`)
);