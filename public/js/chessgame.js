const socket = io();
const chess = new Chess();

// DOM references
let boardEl, popup, popupText, playAgain, topTimer, bottomTimer;



let role = null;

// Desktop drag
let dragged = null;
let source = null;

// Tap-to-tap
let selectedSource = null;
let selectedElement = null;

// Mobile drag
let touchDrag = {
  active: false,
  startSquare: null,
  floating: null,
  lastTargetSquare: null
};

// Sounds
const moveSound = new Audio("/sounds/move.mp3");
const captureSound = new Audio("/sounds/capture.mp3");
const endSound = new Audio("/sounds/gameover.mp3");
const checkSound = new Audio("/sounds/check.mp3");

// Format timer
const fmt = s =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

// Piece images
const pieceImage = p => {
  const t = { k: "K", q: "Q", r: "R", b: "B", n: "N", p: "P" };
  return `/pieces/${p.color}${t[p.type]}.svg`;
};

// ---------------- HIGHLIGHT HELPERS ----------------
function clearHighlights() {
  document.querySelectorAll(".square.dot, .square.capture").forEach(sq => {
    sq.classList.remove("dot");
    sq.classList.remove("capture");
  });
}

function highlightMoves(row, col) {
  clearHighlights();
  const from = `${String.fromCharCode(97 + col)}${8 - row}`;
  const moves = chess.moves({ square: from, verbose: true });

  moves.forEach(mv => {
    const r = 8 - parseInt(mv.to[1]);
    const c = mv.to.charCodeAt(0) - 97;
    const sq = document.querySelector(`.square[data-row='${r}'][data-col='${c}']`);
    if (!sq) return;
    if (mv.flags && mv.flags.includes("c")) sq.classList.add("capture");
    else sq.classList.add("dot");
  });
}

function clearSelectionUI() {
  if (selectedElement) selectedElement.classList.remove("selected");
  selectedElement = null;
  selectedSource = null;
  clearHighlights();
}

// ---------------- BOARD RENDER ----------------
function initBoard() {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = document.createElement("div");
      cell.classList.add("square", (r + c) % 2 ? "dark" : "light");
      cell.dataset.row = r;
      cell.dataset.col = c;
      boardEl.appendChild(cell);
    }
  }
}

function renderPieces() {
  document.querySelectorAll(".piece").forEach(p => p.remove());

  const board = chess.board();

  board.forEach((row, r) => {
    row.forEach((sq, c) => {
      if (!sq) return;

      const piece = document.createElement("img");
      piece.src = pieceImage(sq);
      piece.classList.add("piece");
      piece.style.transform = `translate(${c * 80}px, ${r * 80}px)`;
      boardEl.appendChild(piece);
    });
  });
}

// ---------------- HANDLE MOVES ----------------
function handleMove(s, t) {
  if (!s) return;
  if (s.row === t.row && s.col === t.col) return;

  const mv = {
    from: `${String.fromCharCode(97 + s.col)}${8 - s.row}`,
    to: `${String.fromCharCode(97 + t.col)}${8 - t.row}`,
    promotion: "q"
  };

  socket.emit("move", { roomId: ROOM_ID, move: mv });
}

// ---------------- TIMERS ----------------
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

// ======================================================
// SOCKET EVENTS
// ======================================================

// -------- QUICK PLAY MATCHED --------
socket.on("matched", d => {
  if (d && d.roomId && d.role) {
    // save role for joinRoom
    localStorage.setItem("quickplayRole", d.role);

    window.location = `/room/${d.roomId}`;
  }
});

// -------- WAITING SCREEN (Friend Mode or Quickplay) --------
socket.on("waiting", d => {
  document.getElementById("game").classList.add("hidden");
  document.getElementById("waiting").classList.remove("hidden");

  document.getElementById("wait-text").innerText = d.text;

  if (d.link) {
    document.getElementById("room-link").innerText = d.link;
  }
});

// -------- INITIAL SETUP --------
socket.on("init", data => {
  localStorage.removeItem("quickplayRole");
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
  initBoard();        // build the 64 squares once
  renderPieces();     // draw pieces on squares
  updateTimers(data.timers);
});

// -------- BOARD UPDATE --------
socket.on("boardstate", fen => {
  chess.load(fen);
  renderPieces();
  clearSelectionUI();
});

// -------- MOVE EVENT --------
socket.on("move", mv => {
  const res = chess.move(mv);
  renderPieces();
  clearSelectionUI();

  if (chess.in_check()) {
    checkSound.play();
    return;
  }

  if (res && res.captured) captureSound.play();
  else moveSound.play();
});

// -------- TIMERS --------
socket.on("timers", t => updateTimers(t));

// -------- GAME OVER --------
socket.on("gameover", winner => {
  let txt = "";

  if (winner.includes("timeout")) {
    if (role === "w" && winner.startsWith("White")) txt = "EZ Timeout Win 😎";
    else if (role === "b" && winner.startsWith("Black"))
      txt = "Time’s up, victory is mine 🕒🔥";
    else txt = "Skill issue? 🫵😂";
  } else if (winner === "Draw") txt = "Both are noobs";
  else if (winner === "White") {
    txt = role === "w" ? "You win 😎" : "You lost, noob 💀";
  } else if (winner === "Black") {
    txt = role === "b" ? "You win 😎" : "You got outplayed bro 💀";
  }

  popupText.innerText = txt;
  popup.classList.add("show");
  endSound.play();
});

// -------- RESET BUTTON --------
document.getElementById("play-again").onclick = () => {
  socket.emit("resetgame", ROOM_ID);
  popup.classList.remove("show");
};

// -------- JOIN ROOM ON PAGE LOAD --------
if (ROOM_ID) {
  const quickRole = localStorage.getItem("quickplayRole"); // "w" or "b" or null
  socket.emit("joinRoom", { roomId: ROOM_ID, role: quickRole });
}