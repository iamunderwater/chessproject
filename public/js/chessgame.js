const socket = io();
const chess = new Chess();

// DOM refs
let boardEl, popup, popupText, playAgain, topTimer, bottomTimer;

let role = null;

// Drag & selection state
let draggingEl = null;
let dragPointerId = null;
let dragStart = null; // { square, x, y, offsetX, offsetY }
let selectedSource = null;
let selectedElement = null;

// Mobile floating fallback removed: we use pointer events for both touch & mouse

// Sounds
const moveSound = new Audio("/sounds/move.mp3");
const captureSound = new Audio("/sounds/capture.mp3");
const endSound = new Audio("/sounds/gameover.mp3");
const checkSound = new Audio("/sounds/check.mp3");

// Constants
const TILE = 80;
const TRANS_MS = 150;

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

// ---------------- RENDER (once) ----------------
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

      // tap-to-tap
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
  // remove pieces
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
      piece.style.transform = `translate(${c * TILE}px, ${r * TILE}px)`;

      const img = document.createElement("img");
      img.className = "piece-img";
      img.src = pieceImage(sq);
      piece.appendChild(img);

      // attach pointer handlers for smooth drag
      attachPointerHandlers(piece, sq.color);

      boardEl.appendChild(piece);
    });
  });

  // flipped visual (we keep same transform — flipping UI must be handled by CSS or class)
  if (role === "b") boardEl.classList.add("flipped");
  else boardEl.classList.remove("flipped");

  clearHighlights();
}

// ---------------- POINTER (drag) logic ----------------
function attachPointerHandlers(pieceEl, color) {
  // pointerdown starts drag (mouse & touch unified)
  pieceEl.addEventListener("pointerdown", (ev) => {
    // only start drag if owner
    if (!role || role !== color) return;

    ev.preventDefault();
    pieceEl.setPointerCapture(ev.pointerId);
    dragPointerId = ev.pointerId;
    draggingEl = pieceEl;
    draggingEl.classList.add("dragging");

    // compute offset from piece top-left to pointer
    const rect = boardEl.getBoundingClientRect();
    const startSquare = pieceEl.dataset.square;
    const { x: sqX, y: sqY } = squareToPixels(startSquare);
    const clientX = ev.clientX;
    const clientY = ev.clientY;
    const offsetX = clientX - (rect.left + sqX);
    const offsetY = clientY - (rect.top + sqY);

    dragStart = {
      square: startSquare,
      offsetX,
      offsetY,
      origTransform: pieceEl.style.transform
    };

    // highlight moves from origin
    const rc = squareToRC(startSquare);
    highlightMoves(rc.row, rc.col);
  });

  // pointermove - move piece element with pointer
  pieceEl.addEventListener("pointermove", (ev) => {
    if (!draggingEl || dragPointerId !== ev.pointerId) return;
    ev.preventDefault();
    const rect = boardEl.getBoundingClientRect();
    const x = ev.clientX - rect.left - dragStart.offsetX;
    const y = ev.clientY - rect.top - dragStart.offsetY;
    draggingEl.style.transform = `translate(${x}px, ${y}px)`;
  });

  // pointerup - release and either drop or snap back
  pieceEl.addEventListener("pointerup", (ev) => {
    if (!draggingEl || dragPointerId !== ev.pointerId) return;
    ev.preventDefault();

    // release capture
    try { pieceEl.releasePointerCapture(ev.pointerId); } catch (e) {}

    // find drop square
    const drop = getSquareFromPoint(ev.clientX, ev.clientY);
    const fromRC = squareToRC(dragStart.square);
    const from = { row: fromRC.row, col: fromRC.col };
    let to = null;
    if (drop) to = { row: drop.row, col: drop.col };

    // cleanup highlight/dragging class (we will animate)
    clearHighlights();
    draggingEl.classList.remove("dragging");

    // if valid drop and different square -> emit move
    if (to && (to.row !== from.row || to.col !== from.col)) {
      handleMove(from, to);
      // we will wait server 'move' event to animate piece to final position
      // but to keep immediate feel, animate the piece to target square now (optimistic)
      const toSquare = rcToSquare(to.row, to.col);
      const { x, y } = squareToPixels(toSquare);
      draggingEl.style.transform = `translate(${x}px, ${y}px)`;
      draggingEl.dataset.square = toSquare;
    } else {
      // snap back visually
      const { x, y } = squareToPixels(dragStart.square);
      draggingEl.style.transform = `translate(${x}px, ${y}px)`;
    }

    // reset state
    draggingEl = null;
    dragPointerId = null;
    dragStart = null;
    selectedSource = null;
    selectedElement = null;
  });

  // pointercancel (treat like pointerup)
  pieceEl.addEventListener("pointercancel", (ev) => {
    if (!draggingEl || dragPointerId !== ev.pointerId) return;
    try { pieceEl.releasePointerCapture(ev.pointerId); } catch (e) {}
    // snap back
    const { x, y } = squareToPixels(dragStart.square);
    draggingEl.style.transform = `translate(${x}px, ${y}px)`;
    draggingEl.classList.remove("dragging");
    draggingEl = null;
    dragPointerId = null;
    dragStart = null;
    clearHighlights();
  });

  // click (tap-to-tap) selection — note pointerdown already handles drag start; this is quick click selection
  pieceEl.addEventListener("click", (e) => {
    // ignore clicks while dragging
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

// ----------------- DOM helpers for moves ----------------
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
    // fallback: re-render
    renderBoard();
    return;
  }

  const { x, y } = squareToPixels(toSquare);
  // ensure transition is present for snap animation
  el.style.transition = `transform ${TRANS_MS}ms ease-in-out`;
  el.style.transform = `translate(${x}px, ${y}px)`;

  // after animation, update dataset and image if promotion
  setTimeout(() => {
    el.dataset.square = toSquare;
    if (promotion) {
      // change image src to promoted piece (default queen)
      const newImg = `/pieces/${color}${promotion.toUpperCase()}.svg`;
      const imgEl = el.querySelector("img.piece-img");
      if (imgEl) imgEl.src = newImg;
    }
    el.style.transition = `transform ${TRANS_MS}ms ease-in-out`;
  }, TRANS_MS + 10);
}

// ---------------- SOCKET EVENTS ----------------
socket.on("matched", d => {
  if (d && d.roomId && d.role) {
    localStorage.setItem("quickplayRole", d.role);
    window.location = `/room/${d.roomId}`;
  }
});

socket.on("waiting", d => {
  document.getElementById("game").classList.add("hidden");
  document.getElementById("waiting").classList.remove("hidden");
  document.getElementById("wait-text").innerText = d.text || "";
  if (d.link) document.getElementById("room-link").innerText = d.link;
});

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

  // build board once
  chess.load(data.fen);
  renderBoard();
  updateTimers(data.timers);
});

socket.on("boardstate", fen => {
  chess.load(fen);
  renderBoard();
  clearSelectionUI();
});

// move event — animate single piece
socket.on("move", mv => {
  try {
    // check if target had a piece before move
    const capturedBefore = chess.get(mv.to);

    // apply to internal board (to keep consistency)
    const res = chess.move(mv, { sloppy: true });
    if (!res) { renderBoard(); return; }

    // remove captured piece element (if any)
    if (capturedBefore) removePieceElement(mv.to);

    // animate the moving piece
    // If the moving piece was already moved optimistically by drag, the dataset might already be set to dest.
    // We move from 'from' to 'to' in DOM to ensure visual correctness.
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

// reset
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

// On load — join room with quickRole (if present)
if (ROOM_ID) {
  const quickRole = localStorage.getItem("quickplayRole");
  socket.emit("joinRoom", { roomId: ROOM_ID, role: quickRole });
}