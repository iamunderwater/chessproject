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
let dragged = null;
let source = null;

// For tap-to-tap movement
let selectedSource = null;
let selectedElement = null;

// Timer formatting
const fmt = s =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

// Convert chess piece → svg path
const pieceImage = p => {
  const t = { k: "K", q: "Q", r: "R", b: "B", n: "N", p: "P" };
  return `/pieces/${p.color}${t[p.type]}.svg`;
};

/* ------------------ MOVE HIGHLIGHT HELPERS ------------------ */
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

    const sq = document.querySelector(
      `.square[data-row='${r}'][data-col='${c}']`
    );
    if (!sq) return;

    if (mv.flags.includes("c")) sq.classList.add("capture");
    else sq.classList.add("dot");
  });
}

function clearSelectionUI() {
  if (selectedElement) selectedElement.classList.remove("selected");
  selectedElement = null;
  selectedSource = null;
  clearHighlights();
}

/* ------------------ BOARD RENDER ------------------ */
function renderBoard() {
  const board = chess.board();
  boardEl.innerHTML = "";

  board.forEach((row, r) => {
    row.forEach((sq, c) => {
      const cell = document.createElement("div");
      cell.classList.add("square", (r + c) % 2 ? "dark" : "light");
      cell.dataset.row = r;
      cell.dataset.col = c;

      /* --- tap square to move selected piece --- */
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

        /* ------------------ DESKTOP DRAG START ------------------ */
        piece.addEventListener("dragstart", e => {
          if (!piece.draggable) return;

          dragged = piece;
          source = { row: r, col: c };
          e.dataTransfer.setData("text/plain", "");

          const dragImg = img.cloneNode(true);
          dragImg.style.position = "absolute";
          dragImg.style.top = "-9999px";
          dragImg.style.background = "transparent";
          document.body.appendChild(dragImg);
          e.dataTransfer.setDragImage(
            dragImg,
            dragImg.width / 2,
            dragImg.height / 2
          );

          highlightMoves(r, c);
          piece.classList.add("dragging");
        });

        /* ------------------ DESKTOP DRAG END ------------------ */
        piece.addEventListener("dragend", () => {
          dragged = null;
          source = null;
          piece.classList.remove("dragging");
          const clone = document.querySelector("body > img[style*='-9999px']");
          if (clone) clone.remove();
          clearHighlights();
        });

        /* ------------------ MOBILE TAP SELECT ------------------ */
        piece.addEventListener(
          "touchstart",
          e => {
            if (role !== sq.color) return;
            e.preventDefault();

            clearSelectionUI();
            selectedSource = { row: r, col: c };
            selectedElement = piece;
            selectedElement.classList.add("selected");
            highlightMoves(r, c);
          },
          { passive: false }
        );

        /* ------------------ CLICK SELECT ------------------ */
        piece.addEventListener("click", e => {
          if (role !== sq.color) return;

          if (selectedSource &&
              selectedSource.row === r &&
              selectedSource.col === c) {
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

      /* --- desktop drop --- */
      cell.addEventListener("dragover", e => e.preventDefault());
      cell.addEventListener("drop", e => {
        e.preventDefault();
        if (dragged) {
          handleMove(source, { row: r, col: c });
          clearHighlights();
        }
      });

      boardEl.appendChild(cell);
    });
  });

  if (role === "b") boardEl.classList.add("flipped");
  else boardEl.classList.remove("flipped");

  clearHighlights();
}

/* ------------------ MOVE HANDLER ------------------ */
function handleMove(s, t) {
  if (!s) return;
  const mv = {
    from: `${String.fromCharCode(97 + s.col)}${8 - s.row}`,
    to: `${String.fromCharCode(97 + t.col)}${8 - t.row}`,
    promotion: "q"
  };
  socket.emit("move", mv);
}

/* ------------------ SOCKET EVENTS ------------------ */
socket.on("init", data => {
  role = data.role;
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
  const res = chess.move(mv);
  renderBoard();
  clearSelectionUI();
  (res && res.captured ? captureSound : moveSound).play();
});

socket.on("timers", t => updateTimers(t));

socket.on("gameover", winner => {
  let msg = "";

  if (winner.includes("(timeout)")) {
    if (role === "w" && winner.startsWith("White")) msg = "EZ Timeout Win 😎";
    else if (role === "b" && winner.startsWith("Black"))
      msg = "Time’s up, victory is mine 🕒🔥";
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

playAgain.onclick = () => {
  socket.emit("resetgame");
  popup.classList.remove("show");
};

/* ------------------ TIMERS ------------------ */
function updateTimers(t) {
  if (role === "b") {
    bottomTimer.innerText = fmt(t.b);
    topTimer.innerText = fmt(t.w);
  } else {
    bottomTimer.innerText = fmt(t.w);
    topTimer.innerText = fmt(t.b);
  }
}