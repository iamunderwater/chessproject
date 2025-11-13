const socket = io();
const chess = new Chess();
const boardEl = document.querySelector(".chessboard");
const popup = document.getElementById("popup");
const popupText = document.getElementById("popup-text");
const playAgain = document.getElementById("play-again");
const topTimer = document.getElementById("top-timer");
const bottomTimer = document.getElementById("bottom-timer");

const moveSound = new Audio("/sounds/move.mp3");
const captureSound = new Audio("/sounds/capture.mp3");
const endSound = new Audio("/sounds/gameover.mp3");

let role = null;

// Desktop variables
let dragged = null;
let source = null;

// Tap-to-tap selection
let selectedSource = null;
let selectedElement = null;

// Mobile drag variables
let touchDrag = {
  active: false,           // are we mobile-dragging right now
  startSquare: null,       // {row,col}
  floating: null,          // DOM element for floating piece
  lastTargetSquare: null   // last square under finger
};

// helpers
const fmt = s =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

const pieceImage = p => {
  const t = { k: "K", q: "Q", r: "R", b: "B", n: "N", p: "P" };
  return `/pieces/${p.color}${t[p.type]}.svg`;
};

/* ---------------- HIGHLIGHT HELPERS ---------------- */
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

/* ---------------- BOARD RENDER ---------------- */
function renderBoard() {
  const board = chess.board();
  boardEl.innerHTML = "";

  board.forEach((row, r) => {
    row.forEach((sq, c) => {
      const cell = document.createElement("div");
      cell.classList.add("square", (r + c) % 2 ? "dark" : "light");
      cell.dataset.row = r;
      cell.dataset.col = c;

      // click on square => if tap-selected piece exists, move there
      cell.addEventListener("click", () => {
        if (selectedSource) {
          handleMove(selectedSource, { row: r, col: c });
          clearSelectionUI();
        }
      });

      // touchend for tap-to-tap mobile
      cell.addEventListener("touchend", (e) => {
        if (selectedSource) {
          e.preventDefault();
          handleMove(selectedSource, { row: r, col: c });
          clearSelectionUI();
        }
      }, { passive: false });

      if (sq) {
        const piece = document.createElement("div");
        piece.classList.add("piece", sq.color === "w" ? "white" : "black");

        const img = document.createElement("img");
        img.src = pieceImage(sq);
        img.classList.add("piece-img");
        piece.appendChild(img);

        // draggable only if the client controls this color
        piece.draggable = role === sq.color;

        /* ---------- Desktop dragstart ---------- */
        piece.addEventListener("dragstart", (e) => {
          if (!piece.draggable) return;
          // standard desktop behavior
          dragged = piece;
          source = { row: r, col: c };
          e.dataTransfer.setData("text/plain", "");

          // create hidden drag image (piece only)
          const dragImg = img.cloneNode(true);
          dragImg.style.position = "absolute";
          dragImg.style.top = "-9999px";
          dragImg.style.background = "transparent";
          document.body.appendChild(dragImg);
          // center the image under cursor
          e.dataTransfer.setDragImage(dragImg, dragImg.width / 2, dragImg.height / 2);

          highlightMoves(r, c);
          piece.classList.add("dragging");
        });

        /* ---------- Desktop dragend ---------- */
        piece.addEventListener("dragend", () => {
          dragged = null;
          source = null;
          piece.classList.remove("dragging");
          const clone = document.querySelector("body > img[style*='-9999px']");
          if (clone) clone.remove();
          clearHighlights();
        });

        /* ---------- Mobile touchstart (start drag or select) ---------- */
        piece.addEventListener("touchstart", (e) => {
          // allow spectator to tap but not start a drag
          e.preventDefault();

          // if user controls piece color -> begin mobile drag mode
          if (role === sq.color) {
            // initialize touch drag state
            touchDrag.active = true;
            touchDrag.startSquare = { row: r, col: c };
            touchDrag.lastTargetSquare = null;

            // create floating piece image (same size)
            const floating = img.cloneNode(true);
            floating.style.position = "fixed";
            floating.style.left = `${e.touches[0].clientX}px`;
            floating.style.top = `${e.touches[0].clientY}px`;
            floating.style.transform = "translate(-50%, -50%)";
            floating.style.zIndex = 9999;
            floating.style.pointerEvents = "none";
            floating.classList.add("floating-piece");
            document.body.appendChild(floating);
            touchDrag.floating = floating;

            // show legal moves
            highlightMoves(r, c);

            // also set tap-select state so quick taps still work
            clearSelectionUI();
            selectedSource = { row: r, col: c };
            selectedElement = piece;
            selectedElement.classList.add("selected");
          } else {
            // if not player's piece but they tap, just select nothing
            clearSelectionUI();
          }
        }, { passive: false });

        /* ---------- Mobile touchmove (floating follows finger) ---------- */
        piece.addEventListener("touchmove", (e) => {
          if (!touchDrag.active || !touchDrag.floating) return;
          e.preventDefault();
          const t = e.touches[0];
          touchDrag.floating.style.left = `${t.clientX}px`;
          touchDrag.floating.style.top = `${t.clientY}px`;

          // find square under finger
          const el = document.elementFromPoint(t.clientX, t.clientY);
          if (!el) return;
          const sqEl = el.closest(".square");
          if (!sqEl) {
            // if moved off-board, clear last target
            if (touchDrag.lastTargetSquare) {
              touchDrag.lastTargetSquare = null;
              clearHighlights();
              highlightMoves(touchDrag.startSquare.row, touchDrag.startSquare.col);
            }
            return;
          }
          const tr = parseInt(sqEl.dataset.row);
          const tc = parseInt(sqEl.dataset.col);

          // only update if changed
          if (!touchDrag.lastTargetSquare || touchDrag.lastTargetSquare.row !== tr || touchDrag.lastTargetSquare.col !== tc) {
            touchDrag.lastTargetSquare = { row: tr, col: tc };
            // show highlight for that square: keep dots but optionally emphasize destination
            // we keep dot/capture as before; no extra change required here
          }
        }, { passive: false });

        /* ---------- Mobile touchend (drop) ---------- */
        piece.addEventListener("touchend", (e) => {
          if (!touchDrag.active) {
            // might be a quick tap - handled by click/touch handlers on piece below
            return;
          }
          e.preventDefault();

          let targetSquare = null;
          if (touchDrag.lastTargetSquare) {
            targetSquare = touchDrag.lastTargetSquare;
          } else {
            // if finger lifted without moving, attempt to derive from last touch coords
            const touch = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0]);
            if (touch) {
              const el = document.elementFromPoint(touch.clientX, touch.clientY);
              if (el) {
                const sqEl = el.closest(".square");
                if (sqEl) {
                  targetSquare = { row: parseInt(sqEl.dataset.row), col: parseInt(sqEl.dataset.col) };
                }
              }
            }
          }

          // Clean up floating element
          if (touchDrag.floating) {
            touchDrag.floating.remove();
            touchDrag.floating = null;
          }

          // perform move if we have a target
          if (targetSquare) {
            handleMove(touchDrag.startSquare, targetSquare);
          } else {
            // if no target, treat it as a tap (toggle selection)
            // selection already set in touchstart
          }

          // reset mobile drag state
          touchDrag.active = false;
          touchDrag.startSquare = null;
          touchDrag.lastTargetSquare = null;

          clearHighlights();
          // keep selection highlight for tap-to-tap; if move happened we will clear on boardstate event
        }, { passive: false });

        /* ---------- Click for desktop / tap for tap->tap ---------- */
        piece.addEventListener("click", (e) => {
          // clicking only selects (or deselects) your own piece
          if (role !== sq.color) return;

          if (selectedSource && selectedSource.row === r && selectedSource.col === c) {
            clearSelectionUI();
          } else {
            clearSelectionUI();
            selectedSource = { row: r, col: c };
            selectedElement = piece;
            selectedElement.classList.add("selected");
            highlightMoves(r, c);
          }
        });

        // append piece to cell
        cell.appendChild(piece);
      }

      // Desktop drop handling
      cell.addEventListener("dragover", (e) => e.preventDefault());
      cell.addEventListener("drop", (e) => {
        e.preventDefault();
        if (dragged && source) {
          handleMove(source, { row: r, col: c });
        }
        clearHighlights();
      });

      boardEl.appendChild(cell);
    });
  });

  // flip board for black (only grid rotates; pieces stay upright)
  if (role === "b") boardEl.classList.add("flipped");
  else boardEl.classList.remove("flipped");

  // ensure highlights cleared if necessary
  clearHighlights();
}

/* ---------------- HANDLE MOVES ---------------- */
function handleMove(s, t) {
  if (!s) return;
  // ignore if same square
  if (s.row === t.row && s.col === t.col) return;

  const mv = {
    from: `${String.fromCharCode(97 + s.col)}${8 - s.row}`,
    to: `${String.fromCharCode(97 + t.col)}${8 - t.row}`,
    promotion: "q"
  };
  socket.emit("move", mv);
}

/* ---------------- SOCKET EVENTS ---------------- */
socket.on("init", (data) => {
  role = data.role;
  chess.load(data.fen);
  renderBoard();
  updateTimers(data.timers || { w: 300, b: 300 });
});

socket.on("boardstate", (fen) => {
  chess.load(fen);
  renderBoard();
  clearSelectionUI();
});

socket.on("move", (mv) => {
  const res = chess.move(mv);
  renderBoard();
  clearSelectionUI();
  (res && res.captured ? captureSound : moveSound).play();
});

socket.on("timers", (t) => updateTimers(t));

socket.on("gameover", (winner) => {
  let msg = "";

  if (winner.includes("(timeout)")) {
    if (role === "w" && winner.startsWith("White")) msg = "EZ Timeout Win 😎";
    else if (role === "b" && winner.startsWith("Black")) msg = "Time’s up, victory is mine 🕒🔥";
    else msg = "Skill issue? 🫵😂";
  } else if (winner === "Draw") msg = "Both are noobs";
  else if (winner === "White") {
    if (role === "w") msg = "You win 😎";
    else msg = "You lost, noob 💀";
  } else if (winner === "Black") {
    if (role === "b") msg = "You win 😎";
    else msg = "You got outplayed bro 💀";
  }

  popupText.innerText = msg;
  popup.classList.add("show");
  endSound.play();
});

/* ---------------- Play again ---------------- */
playAgain.onclick = () => {
  socket.emit("resetgame");
  popup.classList.remove("show");
};

/* ---------------- TIMERS ---------------- */
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