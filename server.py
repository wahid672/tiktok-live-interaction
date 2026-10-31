#!/usr/bin/env python3
"""TikTok LIVE Interaction Web Dashboard Server.
Provides full web controls for standalone streaming without OBS,
TikTok room creation, and math game integration.
"""
import collections
import os
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
    return jsonify({
        "ok": True,
        "tiktok": session,
        "streamer": stream_status
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
    room = streamer.current_room
    log_event("Request to stop LIVE stream")
    streamer.stop()

    if room:
        try:
            log_event("Notifying TikTok that LIVE has ended...")
            tiktok.finish_room(log=log_event, room=room)
        except Exception as e:
            log_event(f"Notice on room finish: {e}")

    return jsonify({"ok": True, "message": "Live stream stopped."})

if __name__ == "__main__":
    PORT = int(os.environ.get("PORT", 8080))
    print(f"==================================================")
    print(f"🚀 TikTok LIVE Interaction Dashboard running!")
    print(f"👉 URL: http://localhost:{PORT}")
    print(f"==================================================")
    app.run(host="0.0.0.0", port=PORT, debug=False)
