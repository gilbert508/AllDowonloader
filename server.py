"""
All Downloader - Local yt-dlp Backend Server
Features:
- Auto browser launcher on start
- Auto-shutdown when browser tab is closed (and no downloads are active)
- Video & Audio single/batch downloading with native file naming
"""

import os
import sys
import re
import time
import uuid
import glob
import logging
import threading
import webbrowser
from flask import Flask, request, jsonify, send_file, send_from_directory, after_this_request
from flask_cors import CORS
import yt_dlp

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

DOWNLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "downloads")
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

# -------------------------------------------------------------
# Auto-Shutdown & Heartbeat State Tracker
# -------------------------------------------------------------
HEARTBEAT_TIMEOUT = 10  # Seconds to wait after browser is closed before terminating
last_heartbeat_time = time.time()
active_downloads_count = 0
active_downloads_lock = threading.Lock()
first_connection_established = False

def auto_shutdown_monitor():
    """Monitors if the browser tab was closed. Shuts down cleanly if idle."""
    global last_heartbeat_time, first_connection_established
    while True:
        time.sleep(2)
        if not first_connection_established:
            continue
            
        with active_downloads_lock:
            busy = (active_downloads_count > 0)

        elapsed = time.time() - last_heartbeat_time
        if elapsed > HEARTBEAT_TIMEOUT and not busy:
            logger.info("Browser session closed and no downloads active. Shutting down server...")
            os._exit(0)

# Start heartbeat monitor in a background daemon thread
threading.Thread(target=auto_shutdown_monitor, daemon=True).start()


@app.route("/api/heartbeat", methods=["POST"])
def heartbeat():
    global last_heartbeat_time, first_connection_established
    last_heartbeat_time = time.time()
    first_connection_established = True
    return jsonify({"status": "alive"})


@app.route("/", methods=["GET"])
def index():
    current_folder = os.path.dirname(os.path.abspath(__file__))
    return send_from_directory(current_folder, "index.html")


@app.route("/health", methods=["GET"])
def health():
    global last_heartbeat_time, first_connection_established
    last_heartbeat_time = time.time()
    first_connection_established = True
    return jsonify({
        "status": "online",
        "engine": "yt-dlp",
        "version": yt_dlp.version.__version__,
        "ready": True
    })


@app.route("/api/info", methods=["POST"])
def get_info():
    global last_heartbeat_time
    last_heartbeat_time = time.time()
    
    data = request.get_json(force=True, silent=True) or {}
    url = data.get("url")
    if not url:
        return jsonify({"error": "No URL provided"}), 400

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "extract_flat": False,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            
            formats = []
            if "formats" in info:
                for f in info["formats"]:
                    formats.append({
                        "format_id": f.get("format_id"),
                        "ext": f.get("ext"),
                        "resolution": f.get("resolution") or f"{f.get('width','?')}x{f.get('height','?')}",
                        "height": f.get("height"),
                        "fps": f.get("fps"),
                        "filesize": f.get("filesize") or f.get("filesize_approx"),
                        "vcodec": f.get("vcodec"),
                        "acodec": f.get("acodec"),
                    })

            return jsonify({
                "id": info.get("id"),
                "title": info.get("title", "Unknown Title"),
                "uploader": info.get("uploader") or info.get("channel", "Unknown Creator"),
                "duration": info.get("duration", 0),
                "thumbnail": info.get("thumbnail"),
                "formats_count": len(formats),
                "webpage_url": info.get("webpage_url", url),
            })
    except Exception as e:
        logger.error(f"Error extracting info for {url}: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/download", methods=["POST"])
def download_media():
    global active_downloads_count, last_heartbeat_time
    last_heartbeat_time = time.time()

    data = request.get_json(force=True, silent=True) or {}
    url = data.get("url")
    mode = data.get("mode", "video")
    target_quality = data.get("quality", "highest")

    if not url:
        return jsonify({"error": "Missing URL"}), 400

    with active_downloads_lock:
        active_downloads_count += 1

    job_id = str(uuid.uuid4())[:8]
    output_template = os.path.join(DOWNLOAD_DIR, f"{job_id}_%(title)s.%(ext)s")

    ydl_opts = {
        "outtmpl": output_template,
        "quiet": False,
        "no_warnings": True,
        "windowsfilenames": True,
    }

    if mode == "audio":
        preferred_quality = "320"
        if "128" in target_quality:
            preferred_quality = "128"
        elif "256" in target_quality:
            preferred_quality = "256"

        ydl_opts.update({
            "format": "bestaudio/best",
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": preferred_quality,
            }],
        })
    else:
        if target_quality in ["2160", "1440", "1080", "720", "480"]:
            ydl_opts["format"] = f"bestvideo[height<={target_quality}]+bestaudio/best[height<={target_quality}]/best"
        else:
            ydl_opts["format"] = "bestvideo+bestaudio/best"
        ydl_opts["merge_output_format"] = "mp4"

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            raw_title = info.get("title", "media")

        safe_title = re.sub(r'[\\/*?:"<>|]', "", raw_title).strip()
        ext = "mp3" if mode == "audio" else "mp4"
        download_name = f"{safe_title}.{ext}"

        pattern = os.path.join(DOWNLOAD_DIR, f"{job_id}_*")
        matching_files = glob.glob(pattern)

        if not matching_files:
            return jsonify({"error": "File was processed but could not be located."}), 500

        file_path = matching_files[0]

        @after_this_request
        def cleanup_after_transfer(response):
            global active_downloads_count, last_heartbeat_time
            last_heartbeat_time = time.time()
            with active_downloads_lock:
                if active_downloads_count > 0:
                    active_downloads_count -= 1
            try:
                if os.path.exists(file_path):
                    os.remove(file_path)
            except Exception:
                pass
            return response

        response = send_file(
            file_path,
            as_attachment=True,
            download_name=download_name,
            mimetype="audio/mpeg" if mode == "audio" else "video/mp4"
        )
        response.headers["Access-Control-Expose-Headers"] = "Content-Disposition"
        return response

    except Exception as e:
        with active_downloads_lock:
            if active_downloads_count > 0:
                active_downloads_count -= 1
        logger.error(f"Download execution failed: {e}")
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    # Open browser automatically on launch
    threading.Timer(1.2, lambda: webbrowser.open(f"http://127.0.0.1:{port}")).start()
    print("=" * 60)
    print(f" All Downloader running on http://127.0.0.1:{port}")
    print(" Auto-shutdown active: Closes automatically when tabs close.")
    print("=" * 60)
    app.run(host="127.0.0.1", port=port, debug=False)