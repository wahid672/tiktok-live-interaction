#!/usr/bin/env python3
"""GStreamer-based standalone RTMP streamer for TikTok LIVE.
Uses an isolated virtual display (Xvfb :99) at exact vertical 720x1280 / 1080x1920
so that ONLY the clean web overlay is captured (no desktop leakage)
and streamed natively in 9:16 vertical orientation to TikTok LIVE.
"""
import os
import shutil
import subprocess
import time
from urllib.parse import urlsplit
import gi
gi.require_version("Gst", "1.0")
from gi.repository import Gst

Gst.init(None)

# Ensure PulseAudio socket is set
if "PULSE_SERVER" not in os.environ:
    os.environ["PULSE_SERVER"] = "unix:/run/user/1000/pulse/native"

VIRTUAL_DISPLAY = ":99"

class Streamer:
    def __init__(self, log_cb=None):
        self.log_cb = log_cb or self._default_log
        self.pipe = None
        self.xvfb_proc = None
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

    def _cleanup_locks(self):
        for lock in ["/tmp/.X99-lock", "/tmp/.X11-unix/X99"]:
            if os.path.exists(lock):
                try:
                    os.unlink(lock)
                except Exception:
                    pass

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

        # 1. Clean up old locks & start dedicated vertical virtual display (Xvfb :99)
        self._cleanup_locks()
        self.log_cb(f"Starting vertical virtual display {VIRTUAL_DISPLAY} at {self.width}x{self.height}...")
        try:
            xvfb_cmd = ["Xvfb", VIRTUAL_DISPLAY, "-screen", "0", f"{self.width}x{self.height}x24", "-nocursor"]
            self.xvfb_proc = subprocess.Popen(xvfb_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            time.sleep(1.5)
        except Exception as e:
            self.log_cb(f"Failed to start Xvfb: {e}")
            return False, f"Failed to start virtual display: {e}"

        # 2. Launch Chrome Kiosk strictly on VIRTUAL_DISPLAY (:99)
        chrome_data_dir = "/tmp/tt-stream-overlay-chrome"
        try:
            shutil.rmtree(chrome_data_dir, ignore_errors=True)
        except Exception:
            pass

        chrome_cmd = [
            "google-chrome",
            "--kiosk",
            f"--window-size={self.width},{self.height}",
            "--window-position=0,0",
            f"--user-data-dir={chrome_data_dir}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-infobars",
            "--disable-background-networking",
            "--disable-sync",
            "--disable-features=Translate,OptimizationHints,MediaRouter",
            "--autoplay-policy=no-user-gesture-required",
            overlay_url
        ]

        self.log_cb(f"Rendering overlay ({overlay_url}) on {VIRTUAL_DISPLAY} in kiosk mode...")
        env = os.environ.copy()
        env["DISPLAY"] = VIRTUAL_DISPLAY
        env["PULSE_SERVER"] = "unix:/run/user/1000/pulse/native"
        try:
            self.chrome_proc = subprocess.Popen(chrome_cmd, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            time.sleep(3.5)  # Allow page to fully render
        except Exception as e:
            self.stop()
            self.log_cb(f"Failed to launch Chrome: {e}")
            return False, f"Failed to launch Chrome: {e}"

        # 3. GStreamer Pipeline capturing native 720x1280 / 1080x1920
        pipe_desc = (
            f'flvmux name=mux streamable=true ! rtmp2sink location="{rtmp_url}" '
            f'ximagesrc display-name={VIRTUAL_DISPLAY} use-damage=0 ! '
            f'videoconvert ! video/x-raw,format=I420,width={self.width},height={self.height},framerate={self.fps}/1 ! '
            f'queue max-size-buffers=3 ! x264enc bitrate={self.bitrate} speed-preset=veryfast bframes=0 key-int-max={2 * self.fps} ! '
            f'h264parse ! queue ! mux.video '
            f'pulsesrc device="Virtual_Sink.monitor" provide-clock=false buffer-time=200000 latency-time=10000 ! '
            f'audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=2 ! '
            f'audioconvert ! avenc_aac bitrate=160000 ! aacparse ! queue ! mux.audio'
        )

        self.log_cb(f"Starting RTMP broadcast: {self.width}x{self.height} @ {self.fps}fps ({self.bitrate} kbps)...")
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
            self.log_cb(f"Native Vertical Live Stream started! (Room ID: {self.current_room.get('room_id', 'N/A')})")
            return True, "Streaming started"
        except Exception as e:
            self.stop()
            self.error = str(e)
            self.log_cb(f"Pipeline error: {e}")
            return False, str(e)

    def _on_bus_message(self, bus, msg):
        if msg.type == Gst.MessageType.ERROR:
            err, debug = msg.parse_error()
            self.error = f"{msg.src.get_name()}: {err.message}"
            self.log_cb(f"Stream error: {err.message}")
            self.stop()
        elif msg.type == Gst.MessageType.EOS:
            self.log_cb("Stream reached EOS")
            self.stop()

    def stop(self):
        self.log_cb("Stopping live broadcast...")
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

        if self.xvfb_proc:
            try:
                self.xvfb_proc.terminate()
                self.xvfb_proc.wait(timeout=2)
            except Exception:
                try:
                    self.xvfb_proc.kill()
                except Exception:
                    pass
            self.xvfb_proc = None

        self._cleanup_locks()
        self.start_time = None
        self.log_cb("Live broadcast stopped cleanly.")
        return True
