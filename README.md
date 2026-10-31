# TikTok LIVE Interaction

> **Standalone TikTok LIVE RTMP Streamer & Interactive Web Dashboard (No OBS Needed)**

[![Platform](https://img.shields.io/badge/platform-Linux-blue.svg)](https://www.debian.org/)
[![Python](https://img.shields.io/badge/python-3.10%2B-brightgreen.svg)](https://www.python.org/)
[![GStreamer](https://img.shields.io/badge/gstreamer-1.0-orange.svg)](https://gstreamer.freedesktop.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-purple.svg)](LICENSE)

**TikTok LIVE Interaction** is a complete, lightweight suite designed for content creators and streamers on Linux. It combines a **standalone live stream engine** (streaming directly to TikTok without OBS Studio) with a **real-time interactive math guessing game** that responds to TikTok live chat comments.

---

## ✨ Key Features

- 🚀 **Stream Directly Without OBS Studio**: Uses an optimized GStreamer A/V pipeline to encode H.264 video and AAC audio directly to TikTok's RTMP ingest servers.
- 🌐 **Custom Web Overlay Support**: Render any web application or overlay URL (e.g., `http://localhost:3000`, Streamlabs, custom HTML5 widgets) directly into the live broadcast stream.
- 🔑 **Automatic TikTok Authentication**: Reads active session cookies from Google Chrome or Chromium to generate rooms and retrieve RTMP push URLs automatically—no manual stream key copying required.
- 🎮 **Built-in Interactive Math Game**:
  - Live vertical (9:16) neon glassmorphic quiz display.
  - Real-time TikTok live chat reader using WebSocket connection.
  - Automatic winner celebration with synthesized Web Audio sound effects and confetti animations.
  - Dynamic leaderboard tracking top players and win streaks.
- 🎛️ **Unified Web Dashboard**:
  - Clean glassmorphism dark-mode control panel.
  - One-click **Start LIVE** and **Stop LIVE** buttons.
  - Real-time stream duration, FPS, and bitrate monitoring.
  - Integrated 9:16 mobile monitor preview.

---

## 🏗️ Architecture

```
                                  ┌──────────────────────────────┐
                                  │   TikTok Web Session         │
                                  │   (Chrome / Chromium Cookie) │
                                  └──────────────┬───────────────┘
                                                 │
                                                 ▼
┌─────────────────────────┐          ┌───────────────────────────┐
│  Interactive Math Game  │          │   TikTok Room Creator     │
│  (Node.js + Socket.io)  ├─────────►│   (Python REST API)       │
└────────────┬────────────┘          └───────────┬───────────────┘
             │                                   │ RTMP Push URL
             ▼                                   ▼
┌─────────────────────────┐          ┌───────────────────────────┐
│ Browser Overlay Window  │          │  GStreamer Stream Engine  │
│ (720x1280 / 1080x1920)  ├─────────►│  ximagesrc + pulsesrc     ├─────► TikTok LIVE RTMP
└─────────────────────────┘          │  H.264 (x264) + AAC       │       (Ingest Servers)
                                     └───────────────────────────┘
```

---

## 📋 Prerequisites

- **OS**: Linux (Debian 12/13, Ubuntu 22.04/24.04, Arch, or Fedora)
- **Python**: Python 3.10+ with `PyGObject` (GStreamer bindings) and `Flask`
- **GStreamer**: `gstreamer1.0-tools`, `gstreamer1.0-plugins-good`, `gstreamer1.0-plugins-bad`, `gstreamer1.0-plugins-ugly`, `gstreamer1.0-libav`
- **Audio**: PulseAudio or PipeWire with virtual sink enabled
- **Browser**: Google Chrome or Chromium (logged in to [tiktok.com](https://www.tiktok.com))
- **Node.js**: v18+ (for the interactive math game)

---

## 🚀 Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/wahid672/tiktok-live-interaction.git
cd tiktok-live-interaction
```

### 2. Set Up Python Environment

```bash
python3 -m venv --system-site-packages venv
source venv/bin/activate
pip install flask flask-cors requests
```

### 3. Install Math Game Dependencies

```bash
cd game
npm install
cd ..
```

### 4. Start the Application

Run the launcher script:

```bash
chmod +x start.sh
./start.sh
```

Open your browser and navigate to:
```
http://localhost:8080
```

---

## 📖 How to Go LIVE in 3 Steps

1. **Log in to TikTok**:
   Open Google Chrome on your Linux desktop, navigate to [tiktok.com](https://www.tiktok.com), and log in to your account.
2. **Open Dashboard**:
   Go to `http://localhost:8080`. The dashboard will automatically detect your active TikTok session.
3. **Start Streaming**:
   - Enter your desired **Live Title**.
   - Ensure the **Overlay URL** is set to `http://localhost:3000` (or your custom web app).
   - Click **🚀 Mulai Live Sekarang (Start LIVE)**.

Your stream will immediately begin broadcasting to TikTok LIVE!

---

## 📁 Project Structure

```
tiktok-live-interaction/
├── game/                    # Interactive Math Game Engine
│   ├── public/              # HTML5, CSS, and Web Audio SFX assets
│   ├── package.json         # Node.js dependencies
│   └── server.js            # Express & TikTok live chat connector
├── static/                  # Web Dashboard assets (CSS, JS)
│   ├── app.css              # Glassmorphic dark styling
│   └── app.js               # Reactive dashboard logic & polling
├── templates/               # Dashboard HTML templates
│   └── index.html           # Main Web Dashboard UI
├── streamer.py              # Standalone GStreamer RTMP stream engine
├── tiktok.py                # TikTok session detection & room API
├── server.py                # Flask Web Dashboard backend
├── start.sh                 # One-click launcher script
└── README.md                # Documentation
```

---

## ⚙️ Configuration & Customization

| Setting | Default | Options | Description |
| :--- | :--- | :--- | :--- |
| **Canvas Resolution** | `720x1280` | `720x1280`, `1080x1920` | Standard TikTok 9:16 vertical stream resolutions |
| **Framerate** | `30 FPS` | `25`, `30`, `60` | Recommended: 30 FPS for stable low-latency uplink |
| **Video Bitrate** | `2500 kbps` | `2000` - `6000 kbps` | H.264 video bitrate encoded via `x264enc` |
| **Audio Ingest** | `Virtual_Sink` | Default PulseAudio monitor | Captures desktop sounds and web audio synthesized effects |

---

## 🛡️ License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
