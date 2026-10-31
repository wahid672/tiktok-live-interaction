const socket = io();

// DOM elements
const mathProblem = document.getElementById('mathProblem');
const difficultyBadge = document.getElementById('difficultyBadge');
const questionCount = document.getElementById('questionCount');
const timerBar = document.getElementById('timerBar');
const timerText = document.getElementById('timerText');
const liveStatusText = document.getElementById('liveStatusText');

const winnerModal = document.getElementById('winnerModal');
const winnerAvatar = document.getElementById('winnerAvatar');
const winnerName = document.getElementById('winnerName');
const winnerPoints = document.getElementById('winnerPoints');
const winnerAnswerNum = document.getElementById('winnerAnswerNum');

const timeoutModal = document.getElementById('timeoutModal');
const timeoutAnswerNum = document.getElementById('timeoutAnswerNum');

const guessFeed = document.getElementById('guessFeed');
const leaderboardList = document.getElementById('leaderboardList');

let currentRoundDuration = 20;

// Initialize Web Audio on first user interaction
window.addEventListener('click', () => {
  if (window.soundFX) window.soundFX.init();
}, { once: true });

// Socket Events
socket.on('gameStateUpdate', (state) => {
  currentRoundDuration = state.roundDuration || 20;
  if (state.totalQuestions) questionCount.textContent = state.totalQuestions;

  if (state.currentQuestion) {
    updateQuestionDisplay(state.currentQuestion);
  }

  updateTimer(state.timeLeft, currentRoundDuration);
  renderLeaderboard(state.leaderboard || []);

  if (state.isConnectedToTikTok) {
    liveStatusText.textContent = `@${state.tiktokUsername} (ONLINE)`;
  } else {
    liveStatusText.textContent = 'MODE LOKAL / DEMO';
  }
});

socket.on('newRound', (data) => {
  hideModals();
  questionCount.textContent = data.totalQuestions;
  currentRoundDuration = data.timeLeft || 20;
  updateQuestionDisplay(data.question);
  updateTimer(data.timeLeft, currentRoundDuration);
  if (window.soundFX) window.soundFX.playPop();
});

socket.on('timerTick', ({ timeLeft }) => {
  updateTimer(timeLeft, currentRoundDuration);
  if (timeLeft <= 5 && timeLeft > 0) {
    if (window.soundFX) window.soundFX.playTick();
  }
});

socket.on('roundWinner', ({ winner, correctAnswer, leaderboard }) => {
  if (window.soundFX) window.soundFX.playWinFanfare();

  // Trigger Confetti
  if (typeof confetti === 'function') {
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 }
    });
  }

  winnerName.textContent = winner.nickname || winner.uniqueId;
  winnerAvatar.src = winner.avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(winner.uniqueId)}`;
  winnerPoints.textContent = `+${winner.pointsEarned} POIN`;
  winnerAnswerNum.textContent = correctAnswer;

  winnerModal.classList.add('show');
  renderLeaderboard(leaderboard);
});

socket.on('roundTimeout', ({ correctAnswer }) => {
  if (window.soundFX) window.soundFX.playBuzzer();

  timeoutAnswerNum.textContent = correctAnswer;
  timeoutModal.classList.add('show');
});

socket.on('guessFeed', (data) => {
  if (window.soundFX && !data.isCorrect) window.soundFX.playPop();
  addGuessBadge(data);
});

function hideModals() {
  winnerModal.classList.remove('show');
  timeoutModal.classList.remove('show');
}

function updateQuestionDisplay(q) {
  mathProblem.innerHTML = `<span class="calc-text">${q.questionText} = ?</span>`;

  const diffMap = {
    'easy': 'MUDAH',
    'medium': 'SEDANG',
    'hard': 'SULIT'
  };
  difficultyBadge.textContent = diffMap[q.difficulty] || 'SEDANG';
}

function updateTimer(seconds, total) {
  timerText.textContent = `${seconds}s`;
  const pct = Math.max(0, Math.min(100, (seconds / (total || 20)) * 100));
  timerBar.style.width = `${pct}%`;

  if (seconds <= 5) {
    timerBar.classList.add('warning');
    timerText.classList.add('warning');
  } else {
    timerBar.classList.remove('warning');
    timerText.classList.remove('warning');
  }
}

function addGuessBadge(guess) {
  const badge = document.createElement('div');
  badge.className = `guess-badge ${guess.isCorrect ? 'correct' : ''}`;
  badge.innerHTML = `
    <span class="guess-user">${escapeHtml(guess.nickname || guess.uniqueId)}:</span>
    <span class="guess-comment">${escapeHtml(guess.comment)} ${guess.isCorrect ? '🎉' : ''}</span>
  `;

  guessFeed.prepend(badge);

  // Keep max 3 items
  while (guessFeed.children.length > 3) {
    guessFeed.removeChild(guessFeed.lastChild);
  }
}

function renderLeaderboard(list) {
  if (!list || list.length === 0) {
    leaderboardList.innerHTML = `<div class="lb-empty">Belum ada pemenang ronde. Jadilah yang pertama!</div>`;
    return;
  }

  const medals = ['🥇', '🥈', '🥉', '4', '5'];
  leaderboardList.innerHTML = list.slice(0, 5).map((user, idx) => {
    const avatar = user.avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(user.uniqueId)}`;
    return `
      <div class="lb-item">
        <div class="lb-left">
          <span class="lb-rank">${medals[idx]}</span>
          <img class="lb-avatar" src="${avatar}" alt="${escapeHtml(user.nickname)}">
          <span class="lb-name">${escapeHtml(user.nickname)}</span>
        </div>
        <div class="lb-score">${user.points} pts</div>
      </div>
    `;
  }).join('');
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
