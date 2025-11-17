const socket = io();
const chess = new Chess();

// DOM references (some are assigned later during init)
let boardEl = null;
let popup = null;
let popupText = null;
let playAgain = null;
let topTimer = null;
let bottomTimer = null;
let isAnimating = false;
let pendingFen = null;

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

// ---------------- EVENT ATTACHER ----------------
function attachPieceEvents(piece, r, c) {
  // remove previous handlers to avoid duplicates
  piece.replaceWith(piece.cloneNode(true));
  const newPiece = piece.parentNode
    ? piece.parentNode.querySelector(".piece:last-child") || piece
    : piece;
  // In many cases above will return piece. To be safe, we re-select newly created element:
  const cell = document.querySelector(`.square[data-row='${r}'][data-col='${c}']`);
  const finalPiece = cell ? cell.querySelector(".piece") : newPiece;
  if (!finalPiece) return;

  // mark draggable depending on role
  finalPiece.draggable = role && chess.board()[r] && chess.board()[r][c] ? (role === chess.board()[r][c].color) : false;

  // ---- DESKTOP DRAG START ----
  finalPiece.addEventListener("dragstart", e => {
    if (!finalPiece.draggable) return;
    dragged = finalPiece;
    source = { row: r, col: c };
    e.dataTransfer.setData("text/plain", "");

    // custom drag image
    const img = finalPiece.querySelector("img");
    if (img) {
      const dragImg = img.cloneNode(true);
      dragImg.style.position = "absolute";
      dragImg.style.top = "-9999px";
      document.body.appendChild(dragImg);
      const w = dragImg.width || 70;
      const h = dragImg.height || 70;
      e.dataTransfer.setDragImage(dragImg, w / 2, h / 2);
      setTimeout(() => {
        const clone = document.querySelector("body > img[style*='-9999px']");
        if (clone) clone.remove();
      }, 1000);
    }

    highlightMoves(r, c);
    finalPiece.classList.add("dragging");
  });

  finalPiece.addEventListener("dragend", () => {
    dragged = null;
    source = null;
    finalPiece.classList.remove("dragging");
    clearHighlights();
  });

  // ---- TOUCH (mobile) ----
  finalPiece.addEventListener("touchstart", e => {
    e.preventDefault();
    const sq = chess.board()[r] && chess.board()[r][c];
    if (!sq || role !== sq.color) return;

    touchDrag.active = true;
    touchDrag.startSquare = { row: r, col: c };
    touchDrag.lastTargetSquare = null;

    const img = finalPiece.querySelector("img");
    const floating = img.cloneNode(true);
    floating.style.position = "fixed";
    floating.style.left = `${e.touches[0].clientX}px`;
    floating.style.top = `${e.touches[0].clientY}px`;
    floating.style.transform = "translate(-50%, -50%)";
    floating.style.zIndex = 9999;
    floating.style.pointerEvents = "none";
    floating.classList.add("touch-floating");
    document.body.appendChild(floating);
    touchDrag.floating = floating;

    highlightMoves(r, c);

    clearSelectionUI();
    selectedSource = { row: r, col: c };
    selectedElement = finalPiece;
    selectedElement.classList.add("selected");
  }, { passive: false });

  finalPiece.addEventListener("touchmove", e => {
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
  }, { passive: false });

  finalPiece.addEventListener("touchend", e => {
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
  }, { passive: false });

  // ---- CLICK SELECT ----
  finalPiece.addEventListener("click", () => {
    const sq = chess.board()[r] && chess.board()[r][c];
    if (!sq || role !== sq.color) return;

    if (selectedSource && selectedSource.row === r && selectedSource.col === c) {
      clearSelectionUI();
    } else {
      clearSelectionUI();
      selectedSource = { row: r, col: c };
      selectedElement = finalPiece;
      finalPiece.classList.add("selected");
      highlightMoves(r, c);
    }
  });
}

// ---------------- BOARD RENDER ----------------
function renderBoard() {
  if (!boardEl) return;
  const board = chess.board();

  // FIRST TIME: build board
  if (!boardEl.dataset.initialized) {
    boardEl.innerHTML = "";
    boardEl.dataset.initialized = "1";

    board.forEach((row, r) => {
      row.forEach((sq, c) => {
        const cell = document.createElement("div");
        cell.classList.add("square", (r + c) % 2 ? "dark" : "light");
        cell.dataset.row = r;
        cell.dataset.col = c;
        cell.style.left = `${c * 80}px`;
        cell.style.top = `${r * 80}px`;
         // keep cell relative so pieces (if any) can be inside

        // Tap-to-tap movement
        cell.addEventListener("click", () => {
          if (selectedSource) {
            handleMove(selectedSource, { row: r, col: c });
            clearSelectionUI();
          }
        });

        cell.addEventListener("touchend", e => {
          if (selectedSource) {
            e.preventDefault();
            handleMove(selectedSource, { row: r, col: c });
            clearSelectionUI();
          }
        }, { passive: false });

        // Add piece if exists
        if (sq) {
          const piece = document.createElement("div");
          piece.classList.add("piece", sq.color === "w" ? "white" : "black");

          const img = document.createElement("img");
          img.src = pieceImage(sq);
          img.classList.add("piece-img");
          piece.appendChild(img);

          cell.appendChild(piece);

          // Attach events:
          attachPieceEvents(piece, r, c);
        }

        // Drag target behavior
        cell.addEventListener("dragover", e => e.preventDefault());
        cell.addEventListener("drop", e => {
          e.preventDefault();
          if (dragged && source) handleMove(source, { row: r, col: c });
          clearHighlights();
        });

        boardEl.appendChild(cell);
      });
    });

    if (role === "b") boardEl.classList.add("flipped");
    else boardEl.classList.remove("flipped");

    return;
  }

  // AFTER INITIAL RENDER: update piece DOMs to match engine state
  updateBoardPieces(board);
}

function updateBoardPieces(board) {
  // Remove all current piece elements
  document.querySelectorAll(".piece").forEach(p => p.remove());

  // Recreate piece DOM in correct squares
  board.forEach((row, r) => {
    row.forEach((sq, c) => {
      if (!sq) return;

      const cell = document.querySelector(`.square[data-row='${r}'][data-col='${c}']`);
      if (!cell) return;

      const piece = document.createElement("div");
      piece.classList.add("piece", sq.color === "w" ? "white" : "black");

      const img = document.createElement("img");
      img.src = pieceImage(sq);
      img.classList.add("piece-img");
      piece.appendChild(img);

      cell.appendChild(piece);

      // Attach events
      attachPieceEvents(piece, r, c);
    });
  });
}

// ---------------- MOVE ANIMATION ----------------
function movePieceDOM(from, to, mvResult) {
  isAnimating = true; 
  const fromSq = document.querySelector(`.square[data-row='${from.r}'][data-col='${from.c}']`);
  const toSq   = document.querySelector(`.square[data-row='${to.r}'][data-col='${to.c}']`);

  if (!fromSq || !toSq) return;

  const piece = fromSq.querySelector(".piece");
  if (!piece) return;

  // Board rect (for absolute coords)
  const boardRect = boardEl.getBoundingClientRect();

  // Create a floating clone for animation
  const img = piece.querySelector("img");
  const floating = piece.cloneNode(true);
  floating.style.position = "absolute";
  floating.style.width = `${img ? img.getBoundingClientRect().width : 70}px`;
  floating.style.height = `${img ? img.getBoundingClientRect().height : 70}px`;
  floating.style.left = `${piece.getBoundingClientRect().left - boardRect.left}px`;
  floating.style.top = `${piece.getBoundingClientRect().top - boardRect.top}px`;
  floating.style.margin = "0";
  floating.style.zIndex = 9999;
  floating.style.pointerEvents = "none";
  floating.style.transition = "all 160ms ease";
  boardEl.appendChild(floating);

  // Remove original immediately so target square is free (prevents blocking)
  piece.remove();

  // Handle captures
  if (mvResult && mvResult.captured) {
    // regular capture: remove piece in target square
    const cap = toSq.querySelector(".piece");
    if (cap) cap.remove();

    // en-passant capture (flag 'e'): captured pawn is behind 'to' square
    if (mvResult.flags && mvResult.flags.includes("e")) {
      const capRow = from.r;
      const capCol = to.c;
      const epSq = document.querySelector(`.square[data-row='${capRow}'][data-col='${capCol}']`);
      const epPiece = epSq && epSq.querySelector(".piece");
      if (epPiece) epPiece.remove();
    }
  }

  // Compute target coordinates for floating (relative to board)
  const targetRect = toSq.getBoundingClientRect();
  const targetLeft = targetRect.left - boardRect.left;
  const targetTop = targetRect.top - boardRect.top;

  // Special: castling - move rook DOM too (we don't animate rook here; we'll move it after)
  let rookMove = null;
  if (mvResult && mvResult.flags) {
    if (mvResult.flags.includes("k")) {
      // king-side: rook from col7 to col5
      rookMove = {
        from: { r: from.r, c: 7 },
        to:   { r: from.r, c: 5 }
      };
    } else if (mvResult.flags.includes("q")) {
      // queen-side: rook from col0 to col3
      rookMove = {
        from: { r: from.r, c: 0 },
        to:   { r: from.r, c: 3 }
      };
    }
  }

  floating.getBoundingClientRect();

  // Start animation (move floating to target)
  floating.getBoundingClientRect();

// Now animate to final square
requestAnimationFrame(() => {
    floating.style.left = `${targetLeft}px`;
    floating.style.top = `${targetTop}px`;
});

  // After animation, append piece (floating) into toSq and reattach events
  setTimeout(() => {
    // If there was a promotion (mvResult.promotion) replace the image
    if (mvResult && mvResult.promotion) {
      const imgEl = floating.querySelector("img");
      if (imgEl) {
        const color = mvResult.color || (mvResult.san && mvResult.san[0] === mvResult.san[0].toUpperCase() ? 'w' : 'b');
        imgEl.src = `/pieces/${(mvResult.color || 'w')}${mvResult.promotion.toUpperCase()}.svg`;
      }
    }

    // reset floating styles and append to target cell
    floating.style.position = "";
    floating.style.left = "";
    floating.style.top = "";
    floating.style.width = "";
    floating.style.height = "";
    floating.style.zIndex = "";
    floating.style.pointerEvents = "";
    floating.style.transition = "";
    toSq.appendChild(floating);

    // reattach events on moved piece
    attachPieceEvents(floating, to.r, to.c);

    // handle rook move for castling (move rook DOM to correct square)
    if (rookMove) {
      const rookFromSq = document.querySelector(`.square[data-row='${rookMove.from.r}'][data-col='${rookMove.from.c}']`);
      const rookToSq = document.querySelector(`.square[data-row='${rookMove.to.r}'][data-col='${rookMove.to.c}']`);
      if (rookFromSq && rookToSq) {
        const rookPiece = rookFromSq.querySelector(".piece");
        if (rookPiece) {
          // move rook instantly (we could animate similarly if wanted)
          rookToSq.appendChild(rookPiece);
          attachPieceEvents(rookPiece, rookMove.to.r, rookMove.to.c);
        }
      }
    }

    // finally, make sure board DOM lines up with engine (in rare sync cases)
    // we won't call full render here to avoid jump; but updateBoardPieces when a boardstate arrives
  isAnimating = false; 
    if (pendingFen) {
    chess.load(pendingFen);
    pendingFen = null;
    // re-render now that animation is finished
    renderBoard();
    clearSelectionUI();
  }
  }, 180);
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
  // If an animation is in progress, defer applying the boardstate
  if (isAnimating) {
    pendingFen = fen;
    return;
  }
  chess.load(fen);
  renderBoard();
  clearSelectionUI();
});

// -------- MOVE EVENT --------

socket.on("move", mv => {
  // Determine who made the move: chess.turn() (before the move) is the mover
  const moverColor = chess.turn(); // <-- FIXED: use chess.turn() directly

  // Apply move to engine (get flags, captured, promotion etc)
  const mvResult = chess.move(mv);

  // Convert move → board coords
  const from = {
    r: 8 - parseInt(mv.from[1]),
    c: mv.from.charCodeAt(0) - 97
  };
  const to = {
    r: 8 - parseInt(mv.to[1]),
    c: mv.to.charCodeAt(0) - 97
  };

  // Only animate on the client that actually made the move
  if (moverColor === role) {
    movePieceDOM(from, to, mvResult);
  } else {
    // Opponent moved — we will not animate here.
    // The server will send boardstate; if it arrives right away and
    // we are animating, boardstate handler will defer until animation completes.
  }

  clearSelectionUI();

  // Play sounds (keep as you had them)
  if (chess.in_check()) checkSound.play();
  else if (mvResult && mvResult.captured) captureSound.play();
  else moveSound.play();
});

// -------- TIMERS --------
socket.on("timers", t => updateTimers(t));

// -------- DRAW OFFERED (opponent) --------
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
      txt = role === "b" ? "You resigned! 💀" : "Opponent resigned — you win! 😎";
    } else if (blackResigned) {
      txt = role === "w" ? "You resigned! 💀" : "Opponent resigned — you win! 😎";
    } else {
      txt = "Opponent resigned — you win! 😎";
    }
  }
  // ========== TIMEOUT ==========
  else if (typeof winner === "string" && winner.includes("timeout")) {
    if (role === "w" && winner.startsWith("White")) txt = "EZ Timeout Win 😎";
    else if (role === "b" && winner.startsWith("Black")) txt = "Time’s up, victory is mine 🕒🔥";
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
    try { alert(txt); } catch (e) {}
  }

  if (endSound) endSound.play();
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