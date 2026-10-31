// TikTok LIVE Interaction Frontend Controller

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const tiktokStatusBadge = document.getElementById('tiktokStatusBadge');
  const streamStatusBadge = document.getElementById('streamStatusBadge');
  const streamDurationBadge = document.getElementById('streamDurationBadge');
  const streamTimer = document.getElementById('streamTimer');
  
  const startStreamBtn = document.getElementById('startStreamBtn');
  const stopStreamBtn = document.getElementById('stopStreamBtn');
  
  const streamTitle = document.getElementById('streamTitle');
  const overlayUrl = document.getElementById('overlayUrl');
  const streamResolution = document.getElementById('streamResolution');
  const streamFps = document.getElementById('streamFps');
  
  const reloadPreviewBtn = document.getElementById('reloadPreviewBtn');
  const previewIframe = document.getElementById('previewIframe');
  const openOverlayLink = document.getElementById('openOverlayLink');
  
  const navForceStopBtn = document.getElementById('navForceStopBtn');
  const forceStopStreamBtn = document.getElementById('forceStopStreamBtn');
  
  const logsTerminal = document.getElementById('logsTerminal');
  const clearLogsBtn = document.getElementById('clearLogsBtn');
  
  const tiktokUsernameInput = document.getElementById('tiktokUsernameInput');
  const connectTTChatBtn = document.getElementById('connectTTChatBtn');
  const chatConnectStatus = document.getElementById('chatConnectStatus');
  const gameControlIframe = document.getElementById('gameControlIframe');

  // State
  let isStreaming = false;
  let timerInterval = null;
  let streamDurationSeconds = 0;

  const ROCKET_SVG = `<svg class="btn-icon-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
  const SPINNER_SVG = `<svg class="btn-icon-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></circle></svg>`;
  const BOLT_SVG = `<svg class="icon-svg" viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path></svg>`;

  // 1. Tab Switching
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      
      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      document.getElementById(targetId)?.classList.add('active');
    });
  });

  // 2. Preview URL update
  function updatePreview() {
    const url = overlayUrl.value.trim() || 'http://localhost:3000';
    previewIframe.src = url;
    openOverlayLink.href = url;
  }

  reloadPreviewBtn.addEventListener('click', updatePreview);
  overlayUrl.addEventListener('change', updatePreview);

  // 3. Format Duration Timer
  function formatTime(seconds) {
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  // 4. Status Polling
  async function checkStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      if (!data.ok) return;

      // TikTok session badge
      const tt = data.tiktok;
      if (tt && tt.ok) {
        tiktokStatusBadge.innerHTML = `
          <span class="dot green"></span>
          <span class="label">TikTok: ${tt.browser}</span>
        `;
      } else {
        tiktokStatusBadge.innerHTML = `
          <span class="dot red"></span>
          <span class="label">TikTok Belum Login di Chrome</span>
        `;
      }

      // Streaming badge
      const streamer = data.streamer;
      if (streamer && streamer.is_streaming) {
        if (!isStreaming) {
          isStreaming = true;
          startStreamBtn.classList.add('hidden');
          stopStreamBtn.classList.remove('hidden');
        }
        streamStatusBadge.innerHTML = `
          <span class="dot red"></span>
          <span class="label" style="color: #f43f5e; font-weight: 800;">🔴 LIVE TIKTOK</span>
        `;
        streamTimer.textContent = formatTime(streamer.duration || 0);
      } else {
        if (isStreaming) {
          isStreaming = false;
          startStreamBtn.classList.remove('hidden');
          stopStreamBtn.classList.add('hidden');
        }
        streamStatusBadge.innerHTML = `
          <span class="dot gray"></span>
          <span class="label">OFFLINE</span>
        `;
        streamTimer.textContent = '00:00:00';
      }
    } catch (err) {
      console.warn('Status check error:', err);
    }
  }

  // 5. Fetch Logs
  async function fetchLogs() {
    try {
      const res = await fetch('/api/logs');
      const data = await res.json();
      if (data.ok && Array.isArray(data.logs)) {
        if (data.logs.length > 0) {
          logsTerminal.innerHTML = data.logs.map(line => `<div class="log-line">${line}</div>`).join('');
          logsTerminal.scrollTop = logsTerminal.scrollHeight;
        }
      }
    } catch (e) {}
  }

  clearLogsBtn.addEventListener('click', () => {
    logsTerminal.innerHTML = '<div class="log-line text-muted">Tampilan log dibersihkan.</div>';
  });

  // 6. Start Live
  startStreamBtn.addEventListener('click', async () => {
    const title = streamTitle.value.trim() || 'Live Kuis Matematika Seru!';
    const url = overlayUrl.value.trim() || 'http://localhost:3000';
    const [w, h] = streamResolution.value.split('x').map(Number);
    const [fps, bitrate] = streamFps.value.split('|').map(Number);

    startStreamBtn.disabled = true;
    startStreamBtn.innerHTML = `${SPINNER_SVG} Menghubungkan ke TikTok...`;

    try {
      const res = await fetch('/api/stream/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          overlay_url: url,
          width: w,
          height: h,
          fps,
          bitrate
        })
      });

      const data = await res.json();
      if (!data.ok) {
        alert('Gagal memulai Live: ' + (data.error || 'Unknown error'));
        startStreamBtn.disabled = false;
        startStreamBtn.innerHTML = `${ROCKET_SVG} Mulai Live Sekarang`;
        return;
      }

      // Success
      isStreaming = true;
      startStreamBtn.classList.add('hidden');
      stopStreamBtn.classList.remove('hidden');
      startStreamBtn.disabled = false;
      startStreamBtn.innerHTML = `${ROCKET_SVG} Mulai Live Sekarang`;
      checkStatus();

      // Automatically inform embedded game control to connect
      if (gameControlIframe && gameControlIframe.contentWindow && data.room) {
        setTimeout(() => {
          gameControlIframe.contentWindow.postMessage({
            type: 'CONNECT_TIKTOK',
            username: data.room.user || 'wahid_studio',
            roomId: data.room.room_id
          }, '*');
        }, 1000);
      }
    } catch (err) {
      alert('Terjadi kesalahan jaringan: ' + err.message);
      startStreamBtn.disabled = false;
      startStreamBtn.innerHTML = '<span class="btn-icon">🚀</span> Mulai Live Sekarang';
    }
  });

  // 7. Stop Live
  stopStreamBtn.addEventListener('click', async () => {
    if (!confirm('Apakah Anda yakin ingin mengakhiri live streaming TikTok?')) return;

    stopStreamBtn.disabled = true;
    stopStreamBtn.innerHTML = '<span class="btn-icon">⏳</span> Mengakhiri Live...';

    try {
      const res = await fetch('/api/stream/stop', { method: 'POST' });
      const data = await res.json();
      
      isStreaming = false;
      startStreamBtn.classList.remove('hidden');
      stopStreamBtn.classList.add('hidden');
      stopStreamBtn.disabled = false;
      stopStreamBtn.innerHTML = '<span class="btn-icon">⏹️</span> Akhiri Live';
      checkStatus();
    } catch (err) {
      alert('Gagal menghentikan live: ' + err.message);
      stopStreamBtn.disabled = false;
      stopStreamBtn.innerHTML = '<span class="btn-icon">⏹️</span> Akhiri Live';
    }
  });

  // 7.1 Force Stop Live (Terminates processes and forcefully finishes TikTok room)
  async function handleForceStop() {
    if (!confirm('⚠️ PAKSA HENTIKAN LIVE?\n\nTindakan ini akan:\n1. Mengirim sinyal resmi penutupan room ke server TikTok agar live tidak mengambang.\n2. Mematikan semua proses streaming latar belakang (GStreamer, Chrome Kiosk, Xvfb).\n\nLanjutkan?')) return;

    const btns = [navForceStopBtn, forceStopStreamBtn].filter(Boolean);
    btns.forEach(b => {
      b.disabled = true;
      b.textContent = '⏳ Memaksa Henti...';
    });

    try {
      const res = await fetch('/api/stream/force-stop', { method: 'POST' });
      const data = await res.json();
      alert(data.message || 'Force stop berhasil dieksekusi!');
      isStreaming = false;
      startStreamBtn.classList.remove('hidden');
      stopStreamBtn.classList.add('hidden');
      checkStatus();
      fetchLogs();
    } catch (err) {
      alert('Terjadi kesalahan saat force stop: ' + err.message);
    } finally {
      if (navForceStopBtn) {
        navForceStopBtn.disabled = false;
        navForceStopBtn.innerHTML = `${BOLT_SVG} Force Stop`;
      }
      if (forceStopStreamBtn) {
        forceStopStreamBtn.disabled = false;
        forceStopStreamBtn.innerHTML = `${BOLT_SVG} Force Stop LIVE (Paksa Tutup Room TikTok & Matikan Semua Proses)`;
      }
    }
  }

  navForceStopBtn?.addEventListener('click', handleForceStop);
  forceStopStreamBtn?.addEventListener('click', handleForceStop);

  // 8. Connect TikTok Chat in Math Game
  connectTTChatBtn.addEventListener('click', () => {
    const user = tiktokUsernameInput.value.trim();
    if (!user) return alert('Masukkan username TikTok Anda');

    try {
      // Send message to embedded iframe
      gameControlIframe.contentWindow.postMessage({
        type: 'CONNECT_TIKTOK',
        username: user
      }, '*');
      chatConnectStatus.textContent = `Menghubungkan ke @${user}... Cek panel game di bawah.`;
      chatConnectStatus.style.color = '#10b981';
    } catch (e) {
      chatConnectStatus.textContent = 'Gagal mengirim instruksi ke frame game.';
    }
  });

  // Start polling
  checkStatus();
  fetchLogs();
  setInterval(checkStatus, 2500);
  setInterval(fetchLogs, 2500);
});
