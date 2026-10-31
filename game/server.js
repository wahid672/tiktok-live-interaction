const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { WebcastPushConnection, signatureProvider } = require('tiktok-live-connector');

// Disable EulerStream paid cloud signer to prevent Business Plan 403 blocks
if (signatureProvider && signatureProvider.config) {
  signatureProvider.config.enabled = false;
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor', express.static(path.join(__dirname, 'node_modules/canvas-confetti/dist')));

// Auto-detect TikTok username from active Chrome session
let detectedUsername = 'wahid_studio';
try {
  const pyCmd = "python3 -c \"import sys; sys.path.insert(0, '/data/workspace/tiktok-live-interaction'); import tiktok; print(tiktok._session().get('https://www.tiktok.com/passport/web/account/info/', timeout=5).json().get('data',{}).get('username',''))\"";
  const user = execSync(pyCmd, { timeout: 6000, encoding: 'utf-8' }).trim();
  if (user) {
    detectedUsername = user;
    console.log(`[TikTok] Successfully detected logged-in user: @${detectedUsername}`);
  }
} catch (e) {
  console.log('[TikTok] Using fallback username: @wahid_studio');
}

// Game State
const gameState = {
  isRunning: true,
  difficulty: 'medium', // easy, medium, hard
  roundDuration: 20, // seconds
  timeLeft: 20,
  currentQuestion: null,
  roundStatus: 'active', // active, celebrating, timeout, paused
  winner: null,
  leaderboard: {}, // uniqueId -> { nickname, avatarUrl, points, wins }
  tiktokUsername: detectedUsername,
  isConnectedToTikTok: false,
  totalQuestionsPlayed: 0,
  lastError: null
};

let timerInterval = null;
let tiktokLiveConnection = null;

// Math Question Generator
function generateQuestion(difficulty) {
  let a, b, op, questionText, answer;

  if (difficulty === 'easy') {
    const ops = ['+', '-'];
    op = ops[Math.floor(Math.random() * ops.length)];
    if (op === '+') {
      a = Math.floor(Math.random() * 40) + 5;
      b = Math.floor(Math.random() * 40) + 5;
      answer = a + b;
    } else {
      a = Math.floor(Math.random() * 50) + 20;
      b = Math.floor(Math.random() * (a - 5)) + 1;
      answer = a - b;
    }
    questionText = `${a} ${op} ${b}`;
  } else if (difficulty === 'hard') {
    const ops = ['×', '÷', 'combo'];
    op = ops[Math.floor(Math.random() * ops.length)];
    if (op === '×') {
      a = Math.floor(Math.random() * 18) + 7;
      b = Math.floor(Math.random() * 18) + 7;
      answer = a * b;
      questionText = `${a} × ${b}`;
    } else if (op === '÷') {
      b = Math.floor(Math.random() * 12) + 3;
      answer = Math.floor(Math.random() * 15) + 3;
      a = b * answer;
      questionText = `${a} ÷ ${b}`;
    } else {
      a = Math.floor(Math.random() * 9) + 2;
      b = Math.floor(Math.random() * 9) + 2;
      const c = Math.floor(Math.random() * 20) + 5;
      answer = (a * b) + c;
      questionText = `${a} × ${b} + ${c}`;
    }
  } else {
    // Medium
    const ops = ['+', '-', '×'];
    op = ops[Math.floor(Math.random() * ops.length)];
    if (op === '+') {
      a = Math.floor(Math.random() * 80) + 15;
      b = Math.floor(Math.random() * 80) + 15;
      answer = a + b;
      questionText = `${a} + ${b}`;
    } else if (op === '-') {
      a = Math.floor(Math.random() * 90) + 30;
      b = Math.floor(Math.random() * (a - 10)) + 10;
      answer = a - b;
      questionText = `${a} - ${b}`;
    } else {
      a = Math.floor(Math.random() * 12) + 3;
      b = Math.floor(Math.random() * 12) + 3;
      answer = a * b;
      questionText = `${a} × ${b}`;
    }
  }

  return {
    id: Date.now(),
    questionText,
    answer,
    difficulty,
    createdAt: Date.now()
  };
}

function startNewRound() {
  if (!gameState.isRunning) return;

  gameState.currentQuestion = generateQuestion(gameState.difficulty);
  gameState.timeLeft = gameState.roundDuration;
  gameState.roundStatus = 'active';
  gameState.winner = null;
  gameState.totalQuestionsPlayed++;

  io.emit('newQuestion', {
    question: gameState.currentQuestion,
    roundDuration: gameState.roundDuration,
    timeLeft: gameState.timeLeft,
    totalQuestions: gameState.totalQuestionsPlayed
  });

  io.emit('gameStateUpdate', getPublicState());
  resetTimer();
}

function resetTimer() {
  if (timerInterval) clearInterval(timerInterval);

  timerInterval = setInterval(() => {
    if (!gameState.isRunning || gameState.roundStatus !== 'active') return;

    gameState.timeLeft--;
    io.emit('timerTick', { timeLeft: gameState.timeLeft });

    if (gameState.timeLeft <= 0) {
      clearInterval(timerInterval);
      handleRoundTimeout();
    }
  }, 1000);
}

function handleRoundTimeout() {
  gameState.roundStatus = 'timeout';
  io.emit('roundTimeout', {
    correctAnswer: gameState.currentQuestion.answer
  });
  io.emit('gameStateUpdate', getPublicState());

  setTimeout(() => {
    if (gameState.isRunning) startNewRound();
  }, 3500);
}

function handleRoundWinner(winnerData) {
  if (gameState.roundStatus !== 'active') return;

  gameState.roundStatus = 'celebrating';
  if (timerInterval) clearInterval(timerInterval);

  const { uniqueId, nickname, avatarUrl } = winnerData;
  if (!gameState.leaderboard[uniqueId]) {
    gameState.leaderboard[uniqueId] = {
      uniqueId,
      nickname,
      avatarUrl: avatarUrl || '/images/default-avatar.png',
      points: 0,
      wins: 0
    };
  }

  const basePoints = gameState.difficulty === 'easy' ? 10 : gameState.difficulty === 'medium' ? 25 : 50;
  const timeBonus = Math.floor(gameState.timeLeft * 1.5);
  const earned = basePoints + timeBonus;

  gameState.leaderboard[uniqueId].points += earned;
  gameState.leaderboard[uniqueId].wins += 1;
  gameState.leaderboard[uniqueId].nickname = nickname;
  if (avatarUrl) gameState.leaderboard[uniqueId].avatarUrl = avatarUrl;

  gameState.winner = {
    uniqueId,
    nickname,
    avatarUrl: gameState.leaderboard[uniqueId].avatarUrl,
    pointsEarned: earned,
    totalPoints: gameState.leaderboard[uniqueId].points,
    wins: gameState.leaderboard[uniqueId].wins,
    answer: gameState.currentQuestion.answer
  };

  io.emit('roundWinner', {
    winner: gameState.winner,
    leaderboard: getTopLeaderboard()
  });
  io.emit('gameStateUpdate', getPublicState());

  setTimeout(() => {
    if (gameState.isRunning) startNewRound();
  }, 5000);
}

function checkGuess(commentText) {
  if (!gameState.currentQuestion || gameState.roundStatus !== 'active') return false;

  const correctAnswer = gameState.currentQuestion.answer;
  const text = commentText.trim().replace(/,/g, '');
  const tokens = text.split(/[\s,]+/);

  for (const token of tokens) {
    if (token === `${correctAnswer}`) return true;
  }
  return false;
}

const ACTIVE_ROOM_FILE = '/data/workspace/tiktok-live-interaction/.active_room.json';

function getActiveRoomInfo() {
  if (fs.existsSync(ACTIVE_ROOM_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(ACTIVE_ROOM_FILE, 'utf-8'));
    } catch (e) {
      return null;
    }
  }
  return null;
}

function getChromeSessionId() {
  try {
    const pyCmd = "python3 -c \"import sys; sys.path.insert(0, '/data/workspace/tiktok-live-interaction'); import tiktok; print(tiktok.get_session_id())\"";
    return execSync(pyCmd, { timeout: 3000, encoding: 'utf-8' }).trim();
  } catch (e) {
    return "";
  }
}

const commentHistory = [];

function handleIncomingComment({ uniqueId, nickname, avatarUrl, comment }) {
  const isCorrect = (gameState.roundStatus === 'active') ? checkGuess(comment) : false;

  const commentObj = {
    id: `c_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    uniqueId,
    nickname: nickname || 'Penonton',
    avatarUrl: avatarUrl || '/images/default-avatar.svg',
    comment,
    isCorrect,
    timestamp: Date.now()
  };

  commentHistory.push(commentObj);
  if (commentHistory.length > 100) commentHistory.shift();

  // Emit to all connected clients (overlay and control panel)
  io.emit('chatComment', commentObj);

  if (isCorrect && gameState.roundStatus === 'active') {
    handleRoundWinner({
      uniqueId,
      nickname,
      avatarUrl,
      answer: gameState.currentQuestion.answer
    });
  }
}

function getTopLeaderboard(limit = 5) {
  return Object.values(gameState.leaderboard)
    .sort((a, b) => b.points - a.points || b.wins - a.wins)
    .slice(0, limit);
}

function getPublicState() {
  const activeRoom = getActiveRoomInfo();
  return {
    isRunning: gameState.isRunning,
    difficulty: gameState.difficulty,
    roundDuration: gameState.roundDuration,
    timeLeft: gameState.timeLeft,
    currentQuestion: gameState.currentQuestion,
    roundStatus: gameState.roundStatus,
    winner: gameState.winner,
    leaderboard: getTopLeaderboard(),
    tiktokUsername: gameState.tiktokUsername,
    isConnectedToTikTok: gameState.isConnectedToTikTok,
    totalQuestions: gameState.totalQuestionsPlayed,
    lastError: gameState.lastError,
    activeRoom: activeRoom
  };
}

// TikTok Connection Management
function connectTikTok(username, roomId = null, sessionId = null) {
  let cleanInput = (username || gameState.tiktokUsername || '').replace(/^@/, '').trim();

  // If user entered a numeric ID (TikTok room_id is usually a 19-digit number)
  if (/^\d{15,22}$/.test(cleanInput)) {
    roomId = cleanInput;
  }

  // If no roomId passed, check active room file from our streamer
  if (!roomId) {
    const activeRoom = getActiveRoomInfo();
    if (activeRoom && activeRoom.room_id) {
      roomId = activeRoom.room_id;
      if (activeRoom.user && (!cleanInput || /^\d+$/.test(cleanInput))) {
        cleanInput = activeRoom.user;
      }
    }
  }

  const cleanUsername = cleanInput || 'wahid_studio';

  if (tiktokLiveConnection) {
    try { tiktokLiveConnection.disconnect(); } catch (e) {}
    tiktokLiveConnection = null;
  }

  gameState.tiktokUsername = cleanUsername;
  gameState.lastError = null;

  if (!sessionId) {
    sessionId = getChromeSessionId();
  }

  const connOptions = {
    processInitialData: false,
    enableExtendedGiftInfo: true,
    enableWebsocketUpgrade: true,
    requestPollingIntervalMs: 1000
  };
  if (sessionId) {
    connOptions.sessionId = sessionId;
  }

  try {
    tiktokLiveConnection = new WebcastPushConnection(cleanUsername, connOptions);
  } catch (err) {
    gameState.isConnectedToTikTok = false;
    gameState.lastError = err.message || err.toString();
    io.emit('tiktokStatus', { connected: false, error: gameState.lastError });
    io.emit('gameStateUpdate', getPublicState());
    return;
  }

  console.log(`[TikTok] Connecting to @${cleanUsername}${roomId ? ` (Room ID: ${roomId})` : ''}...`);

  tiktokLiveConnection.connect(roomId || null)
    .then(state => {
      gameState.isConnectedToTikTok = true;
      gameState.lastError = null;
      const connectedRoomId = (state && state.roomId) ? state.roomId : (roomId || 'LIVE');
      console.log(`[TikTok] ✓ Berhasil terhubung ke LIVE room @${cleanUsername} (Room ID: ${connectedRoomId})`);
      io.emit('tiktokStatus', { connected: true, username: cleanUsername, roomId: connectedRoomId });
      io.emit('gameStateUpdate', getPublicState());
    })
    .catch(err => {
      gameState.isConnectedToTikTok = false;
      let msg = err.message || err.toString();
      if (msg.includes('user_not_found') || msg.includes('19881007')) {
        msg = `Akun @${cleanUsername} tidak ditemukan. Pastikan username TikTok Anda sudah benar (contoh: wahid_studio).`;
      } else if (msg.includes('ended') || msg.includes('Missing cursor') || msg.includes('offline')) {
        msg = `Akun @${cleanUsername} saat ini SEDANG TIDAK LIVE di TikTok. Silakan klik "Mulai Live Sekarang" di Web Dashboard (port 8080) terlebih dahulu!`;
      } else if (msg.includes('ExtractRoomIdError') || msg.includes('room_id')) {
        msg = `Belum bisa mengambil Room ID untuk @${cleanUsername}. Jika baru saja klik Mulai Live, tunggu 5-10 detik atau masukkan Room ID langsung.`;
      }
      gameState.lastError = msg;
      console.error(`[TikTok] Connection error for @${cleanUsername}:`, msg);
      io.emit('tiktokStatus', { connected: false, error: msg });
      io.emit('gameStateUpdate', getPublicState());
    });

  tiktokLiveConnection.on('chat', data => {
    handleIncomingComment({
      uniqueId: data.uniqueId,
      nickname: data.nickname,
      avatarUrl: data.profilePictureUrl,
      comment: data.comment
    });
  });

  tiktokLiveConnection.on('gift', data => {
    if (data.giftType === 1 && !data.repeatEnd) return;
    io.emit('liveGift', {
      uniqueId: data.uniqueId,
      nickname: data.nickname,
      avatarUrl: data.profilePictureUrl,
      giftName: data.giftName,
      diamondCount: data.diamondCount || 1,
      repeatCount: data.repeatCount || 1
    });
  });

  tiktokLiveConnection.on('disconnected', () => {
    gameState.isConnectedToTikTok = false;
    gameState.lastError = 'Terputus dari live TikTok';
    io.emit('tiktokStatus', { connected: false, message: 'Disconnected from TikTok' });
    io.emit('gameStateUpdate', getPublicState());
  });

  tiktokLiveConnection.on('streamEnd', () => {
    gameState.isConnectedToTikTok = false;
    gameState.lastError = 'Live streaming TikTok telah berakhir';
    io.emit('tiktokStatus', { connected: false, message: 'Stream ended' });
    io.emit('gameStateUpdate', getPublicState());
  });
}

function disconnectTikTok() {
  if (tiktokLiveConnection) {
    try { tiktokLiveConnection.disconnect(); } catch (e) {}
    tiktokLiveConnection = null;
  }
  gameState.isConnectedToTikTok = false;
  gameState.lastError = null;
  io.emit('tiktokStatus', { connected: false, message: 'Disconnected' });
  io.emit('gameStateUpdate', getPublicState());
}

// Socket.IO Handlers
io.on('connection', (socket) => {
  socket.emit('gameStateUpdate', getPublicState());
  socket.emit('commentsHistory', commentHistory);

  socket.on('connectTikTok', ({ username, roomId }) => {
    console.log(`[Socket] Request to connect TikTok: @${username || ''} (Room: ${roomId || 'auto'})`);
    connectTikTok(username, roomId);
  });

  socket.on('disconnectTikTok', () => {
    disconnectTikTok();
  });

  socket.on('clearComments', () => {
    commentHistory.length = 0;
    io.emit('commentsCleared');
  });

  socket.on('setRunning', (isRunning) => {
    gameState.isRunning = isRunning;
    if (!isRunning && timerInterval) clearInterval(timerInterval);
    if (isRunning && gameState.roundStatus === 'active') resetTimer();
    io.emit('gameStateUpdate', getPublicState());
  });

  socket.on('setDifficulty', (diff) => {
    gameState.difficulty = diff;
    startNewRound();
  });

  socket.on('setDuration', (sec) => {
    gameState.roundDuration = parseInt(sec, 10);
    gameState.timeLeft = gameState.roundDuration;
    io.emit('gameStateUpdate', getPublicState());
  });

  socket.on('skipQuestion', () => {
    startNewRound();
  });

  socket.on('resetLeaderboard', () => {
    gameState.leaderboard = {};
    io.emit('leaderboardUpdate', []);
    io.emit('gameStateUpdate', getPublicState());
  });

  socket.on('simulateComment', ({ nickname, comment }) => {
    handleIncomingComment({
      uniqueId: `sim_${Date.now()}`,
      nickname: nickname || 'Penonton Setia',
      avatarUrl: '',
      comment: comment
    });
  });
});

// REST API Endpoints
app.post('/api/auto-connect', (req, res) => {
  const { roomId, username, sessionId } = req.body || {};
  console.log(`[API] Auto-connect request: user=${username}, roomId=${roomId}`);
  connectTikTok(username, roomId, sessionId);
  res.json({ ok: true, message: 'Connecting...' });
});

app.post('/api/disconnect-tiktok', (req, res) => {
  disconnectTikTok();
  res.json({ ok: true });
});

app.get('/api/stream-info', (req, res) => {
  const activeRoom = getActiveRoomInfo();
  res.json({
    ok: true,
    hasActiveRoom: Boolean(activeRoom && activeRoom.room_id),
    activeRoom
  });
});

app.get('/api/comments', (req, res) => {
  res.json({ ok: true, comments: commentHistory });
});

app.get('/api/state', (req, res) => {
  res.json(getPublicState());
});

// Start server
server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🎮 TikTok LIVE Interactive Math Game Server Started!`);
  console.log(`📺 OBS / Streamer Overlay: http://localhost:${PORT}`);
  console.log(`🎛️  Control Panel:         http://localhost:${PORT}/control.html`);
  console.log(`=======================================================`);
  startNewRound();
});
