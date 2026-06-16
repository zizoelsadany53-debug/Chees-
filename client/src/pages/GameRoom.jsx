import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Chessboard } from "react-chessboard";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Clock, Flag, Maximize2, Minimize2, ShieldAlert, Swords } from "lucide-react";
import { Chess } from "chess.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useSocket } from "../context/SocketContext.jsx";
import { useSocketEvent } from "../hooks/useSocketEvent.js";
import { useTheme } from "../context/ThemeContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { getAvatarSrc } from "../data/avatarOptions.js";
import { submitReport } from "../services/report.js";
import confetti from "canvas-confetti";

function formatClock(ms = 0) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function isLightSquare(square) {
  const fileIdx = square.charCodeAt(0) - 97;
  const rankIdx = parseInt(square.charAt(1)) - 1;
  return (fileIdx + rankIdx) % 2 !== 0;
}

function formatMoveSymbol(move, isWhite) {
  if (!move) return "";
  const symbols = isWhite 
    ? { K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘" }
    : { K: "♚", Q: "♛", R: "♜", B: "♝", N: "♞" };
  const firstChar = move[0];
  if (symbols[firstChar]) {
    return symbols[firstChar] + move.slice(1);
  }
  return move;
}

function getEndInfo(payload, userId, lang) {
  const winnerColor = payload.result === "white_win" ? "white" : payload.result === "black_win" ? "black" : null;
  const loserColor = winnerColor === "white" ? "black" : winnerColor === "black" ? "white" : null;
  const winnerPlayer = winnerColor ? payload.players[winnerColor] : null;
  const loserPlayer = loserColor ? payload.players[loserColor] : null;
  const winnerName = winnerPlayer ? (winnerPlayer.id === userId ? (lang === "ar" ? "أنت" : "You") : winnerPlayer.username) : "";
  const loserName = loserPlayer ? (loserPlayer.id === userId ? (lang === "ar" ? "أنت" : "You") : loserPlayer.username) : "";
  let message = lang === "ar" ? "انتهت المباراة." : "Match finished.";

  if (payload.reason === "resign") {
    message = lang === "ar" ? "انسحب أحد اللاعبين." : "A player resigned.";
  } else if (payload.reason === "timeout") {
    message = lang === "ar" ? "انتهى الوقت." : "Time has ended.";
  } else if (payload.reason === "disconnect") {
    message = lang === "ar" ? "انقطع اتصال أحد اللاعبين." : "A player disconnected.";
  } else if (payload.result === "draw") {
    message = lang === "ar" ? "انتهت المباراة بالتعادل." : "The game ended in a draw.";
  }

  // determine a concise localized reason text
  let reasonText = message;
  const r = payload.reason;
  if (payload.result === "draw") {
    reasonText = lang === "ar" ? "تعادل" : "Draw";
  } else if (r === "resign") {
    reasonText = lang === "ar" ? "انسحب لاعب" : "Resignation";
  } else if (r === "timeout") {
    reasonText = lang === "ar" ? "انتهى الوقت" : "Timeout";
  } else if (r === "disconnect") {
    reasonText = lang === "ar" ? "انقطع الاتصال" : "Disconnected";
  } else if (r === "checkmate") {
    reasonText = lang === "ar" ? "كش ملك" : "Checkmate";
  }

  return {
    winnerColor,
    loserColor,
    winnerPlayer,
    loserPlayer,
    winnerName,
    loserName,
    message,
    reasonText,
    isDraw: payload.result === "draw",
    amIWinner: !!(winnerPlayer && winnerPlayer.id === userId)
  };
}

function evaluateBoard(chess, playerColor) {
  let score = 0;
  const board = chess.board();
  const pieceValues = { p: 10, n: 30, b: 30, r: 50, q: 90, k: 9000 };
  
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (piece) {
        const val = pieceValues[piece.type];
        if (piece.color === playerColor) {
          score += val;
        } else {
          score -= val;
        }
      }
    }
  }
  return score;
}

function getBestMove(chess, computerColor) {
  const moves = chess.moves({ verbose: true });
  if (moves.length === 0) return null;
  
  let bestMove = null;
  let bestScore = -Infinity;
  
  // Shuffle moves to add variety
  const shuffledMoves = [...moves].sort(() => Math.random() - 0.5);
  
  for (const move of shuffledMoves) {
    try {
      chess.move(move);
    } catch (e) {
      continue;
    }
    
    // Check if this move leads to immediate checkmate
    if (chess.isCheckmate()) {
      chess.undo();
      return move;
    }
    
    // Depth 1 evaluation (what is the worst opponent response?)
    const opponentMoves = chess.moves({ verbose: true });
    let minOpponentScore = Infinity;
    
    if (opponentMoves.length === 0) {
      minOpponentScore = chess.isDraw() || chess.isStalemate() ? 0 : -90000;
    } else {
      for (const oppMove of opponentMoves) {
        try {
          chess.move(oppMove);
        } catch (e) {
          continue;
        }
        const score = evaluateBoard(chess, computerColor);
        if (score < minOpponentScore) {
          minOpponentScore = score;
        }
        chess.undo();
      }
    }
    
    chess.undo();
    
    if (minOpponentScore > bestScore) {
      bestScore = minOpponentScore;
      bestMove = move;
    }
  }
  
  return bestMove || shuffledMoves[0];
}

export default function GameRoom() {
  const { roomId } = useParams();
  const { state } = useLocation();
  const { user } = useAuth();
  const { socket } = useSocket();
  const { colorTheme } = useTheme();
  const navigate = useNavigate();
  const { t, lang } = useLanguage();
  const [game, setGame] = useState(null);
  const [ended, setEnded] = useState(null);
  const [focusMode, setFocusMode] = useState(false);

  const onGameUpdate = useCallback((payload) => setGame(payload), []);
  const onGameEnd = useCallback((payload) => {
    setGame(payload);
    setEnded(payload);

    const isWhite = payload.players.white.id === user?.id;
    const isBlack = payload.players.black.id === user?.id;
    const myRole = isWhite ? "white" : isBlack ? "black" : "spectator";

    const winnerColor = payload.result === "white_win" ? "white" : "black";
    const amIWinner = myRole === winnerColor;

    // Trigger Confetti for the Winner!
    if (amIWinner && (payload.result === "white_win" || payload.result === "black_win")) {
      confetti({
        particleCount: 150,
        spread: 85,
        origin: { y: 0.6 }
      });
      setTimeout(() => {
        confetti({
          particleCount: 100,
          spread: 100,
          origin: { y: 0.6 }
        });
      }, 400);
    }

    setEnded(payload);
  }, [user?.id]);

  const myColor = useMemo(() => {
    if (state?.color) return state.color;
    if (!game || !user) return "white";
    return game.players.white.id === user.id ? "white" : "black";
  }, [game, state?.color, user]);

  const movesHistory = useMemo(() => {
    if (!game?.pgn) return [];
    try {
      const tempChess = new Chess();
      tempChess.loadPgn(game.pgn);
      return tempChess.history();
    } catch (e) {
      return game.pgn
        .replace(/\[.*?\]/sg, "")
        .replace(/\d+\.\.\.?/g, "")
        .split(/\s+/)
        .map(x => x.trim())
        .filter(x => x.length > 0 && !x.includes("{") && !x.includes("}"));
    }
  }, [game?.pgn]);

  const matchAnalysis = useMemo(() => {
    if (!game?.pgn) return null;
    const sim = new Chess();
    try {
      sim.loadPgn(game.pgn);
    } catch (e) {
      return null;
    }
    const history = sim.history({ verbose: true });
    const analysis = {
      white: { excellent: 0, good: 0, bad: 0, knights: 0, captures: 0, points: 0 },
      black: { excellent: 0, good: 0, bad: 0, knights: 0, captures: 0, points: 0 }
    };

    const walker = new Chess();
    for (const mv of history) {
      const player = mv.color === "w" ? "white" : "black";
      const before = evaluateBoard(walker, mv.color);
      try {
        walker.move(mv);
      } catch (e) {
        continue;
      }
      const after = evaluateBoard(walker, mv.color);
      const delta = after - before;

      if (mv.piece === "n") analysis[player].knights += 1;
      if (mv.captured) analysis[player].captures += 1;

      if (delta > 30) analysis[player].excellent += 1;
      else if (delta > 5) analysis[player].good += 1;
      else if (delta < -5) analysis[player].bad += 1;

      analysis[player].points += Math.round(delta);
    }

    return analysis;
  }, [game?.pgn]);

  const customPieces = useMemo(() => {
    const pieces = ["wp", "wn", "wb", "wr", "wq", "wk", "bp", "bn", "bb", "br", "bq", "bk"];
    const map = {};
    pieces.forEach((p) => {
      const key = p.charAt(0) + p.charAt(1).toUpperCase();
      map[key] = ({ squareWidth }) => (
        <img
          src={`https://images.chesscomfiles.com/chess-themes/pieces/neo/150/${p}.png`}
          alt={p}
          style={{ width: squareWidth, height: squareWidth, objectFit: "contain" }}
        />
      );
    });
    return map;
  }, []);

  const isPlayer = useMemo(() => {
    if (!game || !user) return false;
    return game.players.white.id === user.id || game.players.black.id === user.id;
  }, [game, user]);

  const [showReportModal, setShowReportModal] = useState(false);
  const [reportType, setReportType] = useState("problem");
  const [reportMessage, setReportMessage] = useState("");
  const [reportTargetId, setReportTargetId] = useState("");

  const endInfo = useMemo(() => {
    if (!ended) return null;
    return getEndInfo(ended, user?.id, lang);
  }, [ended, user?.id, lang]);

  // Note: No auto-close - modal remains until user presses Back.

  const handleLeaveMatch = () => {
    navigate("/");
  };

  const handleSendReport = async () => {
    if (!reportMessage.trim() || reportMessage.trim().length < 10) {
      return toast.error(lang === "ar" ? "أدخل وصفًا أطول للبلاغ" : "Please provide a longer report message");
    }

    try {
      await submitReport({
        type: reportType,
        reported_user_id: reportType === "player" ? Number(reportTargetId) : undefined,
        message: reportMessage.trim()
      });
      setShowReportModal(false);
      setReportMessage("");
      setReportTargetId("");
      toast.success(lang === "ar" ? "تم إرسال البلاغ" : "Report submitted");
    } catch (error) {
      toast.error(error.message);
    }
  };

  const handleResign = () => {
    if (window.confirm("هل أنت متأكد من أنك تريد الانسحاب؟ Are you sure you want to resign?")) {
      if (roomId === "computer") {
        const resignedGame = {
          ...game,
          status: "ended",
          result: "black_win",
          reason: "resign"
        };
        setGame(resignedGame);
        onGameEnd(resignedGame);
      } else {
        socket?.emit("resignGame", { roomId });
      }
    }
  };

  useEffect(() => {
    if (roomId === "computer") {
      const localGame = {
        roomId: "computer",
        matchId: "computer",
        players: {
          white: { id: user?.id || "user", username: user?.username || "You", elo_rating: user?.elo_rating ?? 0 },
          black: { id: "computer", username: lang === "ar" ? "ذكاء اصطناعي (متوسط)" : "Chess AI (Medium)", elo_rating: 1500 }
        },
        timers: { white: 10 * 60 * 1000, black: 10 * 60 * 1000 },
        status: "active",
        fen: "start",
        pgn: "",
        turn: "w",
        result: null,
        reason: null,
        lastMove: null
      };
      setGame(localGame);
      setEnded(null);
    } else {
      if (socket && roomId) socket.emit("joinRoom", { roomId });
    }
  }, [roomId, socket, user]);

  useEffect(() => {
    if (roomId !== "computer" || ended || game?.status !== "active") return;
    
    const timerInterval = setInterval(() => {
      setGame((prev) => {
        if (!prev || prev.status !== "active") return prev;
        const activeColor = prev.turn === "w" ? "white" : "black";
        const nextTimers = {
          ...prev.timers,
          [activeColor]: Math.max(0, prev.timers[activeColor] - 1000)
        };
        
        if (nextTimers[activeColor] <= 0) {
          const nextGame = {
            ...prev,
            timers: nextTimers,
            status: "ended",
            result: activeColor === "white" ? "black_win" : "white_win",
            reason: "timeout"
          };
          clearInterval(timerInterval);
          onGameEnd(nextGame);
          return nextGame;
        }
        
        return {
          ...prev,
          timers: nextTimers
        };
      });
    }, 1000);
    
    return () => clearInterval(timerInterval);
  }, [roomId, ended, game?.status, onGameEnd]);

  useEffect(() => {
    document.body.classList.toggle("game-focus-active", focusMode);
    return () => document.body.classList.remove("game-focus-active");
  }, [focusMode]);



  useSocketEvent(socket, "gameUpdate", onGameUpdate);
  useSocketEvent(socket, "gameEnd", onGameEnd);
  useSocketEvent(socket, "playerDisconnected", () => toast("Opponent disconnected"));

  const [optionSquares, setOptionSquares] = useState({});
  const [selectedSquare, setSelectedSquare] = useState("");

  const chess = useMemo(() => {
    const fen = game?.fen === "start" ? undefined : game?.fen;
    return new Chess(fen);
  }, [game?.fen]);

  const themeColors = useMemo(() => {
    const isDark = document.documentElement.dataset.theme !== "light";
    switch (colorTheme) {
      case "green":
        return {
          dotDarkSquare: "rgba(238, 238, 210, 0.65)",  // light beige dot on green square
          dotLightSquare: "rgba(115, 149, 82, 0.85)",  // green dot on beige square
          captureDarkSquare: "rgba(238, 238, 210, 0.75)",
          captureLightSquare: "rgba(115, 149, 82, 0.95)",
          selected: "rgba(124, 201, 111, 0.4)",
          lastMove: "rgba(124, 201, 111, 0.22)"
        };
      case "brown":
        return {
          dotDarkSquare: "rgba(240, 217, 181, 0.65)",  // cream dot on brown square
          dotLightSquare: "rgba(181, 136, 99, 0.85)",  // brown dot on cream square
          captureDarkSquare: "rgba(240, 217, 181, 0.75)",
          captureLightSquare: "rgba(181, 136, 99, 0.95)",
          selected: "rgba(212, 163, 92, 0.4)",
          lastMove: "rgba(212, 163, 92, 0.22)"
        };
      case "blue":
        return {
          dotDarkSquare: "rgba(234, 233, 210, 0.65)",  // beige dot on blue square
          dotLightSquare: "rgba(75, 115, 153, 0.85)",  // blue dot on beige square
          captureDarkSquare: "rgba(234, 233, 210, 0.75)",
          captureLightSquare: "rgba(75, 115, 153, 0.95)",
          selected: "rgba(92, 147, 228, 0.4)",
          lastMove: "rgba(92, 147, 228, 0.22)"
        };
      case "black":
      default:
        return {
          dotDarkSquare: "rgba(240, 240, 240, 0.65)",  // light gray dot on black square
          dotLightSquare: "rgba(43, 43, 43, 0.75)",     // black dot on light gray square
          captureDarkSquare: "rgba(240, 240, 240, 0.75)",
          captureLightSquare: "rgba(43, 43, 43, 0.85)",
          selected: isDark ? "rgba(255, 255, 255, 0.3)" : "rgba(0, 0, 0, 0.2)",
          lastMove: isDark ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.12)"
        };
    }
  }, [colorTheme]);

  const lastMoveSquares = useMemo(() => {
    if (!game?.pgn) return {};
    const tempChess = new Chess();
    try {
      tempChess.loadPgn(game.pgn);
      const history = tempChess.history({ verbose: true });
      if (history.length > 0) {
        const last = history[history.length - 1];
        return {
          [last.from]: { backgroundColor: themeColors.lastMove },
          [last.to]: { backgroundColor: themeColors.lastMove }
        };
      }
    } catch (e) {
      console.error(e);
    }
    return {};
  }, [game?.pgn, themeColors.lastMove]);

  const customSquareStyles = useMemo(() => {
    return {
      ...lastMoveSquares,
      ...optionSquares
    };
  }, [lastMoveSquares, optionSquares]);

  const getMoveOptions = useCallback((square) => {
    if (ended || game?.status !== "active") return false;
    if (game?.turn !== (myColor === "white" ? "w" : "b")) return false;

    const piece = chess.get(square);
    if (!piece || piece.color !== (myColor === "white" ? "w" : "b")) return false;

    const moves = chess.moves({
      square,
      verbose: true
    });
    if (moves.length === 0) return false;

    const newSquares = {};

    moves.forEach((move) => {
      const isCapture = chess.get(move.to);
      const isLight = isLightSquare(move.to);
      const dotColor = isLight ? themeColors.dotLightSquare : themeColors.dotDarkSquare;
      const captureColor = isLight ? themeColors.captureLightSquare : themeColors.captureDarkSquare;

      newSquares[move.to] = {
        background: isCapture
          ? `radial-gradient(circle, transparent 55%, ${captureColor} 55%)`
          : `radial-gradient(circle, ${dotColor} 25%, transparent 25%)`,
        borderRadius: "50%"
      };
    });
    newSquares[square] = {
      backgroundColor: themeColors.selected
    };
    return newSquares;
  }, [ended, game?.status, game?.turn, myColor, chess, themeColors]);

  const onSquareClick = useCallback((square) => {
    if (optionSquares[square] && square !== selectedSquare) {
      const moveSuccessful = onPieceDrop(selectedSquare, square);
      if (moveSuccessful) {
        setOptionSquares({});
        setSelectedSquare("");
        return;
      }
    }

    const options = getMoveOptions(square);
    if (options) {
      setOptionSquares(options);
      setSelectedSquare(square);
    } else {
      setOptionSquares({});
      setSelectedSquare("");
    }
  }, [optionSquares, selectedSquare, getMoveOptions]);

  const onPieceDragBegin = useCallback((piece, square) => {
    const options = getMoveOptions(square);
    if (options) {
      setOptionSquares(options);
      setSelectedSquare(square);
    }
  }, [getMoveOptions]);

  const onPieceDragEnd = useCallback(() => {
    setOptionSquares({});
    setSelectedSquare("");
  }, []);

  const makeComputerMove = useCallback((currentChess, currentGame) => {
    if (currentChess.turn() !== "b" || currentGame.status !== "active") return;
    
    const bestMove = getBestMove(currentChess, "b");
    if (!bestMove) return;
    let move = null;
    try {
      move = currentChess.move(bestMove);
    } catch (e) {
      return;
    }
    const nextGame = {
      ...currentGame,
      fen: currentChess.fen(),
      pgn: currentChess.pgn(),
      turn: currentChess.turn(),
      lastMove: move.san
    };
    
    if (currentChess.isCheckmate()) {
      nextGame.status = "ended";
      nextGame.result = "black_win";
      nextGame.reason = "checkmate";
      setGame(nextGame);
      onGameEnd(nextGame);
    } else if (currentChess.isDraw() || currentChess.isStalemate()) {
      nextGame.status = "ended";
      nextGame.result = "draw";
      nextGame.reason = "stalemate";
      setGame(nextGame);
      onGameEnd(nextGame);
    } else {
      setGame(nextGame);
    }
  }, [onGameEnd]);

  function onPieceDrop(sourceSquare, targetSquare) {
    if (!game || ended) return false;

    const moves = chess.moves({ square: sourceSquare, verbose: true });
    const isLegal = moves.some((m) => m.to === targetSquare);
    if (!isLegal) {
      setOptionSquares({});
      setSelectedSquare("");
      return false;
    }

    if (roomId === "computer") {
      const move = chess.move({ from: sourceSquare, to: targetSquare, promotion: "q" });
      if (!move) return false;

      const updatedGame = {
        ...game,
        fen: chess.fen(),
        pgn: chess.pgn(),
        turn: chess.turn(),
        lastMove: move.san
      };

      if (chess.isCheckmate()) {
        updatedGame.status = "ended";
        updatedGame.result = "white_win";
        updatedGame.reason = "checkmate";
        setGame(updatedGame);
        onGameEnd(updatedGame);
      } else if (chess.isDraw() || chess.isStalemate()) {
        updatedGame.status = "ended";
        updatedGame.result = "draw";
        updatedGame.reason = "stalemate";
        setGame(updatedGame);
        onGameEnd(updatedGame);
      } else {
        setGame(updatedGame);
        setTimeout(() => {
          makeComputerMove(chess, updatedGame);
        }, 600);
      }

      setOptionSquares({});
      setSelectedSquare("");
      return true;
    }

    if (!socket) return false;

    socket.emit("movePiece", {
      roomId,
      from: sourceSquare,
      to: targetSquare,
      promotion: "q"
    });

    setOptionSquares({});
    setSelectedSquare("");
    return true;
  }

  const white = game?.players.white;
  const black = game?.players.black;
  const turnLabel = game?.turn === "w" ? t("white") : t("black");
  const topPlayer = myColor === "white" ? black : white;
  const bottomPlayer = myColor === "white" ? white : black;
  const topTimer = myColor === "white" ? game?.timers.black : game?.timers.white;
  const bottomTimer = myColor === "white" ? game?.timers.white : game?.timers.black;

  return (
    <div className={`game-layout ${focusMode ? "is-focused" : ""}`}>
      <section className="board-shell arena-board-shell">
        <div className="game-command-bar">
          <div>
            <span className="eyebrow">{t("liveMatch")}</span>
            <strong>{white?.username || (lang === "ar" ? "الأبيض" : "White")} {t("vs")} {black?.username || (lang === "ar" ? "الأسود" : "Black")}</strong>
          </div>
          <button className="icon-action" onClick={() => setFocusMode((value) => !value)} title={focusMode ? (lang === "ar" ? "إلغاء وضع التركيز" : "Exit focus") : (lang === "ar" ? "وضع التركيز" : "Focus match")}>
            {focusMode ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
        </div>

        <div className={`player-strip game-player-card glass ${game?.turn === (myColor === "white" ? "b" : "w") ? "is-turn" : ""}`}>
          <div className="player-identity">
            <div className="avatar sm">{topPlayer?.avatar ? <img src={getAvatarSrc(topPlayer.avatar)} alt="" /> : topPlayer?.username?.[0] || "?"}</div>
            <div>
              <strong>{topPlayer?.username || (lang === "ar" ? "الخصم" : "Opponent")}</strong>
              <small>{topPlayer?.elo_rating ?? 0} Elo</small>
            </div>
          </div>
          <span className="clock"><Clock size={18} />{formatClock(topTimer)}</span>
        </div>
        <div className="board-frame">
          <div className="board-coordinates file-top"><span>a</span><span>b</span><span>c</span><span>d</span><span>e</span><span>f</span><span>g</span><span>h</span></div>
          <div className="rank-left"><span>8</span><span>7</span><span>6</span><span>5</span><span>4</span><span>3</span><span>2</span><span>1</span></div>
          <div className="board-wrap">
          <Chessboard
            id="global-chess-arena-board"
            position={game?.fen || "start"}
            boardOrientation={myColor}
            onPieceDrop={onPieceDrop}
            onPieceDragBegin={onPieceDragBegin}
            onPieceDragEnd={onPieceDragEnd}
            onSquareClick={onSquareClick}
            customPieces={customPieces}
            customDarkSquareStyle={{ backgroundColor: "var(--board-dark)" }}
            customLightSquareStyle={{ backgroundColor: "var(--board-light)" }}
            customBoardStyle={{ borderRadius: "10px", boxShadow: "0 34px 110px rgba(0,0,0,.48)" }}
            customSquareStyles={customSquareStyles}
          />
          </div>
          <div className="rank-right"><span>8</span><span>7</span><span>6</span><span>5</span><span>4</span><span>3</span><span>2</span><span>1</span></div>
          <div className="board-coordinates file-bottom"><span>a</span><span>b</span><span>c</span><span>d</span><span>e</span><span>f</span><span>g</span><span>h</span></div>
        </div>
        <div className={`player-strip game-player-card glass ${game?.turn === (myColor === "white" ? "w" : "b") ? "is-turn" : ""}`}>
          <div className="player-identity">
            <div className="avatar sm">{bottomPlayer?.avatar ? <img src={getAvatarSrc(bottomPlayer.avatar)} alt="" /> : bottomPlayer?.username?.[0] || "?"}</div>
            <div>
              <strong>{bottomPlayer?.username || (lang === "ar" ? "أنت" : "You")}</strong>
              <small>{bottomPlayer?.elo_rating ?? 0} Elo</small>
            </div>
          </div>
          <span className="clock"><Clock size={18} />{formatClock(bottomTimer)}</span>
        </div>
      </section>

      <aside className="game-sidebar panel">
        <div className="panel-title">
          <Flag size={18} />
          <h2>{t("gameRoom")}</h2>
        </div>
        <div className="status-card">
          <span className="eyebrow">{t("turn")}</span>
          <strong><Swords size={22} /> {turnLabel || (lang === "ar" ? "في الانتظار" : "Waiting")}</strong>
          {game?.inCheck && <p className="check"><ShieldAlert size={16} /> {t("check")}</p>}
        </div>
        <div className="versus">
          <div><span>{t("white")}</span><strong>{white?.username || (lang === "ar" ? "اللاعب" : "Player")}</strong></div>
          <div><span>{t("black")}</span><strong>{black?.username || (lang === "ar" ? "اللاعب" : "Player")}</strong></div>
        </div>
        <div className="moves-box" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: "180px" }}>
          <span className="eyebrow">{t("movesHistory")}</span>
          <div className="moves-scroll-container" style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
            {movesHistory.length === 0 ? (
              <p className="muted" style={{ fontSize: "0.85rem", padding: "0 10px" }}>{t("movesWillAppear")}</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "40px 1fr 1fr", gap: "8px 12px", fontSize: "0.95rem", padding: "0 12px" }}>
                {Array.from({ length: Math.ceil(movesHistory.length / 2) }).map((_, i) => (
                  <Fragment key={i}>
                    <span style={{ color: "var(--text-muted)", fontWeight: "600" }}>{i + 1}.</span>
                    <span>{formatMoveSymbol(movesHistory[i * 2], true)}</span>
                    <span>{formatMoveSymbol(movesHistory[i * 2 + 1], false)}</span>
                  </Fragment>
                ))}
              </div>
            )}
          </div>
        </div>
        
        {!(ended || game?.status === "ended") && game?.status === "active" && isPlayer && (
          <>
            <button className="primary danger-btn" onClick={handleResign} style={{ width: "100%", marginTop: "4px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
              <Flag size={18} />
              {t("resign")}
            </button>
            <button className="primary" onClick={() => setShowReportModal(true)} style={{ width: "100%", marginTop: "8px" }}>
              <ShieldAlert size={18} />
              {lang === "ar" ? "إرسال بلاغ" : "Report issue"}
            </button>
          </>
        )}

        {(ended || game?.status === "ended") && (
          <div className="game-result">
            <strong>{(ended?.result || game?.result || "Ended")?.replace("_", " ")}</strong>
            <span>{ended?.reason || game?.reason || ""}</span>
          </div>
        )}
        {(matchAnalysis && (ended || game?.status === "ended")) && (
          <div className="match-analysis" style={{ marginTop: 12 }}>
            <h3 style={{ margin: "8px 0" }}>{lang === "ar" ? "تحليل المباراة" : "Match Analysis"}</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="analysis-player">
                <strong>{white?.username || (lang === "ar" ? "الأبيض" : "White")}</strong>
                <ul style={{ margin: "8px 0", paddingLeft: 18 }}>
                  <li>{lang === "ar" ? "ممتاز:" : "Excellent:"} {matchAnalysis.white.excellent}</li>
                  <li>{lang === "ar" ? "جيد:" : "Good:"} {matchAnalysis.white.good}</li>
                  <li>{lang === "ar" ? "سيئ:" : "Bad:"} {matchAnalysis.white.bad}</li>
                  <li>{lang === "ar" ? "حصان (N) حركات:" : "Knight moves:"} {matchAnalysis.white.knights}</li>
                  <li>{lang === "ar" ? "قطع:" : "Captures:"} {matchAnalysis.white.captures}</li>
                  <li>{lang === "ar" ? "نقاط مكتسبة:" : "Points gained:"} {matchAnalysis.white.points}</li>
                </ul>
              </div>
              <div className="analysis-player">
                <strong>{black?.username || (lang === "ar" ? "الأسود" : "Black")}</strong>
                <ul style={{ margin: "8px 0", paddingLeft: 18 }}>
                  <li>{lang === "ar" ? "ممتاز:" : "Excellent:"} {matchAnalysis.black.excellent}</li>
                  <li>{lang === "ar" ? "جيد:" : "Good:"} {matchAnalysis.black.good}</li>
                  <li>{lang === "ar" ? "سيئ:" : "Bad:"} {matchAnalysis.black.bad}</li>
                  <li>{lang === "ar" ? "حصان (N) حركات:" : "Knight moves:"} {matchAnalysis.black.knights}</li>
                  <li>{lang === "ar" ? "قطع:" : "Captures:"} {matchAnalysis.black.captures}</li>
                  <li>{lang === "ar" ? "نقاط مكتسبة:" : "Points gained:"} {matchAnalysis.black.points}</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </aside>
      {showReportModal && (
        <div className="modal-backdrop" onClick={() => setShowReportModal(false)}>
          <div className="modal-content glass" onClick={(event) => event.stopPropagation()}>
            <h2>{lang === "ar" ? "إرسال بلاغ" : "Report a problem"}</h2>
            <div style={{ display: "grid", gap: 12, textAlign: "left" }}>
              <label>
                {lang === "ar" ? "نوع البلاغ" : "Report type"}
                <select value={reportType} onChange={(event) => setReportType(event.target.value)} style={{ width: "100%", minHeight: 42, borderRadius: 8, border: "1px solid var(--line)", padding: "8px" }}>
                  <option value="problem">{lang === "ar" ? "مشكلة في اللعبة" : "Problem with game"}</option>
                  <option value="player">{lang === "ar" ? "بلاغ ضد لاعب" : "Report a player"}</option>
                </select>
              </label>
              {reportType === "player" && (
                <label>
                  {lang === "ar" ? "معرف اللاعب المبلغ عنه" : "Reported player ID"}
                  <input value={reportTargetId} onChange={(event) => setReportTargetId(event.target.value.replace(/\D/g, ""))} placeholder={lang === "ar" ? "أدخل المعرف" : "Enter player ID"} style={{ width: "100%", minHeight: 42, borderRadius: 8, border: "1px solid var(--line)", padding: "8px" }} />
                </label>
              )}
              <label>
                {lang === "ar" ? "تفاصيل البلاغ" : "Message"}
                <textarea value={reportMessage} onChange={(event) => setReportMessage(event.target.value)} rows={5} placeholder={lang === "ar" ? "أخبرنا بما حدث" : "Tell us what happened"} style={{ width: "100%", borderRadius: 8, border: "1px solid var(--line)", padding: "8px" }} />
              </label>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
              <button className="primary" type="button" onClick={handleSendReport}>{lang === "ar" ? "إرسال البلاغ" : "Submit report"}</button>
              <button className="primary danger-btn" type="button" onClick={() => setShowReportModal(false)}>{lang === "ar" ? "إلغاء" : "Cancel"}</button>
            </div>
          </div>
        </div>
      )}

      {ended && endInfo && (
        <div className="modal-backdrop">
          <div className="modal-content end-modal glass" onClick={(event) => event.stopPropagation()}>
            <div className="end-modal-header">
              <h2>{lang === "ar" ? "انتهت المباراة" : "Match Over"}</h2>
              <p>{endInfo.message}</p>
              {endInfo.reasonText && (
                <p className="end-reason" style={{ marginTop: 6 }}>{endInfo.reasonText}</p>
              )}
            </div>

            {endInfo.winnerColor ? (
              <div className="end-result-grid">
                <div className="end-result-card winner">
                  <strong>{lang === "ar" ? "الفائز" : "Winner"}</strong>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="result-badge">{endInfo.winnerColor === "white" ? (lang === "ar" ? "الأبيض" : "White") : (lang === "ar" ? "الأسود" : "Black")}</span>
                    <small style={{ margin: 0 }}>{endInfo.winnerName}</small>
                  </div>
                </div>
                <div className="end-result-card loser">
                  <strong>{lang === "ar" ? "الخاسر" : "Loser"}</strong>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="result-badge">{endInfo.loserColor === "white" ? (lang === "ar" ? "الأبيض" : "White") : (lang === "ar" ? "الأسود" : "Black")}</span>
                    <small style={{ margin: 0 }}>{endInfo.loserName}</small>
                  </div>
                </div>
              </div>
            ) : (
              <div className="end-result-grid" style={{ gap: 16 }}>
                <div className="end-result-card" style={{ gridColumn: "1 / -1" }}>
                  <strong>{lang === "ar" ? "تعادل" : "Draw"}</strong>
                  <span>{lang === "ar" ? "المباراة انتهت بالتعادل" : "The match ended in a draw."}</span>
                </div>
              </div>
            )}

            <div className="end-modal-actions">
              <button className="primary" type="button" onClick={handleLeaveMatch}>
                {lang === "ar" ? "العودة" : "Back"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
