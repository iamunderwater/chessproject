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
let dragged = null, source = null;

const fmt = s => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

const pieceImage = (p) => {
  const t = { k: "K", q: "Q", r: "R", b: "B", n: "N", p: "P" };
  return `/pieces/${p.color}${t[p.type]}.svg`;
};

function renderBoard() {
  const board = chess.board();
  boardEl.innerHTML = "";

  board.forEach((row, r) => {
    row.forEach((sq, c) => {
      const cell = document.createElement("div");
      cell.classList.add("square", (r + c) % 2 ? "dark" : "light");
      cell.dataset.row = r;
      cell.dataset.col = c;

      if (sq) {
        const div = document.createElement("div");
        div.classList.add("piece", sq.color === "w" ? "white" : "black");

        const img = document.createElement("img");
        img.src = pieceImage(sq);
        img.classList.add("piece-img");
        div.appendChild(img);

        div.draggable = role === sq.color;

        // --- Desktop Drag Start ---
        div.addEventListener("dragstart", (e) => {
          if (!div.draggable) return;

          dragged = div;
          source = { row: r, col: c };
          e.dataTransfer.setData("text/plain", "");

          // hidden drag image
          const dragImg = img.cloneNode(true);
          dragImg.style.position = "absolute";
          dragImg.style.top = "-9999px";
          dragImg.style.background = "transparent";
          document.body.appendChild(dragImg);
          e.dataTransfer.setDragImage(dragImg, dragImg.width / 2, dragImg.height / 2);

          div.classList.add("dragging");
        });

        // --- Desktop Drag End ---
        div.addEventListener("dragend", () => {
          dragged = null;
          source = null;
          div.classList.remove("dragging");
          const clone = document.querySelector("body > img[style*='-9999px']");
          if (clone) clone.remove();
        });

        // --- MOBILE TOUCH START ---
        div.addEventListener("touchstart", (e) => {
          if (!div.draggable) return;
          e.preventDefault();

          dragged = div;
          source = { row: r, col: c };
        });

        cell.appendChild(div);
      }

      // Desktop dropping
      cell.addEventListener("dragover", (e) => e.preventDefault());
      cell.addEventListener("drop", (e) => {
        e.preventDefault();
        if (!dragged) return;
        const target = { row: +cell.dataset.row, col: +cell.dataset.col };
        handleMove(source, target);
      });

      // --- MOBILE TOUCH END (tap → tap move) ---
      cell.addEventListener("touchend", (e) => {
        if (!dragged) return;
        e.preventDefault();

        const target = {
          row: +cell.dataset.row,
          col: +cell.dataset.col,
        };

        handleMove(source, target);

        dragged = null;
        source = null;
      });

      boardEl.appendChild(cell);
    });
  });

  // flip board for black
  if (role === "b") boardEl.classList.add("flipped");
  else boardEl.classList.remove("flipped");
}

function handleMove(s, t) {
  const mv = {
    from: `${String.fromCharCode(97 + s.col)}${8 - s.row}`,
    to: `${String.fromCharCode(97 + t.col)}${8 - t.row}`,
    promotion: "q",
  };
  socket.emit("move", mv);
}

// --- SOCKET EVENTS ---
socket.on("init", (data) => {
  role = data.role;
  chess.load(data.fen);
  renderBoard();
  updateTimers(data.timers);
});

socket.on("boardstate", (fen) => {
  chess.load(fen);
  renderBoard();
});

socket.on("move", (mv) => {
  const res = chess.move(mv);
  renderBoard();
  (res && res.captured ? captureSound : moveSound).play();
});

socket.on("timers", (t) => updateTimers(t));

socket.on("gameover", (winner) => {
  let message = "";

  if (winner.includes("(timeout)")) {
    if (winner.startsWith("White") && role === "w") message = "EZ Timeout Win 😎";
    else if (winner.startsWith("Black") && role === "b") message = "Time’s up, victory is mine 🕒🔥";
    else message = "Skill issue? 🫵😂";
  } else if (winner === "Draw") {
    message = "Both are noobs";
  } else if (winner === "White") {
    if (role === "w") message = "you win 😎";
    else if (role === "b") message = "You lost, noob 💀";
    else message = "Sorry, White won";
  } else if (winner === "Black") {
    if (role === "b") message = "you win 😎";
    else if (role === "w") message = "You got outplayed bro 💀";
    else message = "Black wins 💀";
  }

  popupText.innerText = message;
  popup.classList.add("show");
  endSound.play();
});

playAgain.onclick = () => {
  socket.emit("resetgame");
  popup.classList.remove("show");
};

function updateTimers(t) {
  if (role === "b") {
    bottomTimer.innerText = fmt(t.b);
    topTimer.innerText = fmt(t.w);
  } else {
    bottomTimer.innerText = fmt(t.w);
    topTimer.innerText = fmt(t.b);
  }
}