#!/usr/bin/env python3
"""TikTok LIVE Interaction Web Dashboard Server.
Provides full web controls for standalone streaming without OBS,
TikTok room creation, and math game integration.
"""
import collections
import os
import subprocess
import time
from flask import Flask, jsonify, render_template, request, send_from_directory
from flask_cors import CORS
import tiktok
from streamer import Streamer

app = Flask(__name__, static_folder="static", template_folder="templates")
CORS(app)

logs_queue = collections.deque(maxlen=100)

def log_event(msg):
    timestamp = time.strftime("%H:%M:%S")
    entry = f"[{timestamp}] {msg}"
    print(entry)
    logs_queue.append(entry)

streamer = Streamer(log_cb=log_event)

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/status", methods=["GET"])
def get_status():
    session = tiktok.session_status()
    stream_status = streamer.get_status()
    persisted_room = tiktok.get_active_room()
    return jsonify({
        "ok": True,
        "tiktok": session,
        "streamer": stream_status,
        "has_active_room": bool(persisted_room)
    })

@app.route("/api/logs", methods=["GET"])
def get_logs():
    return jsonify({
        "ok": True,
        "logs": list(logs_queue)
    })

@app.route("/api/stream/start", methods=["POST"])
def start_stream():
    data = request.get_json() or {}
    title = (data.get("title") or "Interactive TikTok LIVE").strip()
    overlay_url = (data.get("overlay_url") or "http://localhost:3000").strip()
    width = int(data.get("width") or 720)
    height = int(data.get("height") or 1280)
    fps = int(data.get("fps") or 30)
    bitrate = int(data.get("bitrate") or 2500)

    log_event(f"Request to start LIVE: '{title}' with overlay: {overlay_url}")

    # Check TikTok session first
    session = tiktok.session_status()
    if not session.get("ok"):
        return jsonify({"ok": False, "error": "No active TikTok login session detected. Please log in to TikTok in Chrome first."}), 400

    # 1. Create Room on TikTok
    try:
        log_event("Creating room on TikTok...")
        room = tiktok.create_room(log=log_event, title=title)
        log_event(f"Room created! Room ID: {room.get('room_id')}")
    except Exception as e:
        log_event(f"Failed to create TikTok room: {e}")
        return jsonify({"ok": False, "error": f"Failed to create TikTok room: {e}"}), 500

    rtmp_url = room.get("url")
    if not rtmp_url:
        return jsonify({"ok": False, "error": "No RTMP push URL received from TikTok"}), 500

    # 2. Start GStreamer Streamer
    success, msg = streamer.start(
        rtmp_url=rtmp_url,
        overlay_url=overlay_url,
        room_info=room,
        width=width,
        height=height,
        fps=fps,
        bitrate=bitrate
    )

    if not success:
        return jsonify({"ok": False, "error": msg}), 500

    return jsonify({
        "ok": True,
        "message": "Live stream started successfully!",
        "room": room
    })

@app.route("/api/stream/stop", methods=["POST"])
def stop_stream():
    room = streamer.current_room or tiktok.get_active_room()
    log_event("Request to stop LIVE stream")
    streamer.stop()

    closed_tiktok = False
    if room:
        try:
            log_event(f"Notifying TikTok that LIVE has ended (Room: {room.get('room_id')})...")
            closed_tiktok = tiktok.finish_room(log=log_event, room=room)
        except Exception as e:
            log_event(f"Notice on room finish: {e}")
    else:
        log_event("No active room record found to close.")

    tiktok.clear_active_room()
    streamer.current_room = None
    return jsonify({
        "ok": True,
        "closed_tiktok": closed_tiktok,
        "message": "Live stream stopped."
    })

@app.route("/api/stream/force-stop", methods=["POST"])
def force_stop_stream():
    log_event("⚡ [FORCE STOP] Request to forcefully terminate all live streams and close TikTok room!")

    # 1. Stop streamer class & kill all potential streaming processes
    streamer.stop()
    try:
        subprocess.run(["pkill", "-9", "-f", "Xvfb :99"], capture_output=True)
        subprocess.run(["pkill", "-9", "-f", "tt-stream-overlay-chrome"], capture_output=True)
        subprocess.run(["pkill", "-15", "obs"], capture_output=True)
        log_event("Cleaned up virtual display, chrome kiosk, and encoder processes.")
    except Exception as e:
        log_event(f"Process cleanup notice: {e}")

    # 2. Check and close room on TikTok server
    room = streamer.current_room or tiktok.get_active_room()
    closed_tiktok = False
    if room:
        try:
            log_event(f"Sending finish signal to TikTok server for Room ID: {room.get('room_id')}...")
            closed_tiktok = tiktok.finish_room(log=log_event, room=room)
            if closed_tiktok:
                log_event("✓ TikTok confirmed LIVE room has ended successfully!")
            else:
                log_event("TikTok finish ping sent.")
        except Exception as e:
            log_event(f"Error finishing TikTok room: {e}")
    else:
        log_event("No active room ID found. Cleaned up all local processes.")

    tiktok.clear_active_room()
    streamer.current_room = None
    streamer.is_streaming = False

    return jsonify({
        "ok": True,
        "closed_tiktok": closed_tiktok,
        "message": "Siaran live berhasil dihentikan secara paksa dan room TikTok telah ditutup."
    })

if __name__ == "__main__":
    PORT = int(os.environ.get("PORT", 8080))
    print(f"==================================================")
    print(f"🚀 TikTok LIVE Interaction Dashboard running!")
    print(f"👉 URL: http://localhost:{PORT}")
    print(f"==================================================")
    app.run(host="0.0.0.0", port=PORT, debug=False)
