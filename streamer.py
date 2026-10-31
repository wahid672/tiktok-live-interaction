#!/usr/bin/env python3
"""GStreamer-based standalone RTMP streamer for TikTok LIVE.
Captures the browser overlay window and desktop audio (Virtual_Sink)
and streams directly to TikTok's RTMP endpoint without OBS.
"""
import os
import shutil
import subprocess
import time
from urllib.parse import urlsplit
import gi
gi.require_version("Gst", "1.0")
from gi.repository import Gst, GLib

Gst.init(None)

# Ensure PulseAudio socket is known
if "PULSE_SERVER" not in os.environ:
    os.environ["PULSE_SERVER"] = "unix:/run/user/1000/pulse/native"

class Streamer:
    def __init__(self, log_cb=None):
        self.log_cb = log_cb or self._default_log
        self.pipe = None
        self.chrome_proc = None
        self.is_streaming = False
        self.start_time = None
        self.current_room = None
        self.rtmp_url = None
        self.overlay_url = None
        self.width = 720
        self.height = 1280
        self.fps = 30
        self.bitrate = 2500
        self.total_bytes = 0
        self.error = None

    def _default_log(self, msg):
        print(f"[Streamer] {msg}")

    def get_status(self):
        duration = 0
        if self.is_streaming and self.start_time:
            duration = int(time.time() - self.start_time)
        return {
            "is_streaming": self.is_streaming,
            "duration": duration,
            "width": self.width,
            "height": self.height,
            "fps": self.fps,
            "bitrate": self.bitrate,
            "overlay_url": self.overlay_url,
            "room_id": self.current_room.get("room_id") if self.current_room else None,
            "stream_title": self.current_room.get("title") if self.current_room else None,
            "error": self.error
        }

    def start(self, rtmp_url, overlay_url, room_info=None, width=720, height=1280, fps=30, bitrate=2500):
        if self.is_streaming:
            self.log_cb("Already streaming!")
            return False, "Already streaming"

        self.error = None
        self.width = int(width)
        self.height = int(height)
        self.fps = int(fps)
        self.bitrate = int(bitrate)
        self.rtmp_url = rtmp_url
        self.overlay_url = overlay_url
        self.current_room = room_info or {}

        # 1. Launch Browser Overlay window on DISPLAY=:1
        display = os.environ.get("DISPLAY", ":1")
        chrome_data_dir = "/tmp/tt-stream-overlay-chrome"
        try:
            shutil.rmtree(chrome_data_dir, ignore_errors=True)
        except Exception:
            pass

        chrome_cmd = [
            "google-chrome",
            f"--app={overlay_url}",
            f"--window-size={self.width},{self.height}",
            "--window-position=0,0",
            f"--user-data-dir={chrome_data_dir}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-background-networking",
            "--disable-sync",
            "--disable-features=Translate,OptimizationHints,MediaRouter",
            "--autoplay-policy=no-user-gesture-required"
        ]

        self.log_cb(f"Launching overlay browser for: {overlay_url}")
        env = os.environ.copy()
        env["DISPLAY"] = display
        env["PULSE_SERVER"] = "unix:/run/user/1000/pulse/native"
        self.chrome_proc = subprocess.Popen(chrome_cmd, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(2)  # Wait for window to render

        # 2. Build GStreamer Pipeline
        # Video: ximagesrc rectangle (0, 0, width, height)
        # Audio: Virtual_Sink.monitor
        # Muxer: flvmux -> rtmp2sink
        pipe_desc = (
            f'flvmux name=mux streamable=true ! rtmp2sink location="{rtmp_url}" '
            f'ximagesrc startx=0 starty=0 endx={self.width - 1} endy={self.height - 1} use-damage=0 ! '
            f'videoconvert ! video/x-raw,format=I420 ! videorate ! video/x-raw,framerate={self.fps}/1 ! '
            f'queue max-size-buffers=3 ! x264enc bitrate={self.bitrate} speed-preset=veryfast bframes=0 key-int-max={2 * self.fps} ! '
            f'h264parse ! queue ! mux.video '
            f'pulsesrc device="Virtual_Sink.monitor" provide-clock=false buffer-time=200000 latency-time=10000 ! '
            f'audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=2 ! '
            f'audioconvert ! avenc_aac bitrate=160000 ! aacparse ! queue ! mux.audio'
        )

        self.log_cb("Initializing GStreamer RTMP pipeline...")
        try:
            self.pipe = Gst.parse_launch(pipe_desc)
            self.pipe.use_clock(Gst.SystemClock.obtain())
            bus = self.pipe.get_bus()
            bus.add_signal_watch()
            bus.connect("message", self._on_bus_message)

            ret = self.pipe.set_state(Gst.State.PLAYING)
            if ret == Gst.StateChangeReturn.FAILURE:
                self.stop()
                self.error = "GStreamer pipeline failed to start"
                self.log_cb("ERROR: Pipeline set_state(PLAYING) returned FAILURE")
                return False, self.error

            self.is_streaming = True
            self.start_time = time.time()
            self.log_cb(f"Live stream successfully started! (Room: {self.current_room.get('room_id', 'N/A')})")
            return True, "Streaming started"
        except Exception as e:
            self.stop()
            self.error = str(e)
            self.log_cb(f"Pipeline initialization exception: {e}")
            return False, str(e)

    def _on_bus_message(self, bus, msg):
        if msg.type == Gst.MessageType.ERROR:
            err, debug = msg.parse_error()
            self.error = f"{msg.src.get_name()}: {err.message}"
            self.log_cb(f"Pipeline error from {msg.src.get_name()}: {err.message} (debug: {debug})")
            self.stop()
        elif msg.type == Gst.MessageType.EOS:
            self.log_cb("Pipeline received End-of-Stream (EOS)")
            self.stop()

    def stop(self):
        self.log_cb("Stopping stream...")
        self.is_streaming = False

        if self.pipe:
            try:
                self.pipe.send_event(Gst.Event.new_eos())
                time.sleep(0.5)
                self.pipe.set_state(Gst.State.NULL)
            except Exception:
                pass
            self.pipe = None

        if self.chrome_proc:
            try:
                self.chrome_proc.terminate()
                self.chrome_proc.wait(timeout=2)
            except Exception:
                try:
                    self.chrome_proc.kill()
                except Exception:
                    pass
            self.chrome_proc = None

        self.start_time = None
        self.log_cb("Live stream stopped successfully.")
        return True
