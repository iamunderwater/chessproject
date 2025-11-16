const socket = io();
const chess = new Chess();

// DOM references (some are assigned later during init)
let boardEl = null;
let popup = null;
let popupText = null;
let playAgain = null;
let topTimer = null;
let bottomTimer = null;

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

// ---------------- BOARD RENDER ----------------
function renderBoard() {
  if (!boardEl) return;
  const board = chess.board();
  if (!boardEl.dataset.initialized) {
    boardEl.innerHTML = "";
    boardEl.dataset.initialized = "1";
} else {
    return; // stop full re-render
}

  board.forEach((row, r) => {
    row.forEach((sq, c) => {
      const cell = document.createElement("div");
      cell.classList.add("square", (r + c) % 2 ? "dark" : "light");
      cell.dataset.row = r;
      cell.dataset.col = c;

      // Tap-to-tap move
      cell.addEventListener("click", () => {
        if (selectedSource) {
          handleMove(selectedSource, { row: r, col: c });
          clearSelectionUI();
        }
      });

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
          // safe guard for drag image sizes
          const w = dragImg.width || 70;
          const h = dragImg.height || 70;
          e.dataTransfer.setDragImage(dragImg, w / 2, h / 2);

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

        // -------- Mobile touchstart --------
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

            const floating = img.cloneNode(true);
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
          },
          { passive: false }
        );

        // -------- Mobile touchmove --------
        piece.addEventListener(
          "touchmove",
          e => {
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
          },
          { passive: false }
        );

        // -------- Mobile touchend --------
        piece.addEventListener(
          "touchend",
          e => {
            if (!touchDrag.active) return;

            e.preventDefault();

            let target = touchDrag.lastTargetSquare;

            if (!target) {
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

            if (target) {
              handleMove(touchDrag.startSquare, target);
            }

            touchDrag = {
              active: false,
              startSquare: null,
              floating: null,
              lastTargetSquare: null
            };

            clearHighlights();
          },
          { passive: false }
        );

        // -------- Click selection --------
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

  clearHighlights();
}

function movePieceDOM(from, to, mvResult) {
  const fromSq = document.querySelector(`.square[data-row='${from.r}'][data-col='${from.c}']`);
  const toSq   = document.querySelector(`.square[data-row='${to.r}'][data-col='${to.c}']`);

  if (!fromSq || !toSq) return;

  const piece = fromSq.querySelector(".piece");
  if (!piece) return;

  // ----- REMOVE CAPTURED PIECE -----
  if (mvResult.captured) {
    const capturedSq = toSq.querySelector(".piece");
    if (capturedSq) capturedSq.remove();

    // En-passant special capture
    if (mvResult.flags.includes("e")) {
      const capRow = from.r;
      const capCol = to.c;
      const epSq = document.querySelector(`.square[data-row='${capRow}'][data-col='${capCol}']`);
      const epPiece = epSq.querySelector(".piece");
      if (epPiece) epPiece.remove();
    }
  }

  // ----- CASTLING (move rook also) -----
  if (mvResult.flags.includes("k")) {
    // king-side
    const rookFrom = { r: from.r, c: 7 };
    const rookTo   = { r: from.r, c: 5 };

    const rookSq = document.querySelector(`.square[data-row='${rookFrom.r}'][data-col='${rookFrom.c}']`);
    const rook = rookSq.querySelector(".piece");
    const targetSq = document.querySelector(`.square[data-row='${rookTo.r}'][data-col='${rookTo.c}']`);

    if (rook && targetSq) targetSq.appendChild(rook);
  }

  if (mvResult.flags.includes("q")) {
    // queen-side castling
    const rookFrom = { r: from.r, c: 0 };
    const rookTo   = { r: from.r, c: 3 };

    const rookSq = document.querySelector(`.square[data-row='${rookFrom.r}'][data-col='${rookFrom.c}']`);
    const rook = rookSq.querySelector(".piece");
    const targetSq = document.querySelector(`.square[data-row='${rookTo.r}'][data-col='${rookTo.c}']`);

    if (rook && targetSq) targetSq.appendChild(rook);
  }

  // ----- ANIMATE KING / PIECE -----
  const rectFrom = fromSq.getBoundingClientRect();
  const rectTo = toSq.getBoundingClientRect();

  const dx = rectTo.left - rectFrom.left;
  const dy = rectTo.top - rectFrom.top;

  piece.style.transform = `translate(${dx}px, ${dy}px)`;

  setTimeout(() => {
    piece.style.transform = "";
    toSq.appendChild(piece);
  }, 150);
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
  if (!topTimer || !bottomTimer) return;
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
  const gameEl = document.getElementById("game");
  const waitEl = document.getElementById("waiting");
  if (gameEl) gameEl.classList.add("hidden");
  if (waitEl) waitEl.classList.remove("hidden");

  const wt = document.getElementById("wait-text");
  if (wt && d && d.text) wt.innerText = d.text;

  if (d && d.link) {
    const rl = document.getElementById("room-link");
    if (rl) rl.innerText = d.link;
  }
});

// -------- INITIAL SETUP --------
socket.on("init", data => {
  localStorage.removeItem("quickplayRole");
  role = data.role;

  const waitingEl = document.getElementById("waiting");
  const gameEl = document.getElementById("game");
  if (waitingEl) waitingEl.classList.add("hidden");
  if (gameEl) gameEl.classList.remove("hidden");

  boardEl = document.querySelector(".chessboard");
  popup = document.getElementById("popup");
  popupText = document.getElementById("popup-text");
  playAgain = document.getElementById("play-again");
  topTimer = document.getElementById("top-timer");
  bottomTimer = document.getElementById("bottom-timer");

  // confirm/draw boxes & buttons (safe getters)
  window.myBox = document.getElementById("my-confirm-box");
  window.myText = document.getElementById("my-confirm-text");
  window.myYes = document.getElementById("my-yes");
  window.myNo = document.getElementById("my-no");

  window.oppBox = document.getElementById("opp-confirm-box");
  window.oppText = document.getElementById("opp-confirm-text");
  window.oppYes = document.getElementById("opp-yes");
  window.oppNo = document.getElementById("opp-no");

  // draw message element
  window.drawMessage = document.getElementById("draw-message");

  // buttons
  window.resignBtn = document.getElementById("resign-btn");
  window.drawBtn = document.getElementById("draw-btn");

  // load position and render
  if (data && data.fen) chess.load(data.fen);
  renderBoard();
  updateTimers(data.timers);
});

// -------- BOARD UPDATE --------
socket.on("boardstate", fen => {
  chess.load(fen);
  renderBoard();
  clearSelectionUI();
});

// -------- MOVE EVENT --------
socket.on("move", mv => {

  // compute from-to squares
  const from = {
    r: 8 - parseInt(mv.from[1]),
    c: mv.from.charCodeAt(0) - 97
  };

  const to = {
    r: 8 - parseInt(mv.to[1]),
    c: mv.to.charCodeAt(0) - 97
  };

  // update engine first (we need flags: capture, castle etc)
  const mvResult = chess.move(mv);

  // play animation with full move info
  movePieceDOM(from, to, mvResult);

  clearSelectionUI();

  if (chess.in_check()) {
    checkSound.play();
    return;
  }

  if (mvResult && mvResult.captured) captureSound.play();
  else moveSound.play();
});

// -------- TIMERS --------
socket.on("timers", t => updateTimers(t));

// -------- DRAW OFFERED (opponent) --------
// server emits "drawOffered" when opponent offered a draw
socket.on("drawOffered", () => {
  if (window.oppText && window.oppBox) {
    window.oppText.innerText = "Opponent offers draw";
    window.oppBox.classList.remove("hidden");

    // attach handlers (replace previous to avoid multiple bindings)
    if (window.oppYes) {
      window.oppYes.onclick = () => {
        socket.emit("acceptDraw", ROOM_ID);
        window.oppBox.classList.add("hidden");
      };
    }
    if (window.oppNo) {
      window.oppNo.onclick = () => {
        socket.emit("declineDraw", ROOM_ID);
        window.oppBox.classList.add("hidden");
      };
    }
  } else {
    // fallback: show a simple popup if oppBox missing
    if (popupText && popup) {
      popupText.innerText = "Opponent offers a draw";
      popup.classList.add("show");
      setTimeout(() => popup.classList.remove("show"), 2000);
    }
  }
});

// -------- OFFER ACCEPTED/DECLINED FEEDBACK (from server) --------
socket.on("drawDeclined", () => {
  if (window.drawMessage) {
    window.drawMessage.innerText = "Opponent declined your draw request.";
    setTimeout(() => {
      if (window.drawMessage) window.drawMessage.innerText = "";
    }, 3000);
  } else if (popup && popupText) {
    popupText.innerText = "Opponent declined your draw request.";
    popup.classList.add("show");
    setTimeout(() => popup.classList.remove("show"), 2000);
  }
});

socket.on("drawAccepted", () => {
  if (popup && popupText) {
    popupText.innerText = "Draw agreed";
    popup.classList.add("show");
    setTimeout(() => popup.classList.remove("show"), 2000);
  }
});

// -------- GAME OVER --------
socket.on("gameover", winner => {
  let txt = "";

  // ========== RESIGNATION ==========
  let w = (winner || "").toString().trim().toLowerCase();

if (w.includes("resign")) {

    let whiteResigned = w.includes("white");
    let blackResigned = w.includes("black");

    if (whiteResigned) {
        txt = role === "b"
            ? "You resigned! 💀"
            : "Opponent resigned — you win! 😎";
    }
    else if (blackResigned) {
        txt = role === "w"
            ? "You resigned! 💀"
            : "Opponent resigned — you win! 😎";
    }
    else {
        // fallback (in case the server sends weird strings)
        txt = "Opponent resigned — you win! 😎";
    }
}

  // ========== TIMEOUT ==========
  else if (typeof winner === "string" && winner.includes("timeout")) {
    if (role === "w" && winner.startsWith("White")) txt = "EZ Timeout Win 😎";
    else if (role === "b" && winner.startsWith("Black"))
      txt = "Time’s up, victory is mine 🕒🔥";
    else txt = "Skill issue? 🫵😂";
  }

  // ========== DRAW ==========
  else if (winner === "Draw") txt = "Both are noobs";

  // ========== CHECKMATE ==========
  else if (winner === "White") {
    txt = role === "w" ? "You win 😎" : "You got outplayed bro 💀";
  } else if (winner === "Black") {
    txt = role === "b" ? "You win 😎" : "You got outplayed bro 💀";
  }

  if (popupText && popup) {
    popupText.innerText = txt;
    popup.classList.add("show");
  } else {
    // fallback alert (shouldn't normally be used)
    try {
      alert(txt);
    } catch (e) {}
  }

  if (endSound) {
    endSound.play();
  }
});

// -------- RESET BUTTON --------
if (document.getElementById("play-again")) {
  document.getElementById("play-again").onclick = () => {
    socket.emit("resetgame", ROOM_ID);
    if (popup) popup.classList.remove("show");
  };
}

// -------- RESIGN / DRAW buttons (client-side confirm boxes) --------
function safeAttachResignDraw() {
  if (window.resignBtn && window.myBox && window.myText && window.myYes && window.myNo) {
    window.resignBtn.onclick = () => {
      window.myText.innerText = "Are you sure you want to resign?";
      window.myBox.classList.remove("hidden");

      window.myYes.onclick = () => {
        socket.emit("resign", ROOM_ID);
        window.myBox.classList.add("hidden");
      };
      window.myNo.onclick = () => {
        window.myBox.classList.add("hidden");
      };
    };
  }

  if (window.drawBtn && window.myBox && window.myText && window.myYes && window.myNo) {
    window.drawBtn.onclick = () => {
      window.myText.innerText = "Offer a draw?";
      window.myBox.classList.remove("hidden");

      window.myYes.onclick = () => {
        socket.emit("offerDraw", ROOM_ID);
        window.myBox.classList.add("hidden");
      };
      window.myNo.onclick = () => {
        window.myBox.classList.add("hidden");
      };
    };
  }
}

// Try to attach immediately (elements present when script loaded after HTML)
// but also retry briefly if necessary (in case init hasn't run)
safeAttachResignDraw();
setTimeout(safeAttachResignDraw, 250);
setTimeout(safeAttachResignDraw, 1000);

// -------- JOIN ROOM ON PAGE LOAD --------
if (typeof ROOM_ID !== "undefined" && ROOM_ID) {
  const quickRole = localStorage.getItem("quickplayRole"); // "w" or "b" or null
  socket.emit("joinRoom", { roomId: ROOM_ID, role: quickRole });
}