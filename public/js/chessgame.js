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
function renderBoard() {
  const board = chess.board();
  boardEl.innerHTML = "";

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
  renderBoard();
  updateTimers(data.timers);
});

// -------- BOARD UPDATE --------
socket.on("boardstate", fen => {
  chess.load(fen);
  renderBoard();
  clearSelectionUI();
});

socket.on("drawOffered", () => {
  if (confirm("Your opponent offered a draw. Accept?")) {
    socket.emit("acceptDraw", ROOM_ID);
  }
});

socket.on("gameover", msg => {
  popupText.innerText = msg;
  popup.classList.add("show");
});

// -------- MOVE EVENT --------
socket.on("move", mv => {
  const res = chess.move(mv);
  renderBoard();
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

document.getElementById("resign-btn").onclick = () => {
  socket.emit("resign", ROOM_ID);
};

document.getElementById("draw-btn").onclick = () => {
  socket.emit("offerDraw", ROOM_ID);
};

// -------- JOIN ROOM ON PAGE LOAD --------
if (ROOM_ID) {
  const quickRole = localStorage.getItem("quickplayRole"); // "w" or "b" or null
  socket.emit("joinRoom", { roomId: ROOM_ID, role: quickRole });
}
const resignBtn = document.getElementById("resign-btn");
const drawBtn = document.getElementById("draw-btn");

const myBox = document.getElementById("my-confirm-box");
const myText = document.getElementById("my-confirm-text");
const myYes = document.getElementById("my-yes");
const myNo = document.getElementById("my-no");

const oppBox = document.getElementById("opp-confirm-box");
const oppText = document.getElementById("opp-confirm-text");
const oppYes = document.getElementById("opp-yes");
const oppNo = document.getElementById("opp-no");


// ---------------- RESIGN ----------------
resignBtn.onclick = () => {
    myText.innerText = "Are you sure you want to resign?";
    myBox.classList.remove("hidden");

    myYes.onclick = () => {
        socket.emit("resign", ROOM_ID);
        myBox.classList.add("hidden");
    };
    myNo.onclick = () => {
        myBox.classList.add("hidden");
    };
};


// ---------------- DRAW OFFER ----------------
drawBtn.onclick = () => {
    myText.innerText = "Offer a draw?";
    myBox.classList.remove("hidden");

    myYes.onclick = () => {
        socket.emit("offerDraw", ROOM_ID);
        myBox.classList.add("hidden");
    };
    myNo.onclick = () => {
        myBox.classList.add("hidden");
    };
};


// ---------------- OPPONENT OFFERED DRAW ----------------
socket.on("drawOffered", () => {
    oppText.innerText = "Opponent offers draw";
    oppBox.classList.remove("hidden");

    oppYes.onclick = () => {
        socket.emit("acceptDraw", ROOM_ID);
        oppBox.classList.add("hidden");
    };

    oppNo.onclick = () => {
        socket.emit("declineDraw", ROOM_ID);
        oppBox.classList.add("hidden");
    };
});


// -------- When opponent declines your draw --------
socket.on("drawDeclined", () => {
    alert("Opponent declined your draw request.");
});