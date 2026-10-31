const socket = io();

// DOM elements
const tiktokUsernameInput = document.getElementById('tiktokUsernameInput');
const btnConnectTikTok = document.getElementById('btnConnectTikTok');
const btnDisconnectTikTok = document.getElementById('btnDisconnectTikTok');
const tiktokStatusText = document.getElementById('tiktokStatusText');

const streamDetectBanner = document.getElementById('streamDetectBanner');
const livePulseDot = document.getElementById('livePulseDot');
const streamDetectMsg = document.getElementById('streamDetectMsg');
const btnQuickConnect = document.getElementById('btnQuickConnect');

const btnTogglePlay = document.getElementById('btnTogglePlay');
const togglePlayText = document.getElementById('togglePlayText');
const btnSkipQuestion = document.getElementById('btnSkipQuestion');
const btnResetLeaderboard = document.getElementById('btnResetLeaderboard');
const difficultySelect = document.getElementById('difficultySelect');
const durationSelect = document.getElementById('durationSelect');

const monitorQuestion = document.getElementById('monitorQuestion');
const monitorAnswer = document.getElementById('monitorAnswer');
const monitorTimeLeft = document.getElementById('monitorTimeLeft');

// Comments Feed elements
const commentCountBadge = document.getElementById('commentCountBadge');
const btnClearComments = document.getElementById('btnClearComments');
const commentsFeedWrapper = document.getElementById('commentsFeedWrapper');
const emptyCommentsState = document.getElementById('emptyCommentsState');
const commentsList = document.getElementById('commentsList');

// Simulator elements
const simName = document.getElementById('simName');
const simComment = document.getElementById('simComment');
const btnSimulateGuess = document.getElementById('btnSimulateGuess');
const btnSimulateWinner = document.getElementById('btnSimulateWinner');

let currentGameState = null;
let totalComments = 0;

// Format timestamp
function formatTime(ts) {
  const d = ts ? new Date(ts) : new Date();
  return d.toTimeString().split(' ')[0];
}

// Add comment to feed
function addCommentToFeed(c, shouldScroll = true) {
  if (emptyCommentsState) {
    emptyCommentsState.style.display = 'none';
  }

  totalComments++;
  if (commentCountBadge) {
    commentCountBadge.textContent = `${totalComments} komentar`;
  }

  const item = document.createElement('div');
  item.className = `comment-item ${c.isCorrect ? 'correct' : ''}`;

  const initial = (c.nickname || 'P').charAt(0).toUpperCase();
  const avatarHtml = (c.avatarUrl && !c.avatarUrl.includes('default-avatar'))
    ? `<img src="${c.avatarUrl}" alt="${c.nickname}" onerror="this.onerror=null;this.parentElement.textContent='${initial}';">`
    : initial;

  item.innerHTML = `
    <div class="comment-avatar">${avatarHtml}</div>
    <div class="comment-body">
      <div class="comment-header">
        <span class="comment-user">@${c.nickname || 'Penonton'}</span>
        <span class="comment-time">${formatTime(c.timestamp)}</span>
        ${c.isCorrect ? '<span class="tag-correct">🏆 JAWABAN BENAR</span>' : ''}
      </div>
      <div class="comment-text">${escapeHtml(c.comment || '')}</div>
    </div>
  `;

  commentsList.appendChild(item);

  // Keep list from growing unboundedly in DOM
  while (commentsList.children.length > 80) {
    commentsList.removeChild(commentsList.firstChild);
  }

  if (shouldScroll && commentsFeedWrapper) {
    commentsFeedWrapper.scrollTop = commentsFeedWrapper.scrollHeight;
  }
}

function escapeHtml(str) {
  return str.replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}

// Clear comments
if (btnClearComments) {
  btnClearComments.addEventListener('click', () => {
    socket.emit('clearComments');
  });
}

socket.on('commentsCleared', () => {
  commentsList.innerHTML = '';
  totalComments = 0;
  if (commentCountBadge) commentCountBadge.textContent = '0 komentar';
  if (emptyCommentsState) emptyCommentsState.style.display = 'flex';
});

socket.on('commentsHistory', (history) => {
  commentsList.innerHTML = '';
  totalComments = 0;
  if (history && history.length > 0) {
    if (emptyCommentsState) emptyCommentsState.style.display = 'none';
    history.forEach(c => addCommentToFeed(c, false));
    if (commentsFeedWrapper) commentsFeedWrapper.scrollTop = commentsFeedWrapper.scrollHeight;
  } else {
    if (emptyCommentsState) emptyCommentsState.style.display = 'flex';
    if (commentCountBadge) commentCountBadge.textContent = '0 komentar';
  }
});

socket.on('chatComment', (commentObj) => {
  addCommentToFeed(commentObj, true);
});

// Connect / Disconnect TikTok
btnConnectTikTok.addEventListener('click', () => {
  const val = tiktokUsernameInput.value.trim();
  if (!val) {
    alert('Silakan masukkan username TikTok atau Room ID Anda terlebih dahulu!');
    return;
  }
  btnConnectTikTok.disabled = true;
  btnConnectTikTok.textContent = 'Menghubungkan...';
  tiktokStatusText.className = 'badge-disconnected';
  tiktokStatusText.style.color = '#f59e0b';
  tiktokStatusText.style.borderColor = '#f59e0b';
  tiktokStatusText.textContent = `⏳ Menghubungkan ke ${val}...`;

  const isNumericRoom = /^\d{15,22}$/.test(val);
  socket.emit('connectTikTok', {
    username: isNumericRoom ? '' : val,
    roomId: isNumericRoom ? val : null
  });
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

  // Auto-fill username if empty
  if (state.tiktokUsername && !tiktokUsernameInput.value) {
    tiktokUsernameInput.value = state.tiktokUsername;
  }

  // Active Stream Detection Banner
  if (state.activeRoom && state.activeRoom.room_id) {
    livePulseDot.className = 'live-pulse-dot active';
    streamDetectMsg.innerHTML = `<strong>🟢 Siaran LIVE Aktif di TikTok!</strong> Room ID: <code>${state.activeRoom.room_id}</code>`;
    if (!state.isConnectedToTikTok) {
      btnQuickConnect.style.display = 'inline-block';
      btnQuickConnect.onclick = () => {
        btnQuickConnect.disabled = true;
        btnQuickConnect.textContent = 'Menghubungkan...';
        socket.emit('connectTikTok', {
          roomId: state.activeRoom.room_id,
          username: state.activeRoom.user
        });
      };
    } else {
      btnQuickConnect.style.display = 'none';
    }
  } else {
    livePulseDot.className = 'live-pulse-dot';
    streamDetectMsg.textContent = 'Siaran LIVE TikTok belum dimulai. Klik "Mulai Live Sekarang" di Dashboard (port 8080) terlebih dahulu.';
    btnQuickConnect.style.display = 'none';
  }

  // Update Game Controls
  if (state.isRunning) {
    togglePlayText.textContent = 'Jeda Game';
    btnTogglePlay.className = 'btn-action btn-pause';
  } else {
    togglePlayText.textContent = 'Lanjutkan Game';
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
    tiktokStatusText.style.color = '#10b981';
    tiktokStatusText.style.borderColor = '#10b981';
    tiktokStatusText.textContent = `🟢 Terhubung ke live chat @${state.tiktokUsername}`;
    btnConnectTikTok.style.display = 'none';
    btnDisconnectTikTok.style.display = 'inline-block';
    tiktokUsernameInput.disabled = true;
  } else {
    btnConnectTikTok.style.display = 'inline-block';
    btnConnectTikTok.disabled = false;
    btnConnectTikTok.textContent = 'Hubungkan';
    btnDisconnectTikTok.style.display = 'none';
    tiktokUsernameInput.disabled = false;

    if (state.lastError) {
      tiktokStatusText.className = 'badge-disconnected';
      tiktokStatusText.style.color = '#f87171';
      tiktokStatusText.style.borderColor = 'rgba(239, 68, 68, 0.3)';
      tiktokStatusText.textContent = `❌ ${state.lastError}`;
    } else {
      tiktokStatusText.className = 'badge-disconnected';
      tiktokStatusText.style.color = '#8b92a8';
      tiktokStatusText.style.borderColor = 'rgba(255, 255, 255, 0.1)';
      tiktokStatusText.textContent = 'Belum Terhubung';
    }
  }
});

socket.on('timerTick', ({ timeLeft }) => {
  monitorTimeLeft.textContent = timeLeft;
});

socket.on('tiktokStatus', (data) => {
  if (data.connected) {
    tiktokStatusText.className = 'badge-connected';
    tiktokStatusText.style.color = '#10b981';
    tiktokStatusText.style.borderColor = '#10b981';
    tiktokStatusText.textContent = `🟢 Terhubung ke live chat @${data.username} (Room ID: ${data.roomId || 'LIVE'})`;
    btnConnectTikTok.style.display = 'none';
    btnDisconnectTikTok.style.display = 'inline-block';
    tiktokUsernameInput.disabled = true;
    if (btnQuickConnect) btnQuickConnect.style.display = 'none';
  } else {
    btnConnectTikTok.style.display = 'inline-block';
    btnConnectTikTok.disabled = false;
    btnConnectTikTok.textContent = 'Hubungkan';
    btnDisconnectTikTok.style.display = 'none';
    tiktokUsernameInput.disabled = false;
    if (btnQuickConnect) btnQuickConnect.disabled = false;

    tiktokStatusText.className = 'badge-disconnected';
    tiktokStatusText.style.color = '#f87171';
    tiktokStatusText.style.borderColor = 'rgba(239, 68, 68, 0.3)';
    tiktokStatusText.textContent = data.error ? `❌ ${data.error}` : 'Belum Terhubung';
  }
});

// Cross-frame messaging from Web Dashboard
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CONNECT_TIKTOK') {
    const user = event.data.username;
    const roomId = event.data.roomId;
    if (roomId || user) {
      if (user) tiktokUsernameInput.value = user;
      socket.emit('connectTikTok', { username: user, roomId });
    }
  }
});
