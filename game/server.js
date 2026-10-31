const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { TikTokLiveConnection } = require('tiktok-live-connector');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor', express.static(path.join(__dirname, 'node_modules/canvas-confetti/dist')));

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
  tiktokUsername: '',
  isConnectedToTikTok: false,
  totalQuestionsPlayed: 0
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
      // combo: (a + b) x c or a x b - c
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
  if (!gameState.isRunning) {
    gameState.roundStatus = 'paused';
    io.emit('gameStateUpdate', getPublicState());
    return;
  }

  gameState.totalQuestionsPlayed++;
  gameState.currentQuestion = generateQuestion(gameState.difficulty);
  gameState.timeLeft = gameState.roundDuration;
  gameState.roundStatus = 'active';
  gameState.winner = null;

  io.emit('newRound', {
    question: gameState.currentQuestion,
    timeLeft: gameState.timeLeft,
    totalQuestions: gameState.totalQuestionsPlayed
  });

  io.emit('gameStateUpdate', getPublicState());

  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (gameState.roundStatus !== 'active') return;

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
    correctAnswer: gameState.currentQuestion.answer,
    questionText: gameState.currentQuestion.questionText
  });
  io.emit('gameStateUpdate', getPublicState());

  // Wait 4 seconds then next question
  setTimeout(() => {
    if (gameState.isRunning) startNewRound();
  }, 4000);
}

function handleRoundWinner(winnerData) {
  if (gameState.roundStatus !== 'active') return;
  if (timerInterval) clearInterval(timerInterval);

  gameState.roundStatus = 'celebrating';
  const speedBonus = Math.max(0, Math.floor(gameState.timeLeft / 2));
  const pointsEarned = 10 + speedBonus;

  // Update leaderboard
  const uid = winnerData.uniqueId || 'guest';
  if (!gameState.leaderboard[uid]) {
    gameState.leaderboard[uid] = {
      uniqueId: uid,
      nickname: winnerData.nickname || uid,
      avatarUrl: winnerData.avatarUrl || '',
      points: 0,
      wins: 0
    };
  }
  gameState.leaderboard[uid].points += pointsEarned;
  gameState.leaderboard[uid].wins += 1;
  gameState.leaderboard[uid].nickname = winnerData.nickname || gameState.leaderboard[uid].nickname;
  if (winnerData.avatarUrl) gameState.leaderboard[uid].avatarUrl = winnerData.avatarUrl;

  gameState.winner = {
    ...winnerData,
    pointsEarned,
    speedBonus
  };

  io.emit('roundWinner', {
    winner: gameState.winner,
    correctAnswer: gameState.currentQuestion.answer,
    leaderboard: getTopLeaderboard()
  });

  io.emit('gameStateUpdate', getPublicState());

  // Wait 4.5 seconds celebrate then next round
  setTimeout(() => {
    if (gameState.isRunning) startNewRound();
  }, 4500);
}

function handleIncomingComment(commentData) {
  const { uniqueId, nickname, avatarUrl, comment } = commentData;
  if (!comment) return;

  // Extract all numbers
  const matches = comment.match(/-?\d+/g);
  let isCorrect = false;

  if (gameState.roundStatus === 'active' && gameState.currentQuestion && matches) {
    const targetAns = gameState.currentQuestion.answer;
    for (const m of matches) {
      if (parseInt(m, 10) === targetAns) {
        isCorrect = true;
        break;
      }
    }
  }

  // Broadcast comment to overlay for live guess feed
  io.emit('guessFeed', {
    uniqueId,
    nickname,
    avatarUrl,
    comment,
    isCorrect
  });

  if (isCorrect) {
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
    totalQuestions: gameState.totalQuestionsPlayed
  };
}

// TikTok Connection Management
function connectTikTok(username) {
  const cleanUsername = username.replace(/^@/, '').trim();
  if (!cleanUsername) return;

  if (tiktokLiveConnection) {
    try { tiktokLiveConnection.disconnect(); } catch (e) {}
    tiktokLiveConnection = null;
  }

  gameState.tiktokUsername = cleanUsername;
  try {
    tiktokLiveConnection = new TikTokLiveConnection(cleanUsername, {
      processInitialData: false,
      enableExtendedGiftInfo: true
    });
  } catch (err) {
    gameState.isConnectedToTikTok = false;
    io.emit('tiktokStatus', { connected: false, error: err.message || err.toString() });
    io.emit('gameStateUpdate', getPublicState());
    return;
  }

  tiktokLiveConnection.connect()
    .then(state => {
      gameState.isConnectedToTikTok = true;
      const roomId = state && state.roomId ? state.roomId : 'LIVE';
      console.log(`[TikTok] Connected to LIVE room of @${cleanUsername} (Room ID: ${roomId})`);
      io.emit('tiktokStatus', { connected: true, username: cleanUsername, roomId });
      io.emit('gameStateUpdate', getPublicState());
    })
    .catch(err => {
      gameState.isConnectedToTikTok = false;
      console.error(`[TikTok] Connection error:`, err.toString());
      io.emit('tiktokStatus', { connected: false, error: err.message || err.toString() });
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
    io.emit('tiktokStatus', { connected: false, message: 'Disconnected from TikTok' });
    io.emit('gameStateUpdate', getPublicState());
  });

  tiktokLiveConnection.on('streamEnd', () => {
    gameState.isConnectedToTikTok = false;
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
  io.emit('tiktokStatus', { connected: false });
  io.emit('gameStateUpdate', getPublicState());
}

// Socket.IO Communication
io.on('connection', socket => {
  socket.emit('gameStateUpdate', getPublicState());

  socket.on('requestState', () => {
    socket.emit('gameStateUpdate', getPublicState());
  });

  // Admin Controls
  socket.on('setRunning', (running) => {
    gameState.isRunning = Boolean(running);
    if (gameState.isRunning && gameState.roundStatus === 'paused') {
      startNewRound();
    } else if (!gameState.isRunning) {
      gameState.roundStatus = 'paused';
    }
    io.emit('gameStateUpdate', getPublicState());
  });

  socket.on('setDifficulty', (diff) => {
    if (['easy', 'medium', 'hard'].includes(diff)) {
      gameState.difficulty = diff;
      io.emit('gameStateUpdate', getPublicState());
    }
  });

  socket.on('setDuration', (dur) => {
    const val = parseInt(dur, 10);
    if (val >= 5 && val <= 60) {
      gameState.roundDuration = val;
      io.emit('gameStateUpdate', getPublicState());
    }
  });

  socket.on('skipQuestion', () => {
    startNewRound();
  });

  socket.on('resetLeaderboard', () => {
    gameState.leaderboard = {};
    io.emit('gameStateUpdate', getPublicState());
  });

  socket.on('connectTikTok', ({ username }) => {
    connectTikTok(username);
  });

  socket.on('disconnectTikTok', () => {
    disconnectTikTok();
  });

  // Simulation / Test comments
  socket.on('simulateComment', ({ nickname, comment }) => {
    handleIncomingComment({
      uniqueId: 'sim_' + (nickname || 'tester').toLowerCase().replace(/\s+/g, '_'),
      nickname: nickname || 'Tester',
      avatarUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(nickname || 'test')}`,
      comment: String(comment || '')
    });
  });
});

// Start initial game
startNewRound();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`🎮 TikTok LIVE Interactive Math Game Server Started!`);
  console.log(`📺 OBS Overlay URL: http://localhost:${PORT}`);
  console.log(`🎛️  Control Panel:   http://localhost:${PORT}/control.html`);
  console.log(`=======================================================`);
});
