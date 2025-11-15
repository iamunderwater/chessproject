const socket = io();
const chess = new Chess();

// DOM references
let boardEl, popup, popupText, playAgain;

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

const pieceImage = p => {
  const t = { k: "K", q: "Q", r: "R", b: "B", n: "N", p: "P" };
  return `/pieces/${p.color}${t[p.type]}.svg`;
};

// ---------------- HIGHLIGHTS ----------------
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
    if (mv.flags.includes("c")) sq.classList.add("capture");
    else sq.classList.add("dot");
  });
}

function clearSelectionUI() {
  if (selectedElement) selectedElement.classList.remove("selected");
  selectedSource = null;
  selectedElement = null;
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

      // Tap move
      cell.addEventListener("click", () => {
        if (selectedSource) {
          handleMove(selectedSource, { row: r, col: c });
          clearSelectionUI();
        }
      });

      // Touch move
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
        piece.classList.add("piece");
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

          // FIXED SMALL DRAG IMAGE
          const dragImg = img.cloneNode(true);
          dragImg.style.position = "absolute";
          dragImg.style.top = "-9999px";
          dragImg.style.width = "50px";
          dragImg.style.height = "50px";
          document.body.appendChild(dragImg);
          e.dataTransfer.setDragImage(dragImg, 25, 25);

          highlightMoves(r, c);
          piece.classList.add("selected");
        });

        // -------- Desktop dragend --------
        piece.addEventListener("dragend", () => {
          dragged = null;
          source = null;

          const clone = document.querySelector("body > img[style*='-9999px']");
          if (clone) clone.remove();

          renderBoard();
        });

        // -------- Mobile drag --------
        piece.addEventListener(
          "touchstart",
          e => {
            if (role !== sq.color) return;

            e.preventDefault();

            touchDrag.active = true;
            touchDrag.startSquare = { row: r, col: c };

            const floating = img.cloneNode(true);
            floating.style.position = "fixed";
            floating.style.left = `${e.touches[0].clientX}px`;
            floating.style.top = `${e.touches[0].clientY}px`;
            floating.style.transform = "translate(-50%, -50%)";
            floating.style.zIndex = 5000;
            floating.style.pointerEvents = "none";
            floating.style.width = "60px";
            floating.style.height = "60px";
            document.body.appendChild(floating);

            touchDrag.floating = floating;

            highlightMoves(r, c);

            selectedSource = { row: r, col: c };
            selectedElement = piece;
            piece.classList.add("selected");
          },
          { passive: false }
        );

        piece.addEventListener(
          "touchmove",
          e => {
            if (!touchDrag.active || !touchDrag.floating) return;
            e.preventDefault();

            const t = e.touches[0];
            touchDrag.floating.style.left = `${t.clientX}px`;
            touchDrag.floating.style.top = `${t.clientY}px`;

            const sqEl = document.elementFromPoint(t.clientX, t.clientY)?.closest(".square");
            if (!sqEl) return;

            touchDrag.lastTargetSquare = {
              row: +sqEl.dataset.row,
              col: +sqEl.dataset.col
            };
          },
          { passive: false }
        );

        piece.addEventListener(
          "touchend",
          e => {
            if (!touchDrag.active) return;

            if (touchDrag.floating) touchDrag.floating.remove();

            if (touchDrag.lastTargetSquare) {
              handleMove(touchDrag.startSquare, touchDrag.lastTargetSquare);
            }

            touchDrag = {
              active: false,
              startSquare: null,
              floating: null,
              lastTargetSquare: null
            };

            clearSelectionUI();
          },
          { passive: false }
        );

        // Click select
        piece.addEventListener("click", () => {
          if (role !== sq.color) return;

          if (selectedSource &&
              selectedSource.row === r &&
              selectedSource.col === c) {
            clearSelectionUI();
          } else {
            clearSelectionUI();
            selectedSource = { row: r, col: c };
            selectedElement = piece;
            piece.classList.add("selected");
            highlightMoves(r, c);
          }
        });

        cell.appendChild(piece);
      }

      cell.addEventListener("dragover", e => e.preventDefault());
      cell.addEventListener("drop", e => {
        e.preventDefault();
        if (dragged && source) {
          handleMove(source, { row: r, col: c });
        }
      });

      boardEl.appendChild(cell);
    });
  });

  if (role === "b") boardEl.classList.add("flipped");
  else boardEl.classList.remove("flipped");
}

// ---------------- HANDLE MOVES ----------------
function handleMove(s, t) {
  const mv = {
    from: `${String.fromCharCode(97 + s.col)}${8 - s.row}`,
    to:   `${String.fromCharCode(97 + t.col)}${8 - t.row}`,
    promotion: "q"
  };
  socket.emit("move", { roomId: ROOM_ID, move: mv });
}

// ---------------- TIMERS ----------------
function updateTimers(t) {
  if (!t) return;

  if (role === "w") {
    leftLabel("Opponent (Black)");
    rightLabel("You (White)");
    leftTime(t.b);
    rightTime(t.w);
  } else if (role === "b") {
    leftLabel("Opponent (White)");
    rightLabel("You (Black)");
    leftTime(t.w);
    rightTime(t.b);
  } else {
    leftLabel("White");
    rightLabel("Black");
    leftTime(t.w);
    rightTime(t.b);
  }
}

function leftLabel(x)  { document.getElementById("left-label").innerText = x; }
function rightLabel(x) { document.getElementById("right-label").innerText = x; }
function leftTime(x)   { document.getElementById("left-time").innerText  = fmt(x); }
function rightTime(x)  { document.getElementById("right-time").innerText = fmt(x); }

// ---------------- SOCKETS ----------------
socket.on("matched", d => {
  if (d.roomId) window.location = `/room/${d.roomId}`;
});

socket.on("init", data => {
  role = data.role;
  boardEl = document.querySelector(".chessboard");
  popup = document.getElementById("popup");
  popupText = document.getElementById("popup-text");
  playAgain = document.getElementById("play-again");

  chess.load(data.fen);
  renderBoard();
  updateTimers(data.timers);
});

socket.on("boardstate", fen => {
  chess.load(fen);
  renderBoard();
});

socket.on("move", mv => {
  const res = chess.move(mv);
  renderBoard();

  if (chess.in_check()) checkSound.play();
  else if (res?.captured) captureSound.play();
  else moveSound.play();
});

socket.on("timers", t => updateTimers(t));

socket.on("gameover", winner => {
  let txt = winner.includes("timeout")
    ? (role === winner[0].toLowerCase() ? "You Win! ⏳" : "Lost on Time 💀")
    : winner === "Draw"
      ? "Draw Game"
      : role === winner[0].toLowerCase()
        ? "You Win!"
        : "You Lose!";

  document.getElementById("popup-text").innerText = txt;
  document.getElementById("popup").classList.add("show");
  endSound.play();
});

playAgain.onclick = () => {
  socket.emit("resetgame", ROOM_ID);
  popup.classList.remove("show");
};

socket.emit("joinRoom", ROOM_ID);