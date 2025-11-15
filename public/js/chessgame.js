const socket = io();
const chess = new Chess();

// DOM refs
let boardEl, popup, popupText, playAgain, topTimer, bottomTimer;

let role = null;

// Drag & selection state
let draggingEl = null;
let dragPointerId = null;
let dragStart = null; // { square, offsetX, offsetY }
let selectedSource = null;
let selectedElement = null;

// Sounds
const moveSound = new Audio("/sounds/move.mp3");
const captureSound = new Audio("/sounds/capture.mp3");
const endSound = new Audio("/sounds/gameover.mp3");
const checkSound = new Audio("/sounds/check.mp3");

// Constants - faster but smooth
const TILE = 80;
const TRANS_MS = 80; // faster than before

// Helpers
const fmt = s => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
const pieceImage = p => {
  const t = { k: "K", q: "Q", r: "R", b: "B", n: "N", p: "P" };
  return `/pieces/${p.color}${t[p.type]}.svg`;
};

function clearHighlights() {
  document.querySelectorAll(".square.dot, .square.capture").forEach(sq => {
    sq.classList.remove("dot");
    sq.classList.remove("capture");
  });
}
function highlightMoves(row, col) {
  clearHighlights();
  const from = `${String.fromCharCode(97 + col)}${8 - row}`;
  const moves = chess.moves({ square: from, verbose: true }) || [];
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

function rcToSquare(r, c) { return `${String.fromCharCode(97 + c)}${8 - r}`; }
function squareToRC(sq) {
  const c = sq.charCodeAt(0) - 97;
  const r = 8 - parseInt(sq[1], 10);
  return { row: r, col: c };
}
function squareToPixels(square) {
  const { row, col } = squareToRC(square);
  return { x: col * TILE, y: row * TILE };
}
function getSquareFromPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const sqEl = el.closest(".square");
  if (!sqEl) return null;
  return { row: parseInt(sqEl.dataset.row), col: parseInt(sqEl.dataset.col) };
}

// ---------------- RENDER
function renderBoard() {
  boardEl.innerHTML = "";

  // squares
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = document.createElement("div");
      sq.className = `square ${(r + c) % 2 ? "dark" : "light"}`;
      sq.style.left = `${c * TILE}px`;
      sq.style.top = `${r * TILE}px`;
      sq.dataset.row = r;
      sq.dataset.col = c;

      sq.addEventListener("click", () => {
        if (selectedSource) {
          handleMove(selectedSource, { row: r, col: c });
          clearSelectionUI();
        }
      });

      sq.addEventListener("touchend", (e) => {
        if (selectedSource) {
          e.preventDefault();
          handleMove(selectedSource, { row: r, col: c });
          clearSelectionUI();
        }
      }, { passive: false });

      boardEl.appendChild(sq);
    }
  }

  renderPieces();
}

function renderPieces() {
  document.querySelectorAll(".piece").forEach(n => n.remove());
  const board = chess.board();
  board.forEach((row, r) => {
    row.forEach((sq, c) => {
      if (!sq) return;
      const square = rcToSquare(r, c);
      const piece = document.createElement("div");
      piece.className = "piece";
      piece.dataset.square = square;
      piece.dataset.color = sq.color;
      // place instantly (no transition on initial render)
      piece.style.transition = "none";
      piece.style.transform = `translate(${c * TILE}px, ${r * TILE}px)`;

      const img = document.createElement("img");
      img.className = "piece-img";
      img.src = pieceImage(sq);
      piece.appendChild(img);

      attachPointerHandlers(piece, sq.color);

      boardEl.appendChild(piece);
      // force reflow then enable transitions for later moves
      requestAnimationFrame(() => {
        piece.style.transition = `transform ${TRANS_MS}ms ease-in-out`;
      });
    });
  });

  if (role === "b") boardEl.classList.add("flipped");
  else boardEl.classList.remove("flipped");

  clearHighlights();
}

// ---------------- Pointer handlers
function attachPointerHandlers(pieceEl, color) {
  pieceEl.addEventListener("pointerdown", (ev) => {
    if (!role || role !== color) return;
    ev.preventDefault();
    pieceEl.setPointerCapture(ev.pointerId);
    dragPointerId = ev.pointerId;
    draggingEl = pieceEl;
    draggingEl.classList.add("dragging");

    const rect = boardEl.getBoundingClientRect();
    const startSquare = pieceEl.dataset.square;
    const { x: sqX, y: sqY } = squareToPixels(startSquare);
    const offsetX = ev.clientX - (rect.left + sqX);
    const offsetY = ev.clientY - (rect.top + sqY);

    dragStart = { square: startSquare, offsetX, offsetY };
    const rc = squareToRC(startSquare);
    highlightMoves(rc.row, rc.col);
  });

  pieceEl.addEventListener("pointermove", (ev) => {
    if (!draggingEl || dragPointerId !== ev.pointerId) return;
    ev.preventDefault();
    const rect = boardEl.getBoundingClientRect();
    const x = ev.clientX - rect.left - dragStart.offsetX;
    const y = ev.clientY - rect.top - dragStart.offsetY;
    draggingEl.style.transform = `translate(${x}px, ${y}px)`;
  });

  pieceEl.addEventListener("pointerup", (ev) => {
    if (!draggingEl || dragPointerId !== ev.pointerId) return;
    ev.preventDefault();
    try { pieceEl.releasePointerCapture(ev.pointerId); } catch (e) {}

    const drop = getSquareFromPoint(ev.clientX, ev.clientY);
    const fromRC = squareToRC(dragStart.square);
    const from = { row: fromRC.row, col: fromRC.col };
    let to = null;
    if (drop) to = { row: drop.row, col: drop.col };

    clearHighlights();
    draggingEl.classList.remove("dragging");

    if (to && (to.row !== from.row || to.col !== from.col)) {
      handleMove(from, to);
      // optimistic visual
      const toSquare = rcToSquare(to.row, to.col);
      const { x, y } = squareToPixels(toSquare);
      draggingEl.style.transition = `transform ${TRANS_MS}ms ease-in-out`;
      draggingEl.style.transform = `translate(${x}px, ${y}px)`;
      draggingEl.dataset.square = toSquare;
    } else {
      const { x, y } = squareToPixels(dragStart.square);
      draggingEl.style.transition = `transform ${TRANS_MS}ms ease-in-out`;
      draggingEl.style.transform = `translate(${x}px, ${y}px)`;
    }

    draggingEl = null;
    dragPointerId = null;
    dragStart = null;
    selectedSource = null;
    selectedElement = null;
  });

  pieceEl.addEventListener("pointercancel", (ev) => {
    if (!draggingEl || dragPointerId !== ev.pointerId) return;
    try { pieceEl.releasePointerCapture(ev.pointerId); } catch (e) {}
    const { x, y } = squareToPixels(dragStart.square);
    draggingEl.style.transform = `translate(${x}px, ${y}px)`;
    draggingEl.classList.remove("dragging");
    draggingEl = null;
    dragPointerId = null;
    dragStart = null;
    clearHighlights();
  });

  pieceEl.addEventListener("click", (e) => {
    if (dragStart) return;
    const sq = squareToRC(pieceEl.dataset.square);
    if (!role || role !== color) return;

    if (selectedSource && selectedSource.row === sq.row && selectedSource.col === sq.col) {
      clearSelectionUI();
    } else {
      clearSelectionUI();
      selectedSource = { row: sq.row, col: sq.col };
      selectedElement = pieceEl;
      selectedElement.classList.add("selected");
      highlightMoves(sq.row, sq.col);
    }
  });
}

// DOM helpers
function findPieceElement(square) {
  return document.querySelector(`.piece[data-square='${square}']`);
}
function removePieceElement(square) {
  const el = findPieceElement(square);
  if (!el) return;
  el.style.transition = `opacity ${TRANS_MS}ms ease`;
  el.style.opacity = "0";
  setTimeout(() => { if (el && el.parentNode) el.parentNode.removeChild(el); }, TRANS_MS + 20);
}
function movePieceElement(fromSquare, toSquare, promotion, color) {
  const el = findPieceElement(fromSquare);
  if (!el) {
    renderBoard();
    return;
  }
  const { x, y } = squareToPixels(toSquare);
  el.style.transition = `transform ${TRANS_MS}ms ease-in-out`;
  el.style.transform = `translate(${x}px, ${y}px)`;
  setTimeout(() => {
    el.dataset.square = toSquare;
    if (promotion) {
      const newImg = `/pieces/${color}${promotion.toUpperCase()}.svg`;
      const imgEl = el.querySelector("img.piece-img");
      if (imgEl) imgEl.src = newImg;
    }
  }, TRANS_MS + 10);
}

// SOCKET EVENTS (with debug logs)
socket.on("matched", d => {
  console.log("CLIENT matched event:", d);
  if (d && d.roomId && d.role) {
    localStorage.setItem("quickplayRole", d.role);
    window.location = `/room/${d.roomId}`;
  }
});

socket.on("waiting", d => {
  console.log("CLIENT waiting:", d);
  document.getElementById("game").classList.add("hidden");
  document.getElementById("waiting").classList.remove("hidden");
  document.getElementById("wait-text").innerText = d.text || "";
  if (d.link) document.getElementById("room-link").innerText = d.link;
});

socket.on("init", data => {
  console.log("CLIENT init event:", data);
  localStorage.removeItem("quickplayRole");
  role = data.role;
  console.log("CLIENT role set to:", role);

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

socket.on("boardstate", fen => {
  chess.load(fen);
  renderBoard();
  clearSelectionUI();
});

socket.on("move", mv => {
  try {
    const capturedBefore = chess.get(mv.to);
    const res = chess.move(mv, { sloppy: true });
    if (!res) { renderBoard(); return; }
    if (capturedBefore) removePieceElement(mv.to);
    movePieceElement(mv.from, mv.to, res.promotion, res.color);
    clearSelectionUI();
    if (chess.in_check()) checkSound.play();
    if (res && res.captured) captureSound.play();
    else moveSound.play();
  } catch (e) {
    console.log("move event error", e);
    renderBoard();
  }
});

socket.on("timers", t => updateTimers(t));

socket.on("gameover", winner => {
  let txt = "";
  if (winner.includes("timeout")) {
    if (role === "w" && winner.startsWith("White")) txt = "EZ Timeout Win 😎";
    else if (role === "b" && winner.startsWith("Black")) txt = "Time’s up, victory is mine 🕒🔥";
    else txt = "Skill issue? 🫵😂";
  } else if (winner === "Draw") txt = "Both are noobs";
  else if (winner === "White") txt = role === "w" ? "You win 😎" : "You lost, noob 💀";
  else if (winner === "Black") txt = role === "b" ? "You win 😎" : "You got outplayed bro 💀";

  popupText.innerText = txt;
  popup.classList.add("show");
  endSound.play();
});

document.getElementById("play-again").onclick = () => {
  socket.emit("resetgame", ROOM_ID);
  popup.classList.remove("show");
};

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

// join on load
if (ROOM_ID) {
  const quickRole = localStorage.getItem("quickplayRole");
  socket.emit("joinRoom", { roomId: ROOM_ID, role: quickRole });
}