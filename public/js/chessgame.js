const socket = io();
const chess = new Chess();

// DOM elements
let boardEl, popup, popupText, playAgain, topTimer, bottomTimer;

// ROOM_ID comes from room.ejs
let ROOM_ID = typeof ROOM_ID !== "undefined" ? ROOM_ID : null;

// Get role from URL (?role=w or ?role=b)
const params = new URLSearchParams(location.search);
let ROLE_REQUEST = params.get("role"); // "w" | "b" | null
let role = null;

let dragData = null;

// Sounds
const moveSound = new Audio("/sounds/move.mp3");
const captureSound = new Audio("/sounds/capture.mp3");
const endSound = new Audio("/sounds/gameover.mp3");
const checkSound = new Audio("/sounds/check.mp3");

// Format timer
function fmt(s) {
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

// Piece image lookup
function pieceImage(p) {
  const t = { k: "K", q: "Q", r: "R", b: "B", n: "N", p: "P" };
  return `/pieces/${p.color}${t[p.type]}.svg`;
}

// ==================== BOARD RENDERING =====================
function renderBoard() {
  const b = chess.board();
  boardEl.innerHTML = "";

  b.forEach((row, r) => {
    row.forEach((sq, c) => {
      const div = document.createElement("div");
      div.classList.add("square", (r + c) % 2 ? "dark" : "light");
      div.dataset.row = r;
      div.dataset.col = c;

      div.addEventListener("dragover", (e) => e.preventDefault());
      div.addEventListener("drop", () => {
        if (!dragData) return;
        attemptMove(dragData, { row: r, col: c });
      });

      if (sq) {
        const img = document.createElement("img");
        img.src = pieceImage(sq);
        img.classList.add("piece-img");

        if (sq.color === role) {
          img.draggable = true;
          img.addEventListener("dragstart", () => (dragData = { row: r, col: c }));
          img.addEventListener("dragend", () => (dragData = null));
        }

        div.appendChild(img);
      }

      boardEl.appendChild(div);
    });
  });

  if (role === "b") boardEl.classList.add("flipped");
  else boardEl.classList.remove("flipped");
}

function attemptMove(from, to) {
  const mv = {
    from: `${String.fromCharCode(97 + from.col)}${8 - from.row}`,
    to: `${String.fromCharCode(97 + to.col)}${8 - to.row}`,
    promotion: "q"
  };
  socket.emit("move", { roomId: ROOM_ID, move: mv });
}

// ==================== SOCKET EVENTS ========================

// JOIN ROOM (send ROLE_REQUEST)
socket.on("connect", () => {
  if (ROOM_ID) {
    socket.emit("joinRoom", { roomId: ROOM_ID, role: ROLE_REQUEST });
  }
});

// Render retry fix
socket.on("forceJoin", (d) => {
  socket.emit("joinRoom", { roomId: d.roomId, role: d.role });
});

// MATCHED → redirect to room with ?role=
socket.on("matched", (d) => {
  if (d.roomId) {
    location.href = `/room/${d.roomId}?role=${d.role}`;
  }
});

// Waiting (friend mode)
socket.on("waiting", (d) => {
  document.getElementById("game").classList.add("hidden");
  document.getElementById("waiting").classList.remove("hidden");

  document.getElementById("wait-text").innerText = d.text;
  if (d.link) document.getElementById("room-link").innerText = d.link;
});

// INITIAL SETUP
socket.on("init", (data) => {
  role = data.role;

  document.getElementById("waiting").classList.add("hidden");
  document.getElementById("game").classList.remove("hidden");

  boardEl = document.querySelector(".chessboard");
  popup = document.getElementById("popup");
  popupText = document.getElementById("popup-text");
  playAgain = document.getElementById("play-again");
  topTimer = document.getElementById("top-timer");
  bottomTimer = document.getElementById("bottom-timer");

  chess.load(data.fen);
  renderBoard();
  updateTimers(data.timers);
});

// BOARD UPDATE
socket.on("boardstate", (fen) => {
  chess.load(fen);
  renderBoard();
});

// MOVE EVENT
socket.on("move", (mv) => {
  const result = chess.move(mv);
  renderBoard();

  if (chess.in_check()) checkSound.play();
  else if (result && result.captured) captureSound.play();
  else moveSound.play();
});

// TIMERS
function updateTimers(t) {
  if (!t) return;
  if (role === "b") {
    bottomTimer.innerText = fmt(t.b);
    topTimer.innerText = fmt(t.w);
  } else {
    bottomTimer.innerText = fmt(t.w);
    topTimer.innerText = fmt(t.b);
  }
}

socket.on("timers", (t) => updateTimers(t));

// GAME OVER POPUP
socket.on("gameover", (w) => {
  popup.classList.add("show");

  if (w === "Draw") popupText.innerText = "Draw!";
  else if (w.includes("White")) popupText.innerText = role === "w" ? "You win!" : "You lost!";
  else popupText.innerText = role === "b" ? "You win!" : "You lost!";

  endSound.play();
});

// RESET
playAgain?.addEventListener("click", () => {
  socket.emit("resetgame", ROOM_ID);
  popup.classList.remove("show");
});