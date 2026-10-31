const socket = io();

// DOM elements
const tiktokUsernameInput = document.getElementById('tiktokUsernameInput');
const btnConnectTikTok = document.getElementById('btnConnectTikTok');
const btnDisconnectTikTok = document.getElementById('btnDisconnectTikTok');
const tiktokStatusText = document.getElementById('tiktokStatusText');

const btnTogglePlay = document.getElementById('btnTogglePlay');
const btnSkipQuestion = document.getElementById('btnSkipQuestion');
const btnResetLeaderboard = document.getElementById('btnResetLeaderboard');
const difficultySelect = document.getElementById('difficultySelect');
const durationSelect = document.getElementById('durationSelect');

const monitorQuestion = document.getElementById('monitorQuestion');
const monitorAnswer = document.getElementById('monitorAnswer');
const monitorTimeLeft = document.getElementById('monitorTimeLeft');

const simName = document.getElementById('simName');
const simComment = document.getElementById('simComment');
const btnSimulateGuess = document.getElementById('btnSimulateGuess');
const btnSimulateWinner = document.getElementById('btnSimulateWinner');

let currentGameState = null;

// Connect / Disconnect TikTok
btnConnectTikTok.addEventListener('click', () => {
  const username = tiktokUsernameInput.value.trim();
  if (!username) {
    alert('Silakan masukkan username TikTok Anda terlebih dahulu!');
    return;
  }
  btnConnectTikTok.disabled = true;
  btnConnectTikTok.textContent = 'Menghubungkan...';
  socket.emit('connectTikTok', { username });
});

btnDisconnectTikTok.addEventListener('click', () => {
  socket.emit('disconnectTikTok');
});

// Game Controls
btnTogglePlay.addEventListener('click', () => {
  if (!currentGameState) return;
  socket.emit('setRunning', !currentGameState.isRunning);
});

btnSkipQuestion.addEventListener('click', () => {
  socket.emit('skipQuestion');
});

btnResetLeaderboard.addEventListener('click', () => {
  if (confirm('Yakin ingin mereset papan skor leaderboard?')) {
    socket.emit('resetLeaderboard');
  }
});

difficultySelect.addEventListener('change', () => {
  socket.emit('setDifficulty', difficultySelect.value);
});

durationSelect.addEventListener('change', () => {
  socket.emit('setDuration', parseInt(durationSelect.value, 10));
});

// Simulation
btnSimulateGuess.addEventListener('click', () => {
  const name = simName.value.trim() || 'Tester';
  const comment = simComment.value.trim();
  if (!comment) return;
  socket.emit('simulateComment', { nickname: name, comment });
  simComment.value = '';
});

btnSimulateWinner.addEventListener('click', () => {
  if (!currentGameState || !currentGameState.currentQuestion) return;
  const name = simName.value.trim() || 'Pemenang Uji Coba';
  const ans = currentGameState.currentQuestion.answer;
  socket.emit('simulateComment', { nickname: name, comment: `${ans}` });
});

// Socket State Updates
socket.on('gameStateUpdate', (state) => {
  currentGameState = state;

  // Update Game Controls
  if (state.isRunning) {
    btnTogglePlay.textContent = '⏸️ Jeda Game';
    btnTogglePlay.className = 'btn-action btn-pause';
  } else {
    btnTogglePlay.textContent = '▶️ Lanjutkan Game';
    btnTogglePlay.className = 'btn-action btn-primary';
  }

  difficultySelect.value = state.difficulty;
  durationSelect.value = state.roundDuration;

  // Monitor Display
  if (state.currentQuestion) {
    monitorQuestion.textContent = `${state.currentQuestion.questionText} = ?`;
    monitorAnswer.textContent = state.currentQuestion.answer;
  }
  monitorTimeLeft.textContent = state.timeLeft;

  // TikTok Status
  if (state.isConnectedToTikTok) {
    tiktokStatusText.className = 'badge-connected';
    tiktokStatusText.textContent = `Terhubung ke @${state.tiktokUsername}`;
    btnConnectTikTok.style.display = 'none';
    btnDisconnectTikTok.style.display = 'inline-block';
    tiktokUsernameInput.disabled = true;
  } else {
    tiktokStatusText.className = 'badge-disconnected';
    tiktokStatusText.textContent = 'Belum Terhubung';
    btnConnectTikTok.style.display = 'inline-block';
    btnConnectTikTok.disabled = false;
    btnConnectTikTok.textContent = 'Hubungkan';
    btnDisconnectTikTok.style.display = 'none';
    tiktokUsernameInput.disabled = false;
  }
});

socket.on('timerTick', ({ timeLeft }) => {
  monitorTimeLeft.textContent = timeLeft;
});

socket.on('tiktokStatus', (data) => {
  if (data.connected) {
    tiktokStatusText.className = 'badge-connected';
    tiktokStatusText.textContent = `Terhubung ke @${data.username}`;
    btnConnectTikTok.style.display = 'none';
    btnDisconnectTikTok.style.display = 'inline-block';
  } else {
    tiktokStatusText.className = 'badge-disconnected';
    tiktokStatusText.textContent = data.error ? `Error: ${data.error}` : 'Belum Terhubung';
    btnConnectTikTok.style.display = 'inline-block';
    btnConnectTikTok.disabled = false;
    btnConnectTikTok.textContent = 'Hubungkan';
    btnDisconnectTikTok.style.display = 'none';
  }
});
