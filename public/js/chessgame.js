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
// NOTE: Make sure you have these sound files in a /public/sounds/ directory
const moveSound = new Audio("/sounds/move.mp3");
const captureSound = new Audio("/sounds/capture.mp3");
const endSound = new Audio("/sounds/gameover.mp3");
const checkSound = new Audio("/sounds/check.mp3");

// Format timer
const fmt = s =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

// Piece images
// NOTE: Make sure you have these images in a /public/pieces/ directory
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
function renderBoard() {
  const board = chess.board();
  boardEl.innerHTML = "";

  board.forEach((row, r) => {
    row.forEach((sq, c) => {
      const cell = document.createElement("div");
      cell.classList.add("square", (r + c) % 2 ? "dark" : "light");
      cell.dataset.row = r;
      cell.dataset.col = c;

      // Tap-to-tap move (cell click)
      cell.addEventListener("click", () => {
        if (selectedSource) {
          handleMove(selectedSource, { row: r, col: c });
          clearSelectionUI();
        }
      });

      // Tap-to-tap move (cell touchend)
      // This helps when tapping an empty square
      cell.addEventListener(
        "touchend",
        e => {
          if (selectedSource) {
            e.preventDefault();
            handleMove(selectedSource, { row: r, col: c });
            clearSelectionUI();
          }
        },
        { passive: false }
      );

      if (sq) {
        const piece = document.createElement("div");
        piece.classList.add("piece", sq.color === "w" ? "white" : "black");

        const img = document.createElement("img");
        img.src = pieceImage(sq);
        img.classList.add("piece-img");
        piece.appendChild(img);

        piece.draggable = role === sq.color;

        // -------- Desktop dragstart --------
        piece.addEventListener("dragstart", e => {
          if (!piece.draggable) return;
          dragged = piece;
          source = { row: r, col: c };
          e.dataTransfer.setData("text/plain", "");

          // custom drag image
          const dragImg = img.cloneNode(true);
          dragImg.style.position = "absolute";
          dragImg.style.top = "-9999px";
          document.body.appendChild(dragImg);
          e.dataTransfer.setDragImage(dragImg, dragImg.width / 2, dragImg.height / 2);

          highlightMoves(r, c);
          piece.classList.add("dragging");
        });

        // -------- Desktop dragend --------
        piece.addEventListener("dragend", () => {
          dragged = null;
          source = null;
          piece.classList.remove("dragging");

          const clone = document.querySelector("body > img[style*='-9999px']");
          if (clone) clone.remove();

          clearHighlights();
        });

        // -------- Mobile touchstart (on piece) --------
        piece.addEventListener(
          "touchstart",
          e => {
            e.preventDefault();
            if (role !== sq.color) {
              clearSelectionUI();
              return;
            }

            // start mobile drag
            touchDrag.active = true;
            touchDrag.startSquare = { row: r, col: c };
            touchDrag.lastTargetSquare = null;

            // *** FIXED: Get rendered size for responsive clone ***
            const pieceSize = img.getBoundingClientRect().width;
            const floating = img.cloneNode(true);
            floating.style.width = `${pieceSize}px`;
            floating.style.height = `${pieceSize}px`;
            floating.style.position = "fixed";
            floating.style.left = `${e.touches[0].clientX}px`;
            floating.style.top = `${e.touches[0].clientY}px`;
            floating.style.transform = "translate(-50%, -50%)";
            floating.style.zIndex = 9999;
            floating.style.pointerEvents = "none";
            document.body.appendChild(floating);
            touchDrag.floating = floating;

            highlightMoves(r, c);

            clearSelectionUI();
            selectedSource = { row: r, col: c };
            selectedElement = piece;
            selectedElement.classList.add("selected");

            // *** FIXED: Attach move/end listeners to document ***
            document.addEventListener("touchmove", handleTouchMove, { passive: false });
            document.addEventListener("touchend", handleTouchEnd, { passive: false });
            document.addEventListener("touchcancel", handleTouchEnd, { passive: false });
          },
          { passive: false }
        );

        // -------- Click selection (tap-to-tap) --------
        piece.addEventListener("click", () => {
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

        cell.appendChild(piece);
      }

      // Desktop drop
      cell.addEventListener("dragover", e => e.preventDefault());
      cell.addEventListener("drop", e => {
        e.preventDefault();
        if (dragged && source) {
          handleMove(source, { row: r, col: c });
        }
        clearHighlights();
      });

      boardEl.appendChild(cell);
    });
  });

  if (role === "b") boardEl.classList.add("flipped");
  else boardEl.classList.remove("flipped");

  // Don't clear highlights here, renderBoard is called after
  // a move, but we might want to see the move highlights
  // clearHighlights();
}

// ---------------- MOBILE DRAG HANDLERS ----------------
// *** FIXED: These are now global functions, not event listeners on the piece ***

function handleTouchMove(e) {
  if (!touchDrag.active || !touchDrag.floating) return;
  e.preventDefault();
  const t = e.touches[0];
  touchDrag.floating.style.left = `${t.clientX}px`;
  touchDrag.floating.style.top = `${t.clientY}px`;

  const el = document.elementFromPoint(t.clientX, t.clientY);
  if (!el) return;
  const sqEl = el.closest(".square");
  if (!sqEl) {
    touchDrag.lastTargetSquare = null;
    return;
  }

  touchDrag.lastTargetSquare = {
    row: parseInt(sqEl.dataset.row),
    col: parseInt(sqEl.dataset.col)
  };
}

function handleTouchEnd(e) {
  if (!touchDrag.active) return;
  e.preventDefault();

  let target = touchDrag.lastTargetSquare;

  if (!target) {
    // Fallback if elementFromPoint failed (e.g., finger lifted too fast)
    const t = e.changedTouches[0];
    const el = document.elementFromPoint(t.clientX, t.clientY);
    const sqEl = el && el.closest(".square");
    if (sqEl) {
      target = {
        row: parseInt(sqEl.dataset.row),
        col: parseInt(sqEl.dataset.col)
      };
    }
  }

  if (touchDrag.floating) touchDrag.floating.remove();

  if (target && touchDrag.startSquare) {
    handleMove(touchDrag.startSquare, target);
  } else {
    // This was likely a tap, not a drag, so we keep the selection
    // The 'click' listener on the piece will handle selection logic
  }

  // Reset touch drag state
  touchDrag = {
    active: false,
    startSquare: null,
    floating: null,
    lastTargetSquare: null
  };

  clearHighlights();

  // *** FIXED: Remove document-level listeners ***
  document.removeEventListener("touchmove", handleTouchMove);
  document.removeEventListener("touchend", handleTouchEnd);
  document.removeEventListener("touchcancel", handleTouchEnd);
}


// ---------------- HANDLE MOVES ----------------
function handleMove(s, t) {
  if (!s) return;
  if (s.row === t.row && s.col === t.col) {
      // If it's a tap on the same square, let the click handler manage selection
      return;
  }

  const mv = {
    from: `${String.fromCharCode(97 + s.col)}${8 - s.row}`,
    to: `${String.fromCharCode(97 + t.col)}${8 - s.row}`,
    promotion: "q" // Always promote to queen for simplicity
  };

  // Optimistically make the move locally for sound prediction
  // This is okay because the server will send the true state anyway
  const localMove = chess.move(mv);
  if (localMove) {
      // Play sound immediately
      if (chess.in_check()) {
          checkSound.play();
      } else if (localMove.captured) {
          captureSound.play();
      } else {
          moveSound.play();
      }
      chess.undo(); // Undo, we wait for the server's "boardupdate"
  }


  socket.emit("move", { roomId: ROOM_ID, move: mv });
  
  // After sending move, clear local selection
  clearSelectionUI();
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
  if (d && d.roomId) {
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
  role = data.role;

  // *** EDITED: Show 'waiting' or 'game' based on role ***
  // Spectators and P2 (black) show game immediately.
  // P1 (white) will show 'waiting' first.
  if (role === 'b' || role === null) {
    document.getElementById("game").classList.remove("hidden");
  } else if (role === 'w') {
    // P1 will see 'waiting' until 'startgame' is received
    document.getElementById("waiting").classList.remove("hidden");
  }


  // Assign DOM elements
  boardEl = document.querySelector(".chessboard");
  popup = document.getElementById("popup");
  popupText = document.getElementById("popup-text");
  playAgain = document.getElementById("play-again");
  topTimer = document.getElementById("top-timer");
  bottomTimer = document.getElementById("bottom-timer");
  
  // Add reset button listener
  playAgain.onclick = () => {
    socket.emit("resetgame", ROOM_ID);
    popup.classList.remove("show");
  };

  // *** EDITED: Load board/timers ONLY if game is visible ***
  // (i.e., for P2 and spectators)
  if (role !== 'w') {
    chess.load(data.fen);
    renderBoard();
    updateTimers(data.timers);
  }
});

// *** ADDED: New handler for 'startgame' event ***
socket.on("startgame", data => {
  // Hide waiting screen and show game
  document.getElementById("waiting").classList.add("hidden");
  document.getElementById("game").classList.remove("hidden");

  // Assign DOM elements if they haven't been (e.g., for Player 1)
  if (!boardEl) {
    boardEl = document.querySelector(".chessboard");
    popup = document.getElementById("popup");
    popupText = document.getElementById("popup-text");
    playAgain = document.getElementById("play-again");
    topTimer = document.getElementById("top-timer");
    bottomTimer = document.getElementById("bottom-timer");
    
    // Add reset button listener
    playAgain.onclick = () => {
      socket.emit("resetgame", ROOM_ID);
      popup.classList.remove("show");
    };
  }

  // Now load the board and timers
  chess.load(data.fen);
  renderBoard();
  updateTimers(data.timers);
});

// -------- BOARD UPDATE (REPLACES 'boardstate' and 'move') --------
// *** FIXED: This is the new single source of truth for board changes ***
socket.on("boardupdate", data => {
  if (!data || !data.fen) return;

  chess.load(data.fen); // Load the new state. This is the source of truth.
  renderBoard();
  clearSelectionUI();

  // Play sounds based on the flags from the server
  if (data.in_check) {
    checkSound.play();
    return; // Check sound overrides others
  }

  if (data.flags && data.flags.includes("c")) {
    captureSound.play();
  } else if (data.move) {
    // Only play move sound if it wasn't a capture or check
    moveSound.play();
  }
});


// -------- TIMERS --------
socket.on("timers", t => updateTimers(t));

// -------- GAME OVER --------
socket.on("gameover", winner => {
  let txt = "";

  if (winner.includes("timeout")) {
    if (role === "w" && winner.startsWith("White")) txt = "EZ Timeout Win 😎";
    else if (role ===b" && winner.startsWith("Black"))
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

// -------- JOIN ROOM ON PAGE LOAD --------
if (ROOM_ID) {
  socket.emit("joinRoom", ROOM_ID);
}