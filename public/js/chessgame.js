const socket = io();
const chess = new Chess();

// DOM references
let boardEl, popup, popupText, playAgain, topTimer, bottomTimer;

let role = null;

// Selection / drag state
let selectedSource = null;     // {row, col}
let selectedElement = null;    // DOM element for selected piece
let pointerDrag = {
  active: false,
  startSquare: null,           // {row,col}
  floating: null,              // DOM node clone following pointer
  moved: false,                // whether pointer moved beyond click threshold
  pointerId: null
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

// ---------------- BOARD INIT & RENDER ----------------

// compute cell size dynamically (board may be responsive)
function getCellSize() {
  if (!boardEl) return 80;
  return Math.floor(boardEl.clientWidth / 8);
}

function initBoard() {
  boardEl.innerHTML = ""; // ensure empty
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = document.createElement("div");
      cell.classList.add("square", (r + c) % 2 ? "dark" : "light");
      cell.dataset.row = r;
      cell.dataset.col = c;
      cell.style.width = `${getCellSize()}px`;
      cell.style.height = `${getCellSize()}px`;

      // Tap-to-tap: clicking a square triggers a move if a source is selected
      cell.addEventListener("click", (e) => {
        if (!selectedSource) return;
        handleMove(selectedSource, { row: r, col: c });
        clearSelectionUI();
      });

      boardEl.appendChild(cell);
    }
  }

  // keep squares sized on resize
  window.addEventListener("resize", () => {
    const cs = getCellSize();
    document.querySelectorAll(".square").forEach(sq => {
      sq.style.width = `${cs}px`;
      sq.style.height = `${cs}px`;
    });
    // re-position existing pieces to use new sizes
    positionAllPieces();
  });
}

function positionPieceEl(el, r, c) {
  const cell = getCellSize();
  // place using transform so CSS transitions animate it
  el.style.width = `${cell}px`;
  el.style.height = `${cell}px`;
  el.style.transform = `translate(${c * cell}px, ${r * cell}px)`;
}

function positionAllPieces() {
  // reposition based on data-row/col attributes on piece elements
  document.querySelectorAll(".piece").forEach(p => {
    const r = parseInt(p.dataset.row);
    const c = parseInt(p.dataset.col);
    if (Number.isFinite(r) && Number.isFinite(c)) positionPieceEl(p, r, c);
  });
}

function renderPieces() {
  // remove existing piece nodes (we will recreate with handlers)
  document.querySelectorAll(".piece").forEach(p => p.remove());

  const board = chess.board();
  const cell = getCellSize();

  board.forEach((row, r) => {
    row.forEach((sq, c) => {
      if (!sq) return;

      const piece = document.createElement("img");
      piece.src = pieceImage(sq);
      piece.classList.add("piece");
      piece.dataset.row = r;
      piece.dataset.col = c;
      piece.dataset.color = sq.color;
      piece.dataset.type = sq.type;

      // ensure correct initial sizing & position
      piece.style.position = "absolute";
      piece.style.width = `${cell}px`;
      piece.style.height = `${cell}px`;
      piece.style.left = "0";
      piece.style.top = "0";
      piece.style.zIndex = 2;
      piece.style.transition = "transform 0.15s ease-in-out";

      positionPieceEl(piece, r, c);

      // If this piece belongs to player's color, make it interactive
      // (we still allow selecting enemy pieces for watchers)
      // Use pointer events handlers for desktop & touch unified
      piece.style.touchAction = "none"; // prevent default gestures

      piece.addEventListener("pointerdown", onPiecePointerDown);
      // pointermove and pointerup are attached to window when drag starts

      // click/tap selection fallback: if pointerdown/up without move -> select
      // We'll implement selection in the pointerup handler.

      boardEl.appendChild(piece);
    });
  });

  // If something was selected before re-render, re-highlight it visually
  if (selectedSource) {
    // find piece at selectedSource and mark it
    const sel = document.querySelector(`.piece[data-row='${selectedSource.row}'][data-col='${selectedSource.col}']`);
    if (sel) {
      selectedElement = sel;
      selectedElement.classList.add("selected");
      highlightMoves(selectedSource.row, selectedSource.col);
    } else {
      clearSelectionUI();
    }
  }
}

// ----------------- POINTER / DRAG HANDLERS -----------------

function onPiecePointerDown(e) {
  // Only respond to primary button / touch
  if (e.button && e.button !== 0) return;

  const el = e.currentTarget;
  const color = el.dataset.color;

  // If player has a role and it's not their color, ignore interaction (unless watcher)
  if (role && color && role !== color) {
    // allow selection for watchers? we ignore drags
    // but still let them click to view moves (optional)
    // For now do nothing
  }

  // prevent default browser drag behavior
  e.preventDefault();

  // store pointer id
  pointerDrag.pointerId = e.pointerId;
  el.setPointerCapture && el.setPointerCapture(e.pointerId);

  // initialize drag state
  pointerDrag.active = true;
  pointerDrag.moved = false;
  pointerDrag.startSquare = { row: parseInt(el.dataset.row), col: parseInt(el.dataset.col) };

  // create floating clone that follows pointer
  const clone = el.cloneNode(true);
  clone.classList.add("floating");
  clone.style.position = "fixed";
  clone.style.width = el.style.width;
  clone.style.height = el.style.height;
  clone.style.left = `${e.clientX - parseInt(el.style.width)/2}px`;
  clone.style.top = `${e.clientY - parseInt(el.style.height)/2}px`;
  clone.style.transform = "none";
  clone.style.transition = "none";
  clone.style.zIndex = 9999;
  clone.style.pointerEvents = "none";
  document.body.appendChild(clone);
  pointerDrag.floating = clone;

  // small delay before we consider this a drag; if pointer doesn't move, treat as click
  // attach move/up handlers globally
  window.addEventListener("pointermove", onWindowPointerMove);
  window.addEventListener("pointerup", onWindowPointerUp);
  window.addEventListener("pointercancel", onWindowPointerUp);

  // mark selection UI (tap-to-tap)
  clearSelectionUI();
  selectedSource = { row: pointerDrag.startSquare.row, col: pointerDrag.startSquare.col };
  selectedElement = el;
  selectedElement.classList.add("selected");
  highlightMoves(selectedSource.row, selectedSource.col);
}

function onWindowPointerMove(ev) {
  if (!pointerDrag.active || ev.pointerId !== pointerDrag.pointerId) return;
  ev.preventDefault();
  pointerDrag.moved = true;

  // move floating clone
  if (pointerDrag.floating) {
    pointerDrag.floating.style.left = `${ev.clientX - pointerDrag.floating.clientWidth / 2}px`;
    pointerDrag.floating.style.top = `${ev.clientY - pointerDrag.floating.clientHeight / 2}px`;
  }
}

function onWindowPointerUp(ev) {
  if (!pointerDrag.active || ev.pointerId !== pointerDrag.pointerId) return;
  ev.preventDefault();

  // find drop target square from pointer position
  let targetSquare = null;
  const elAt = document.elementFromPoint(ev.clientX, ev.clientY);
  if (elAt) {
    const sqEl = elAt.closest(".square");
    if (sqEl) {
      targetSquare = {
        row: parseInt(sqEl.dataset.row),
        col: parseInt(sqEl.dataset.col)
      };
    }
  }

  // remove floating clone
  if (pointerDrag.floating) pointerDrag.floating.remove();

  // if pointer never moved (a click), then toggle selection instead of move
  if (!pointerDrag.moved) {
    // clicking the piece again toggles selection off
    if (selectedSource && selectedSource.row === pointerDrag.startSquare.row && selectedSource.col === pointerDrag.startSquare.col) {
      // toggle off
      clearSelectionUI();
    } else {
      // select that piece (we already selected in pointerdown)
      selectedSource = { row: pointerDrag.startSquare.row, col: pointerDrag.startSquare.col };
      // highlight moves already done
    }
  } else {
    // pointer moved => attempt move if dropped on square
    if (targetSquare) {
      handleMove(pointerDrag.startSquare, targetSquare);
    }
    clearSelectionUI();
  }

  // cleanup
  pointerDrag.active = false;
  pointerDrag.floating = null;
  pointerDrag.pointerId = null;
  pointerDrag.moved = false;

  window.removeEventListener("pointermove", onWindowPointerMove);
  window.removeEventListener("pointerup", onWindowPointerUp);
  window.removeEventListener("pointercancel", onWindowPointerUp);
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

// QUICK PLAY MATCHED
socket.on("matched", d => {
  if (d && d.roomId && d.role) {
    // save role for joinRoom
    localStorage.setItem("quickplayRole", d.role);
    window.location = `/room/${d.roomId}`;
  }
});

// WAITING SCREEN
socket.on("waiting", d => {
  document.getElementById("game").classList.add("hidden");
  document.getElementById("waiting").classList.remove("hidden");

  document.getElementById("wait-text").innerText = d.text;

  if (d.link) {
    document.getElementById("room-link").innerText = d.link;
  }
});

// INITIAL SETUP
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

// BOARD UPDATE
socket.on("boardstate", fen => {
  chess.load(fen);
  renderPieces();
  clearSelectionUI();
});

// MOVE EVENT
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

// TIMERS
socket.on("timers", t => updateTimers(t));

// GAME OVER
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
    txt = role === "b' ? 'You win 😎' : 'You got outplayed bro 💀';
  }

  popupText.innerText = txt;
  popup.classList.add("show");
  endSound.play();
});

// RESET BUTTON
document.getElementById("play-again").onclick = () => {
  socket.emit("resetgame", ROOM_ID);
  popup.classList.remove("show");
};

// JOIN ROOM ON PAGE LOAD
if (ROOM_ID) {
  const quickRole = localStorage.getItem("quickplayRole"); // "w" or "b" or null
  socket.emit("joinRoom", { roomId: ROOM_ID, role: quickRole });
}