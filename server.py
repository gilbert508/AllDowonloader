"""
All Downloader - Universal Cloud & Local yt-dlp Backend Server
Bypasses Datacenter IP blocking via mobile player client spoofing.
"""

import os
import sys
import re
import time
import uuid
import glob
import logging
import threading
from flask import Flask, request, jsonify, send_file, send_from_directory, after_this_request
from flask_cors import CORS
import yt_dlp

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

IS_CLOUD = os.environ.get("RENDER") is not None or os.environ.get("IS_CLOUD") is not None
DOWNLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "downloads")
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

# -------------------------------------------------------------
# yt-dlp Options Configured for Datacenter / Cloud Workarounds
# -------------------------------------------------------------
BASE_YDL_OPTS = {
    "quiet": True,
    "no_warnings": True,
    "noplaylist": True,
    "nocheckcertificate": True,
    "source_address": "0.0.0.0",
    "extractor_args": {
        "youtube": {
            # Mobile clients bypass YouTube's datacenter bot challenge
            "player_client": ["android", "ios", "mweb"]
        }
    },
    "http_headers": {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
    }
}


@app.route("/", methods=["GET"])
def index():
    return send_from_directory(os.path.dirname(os.path.abspath(__file__)), "index.html")


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "online",
        "engine": "yt-dlp",
        "version": yt_dlp.version.__version__,
        "ready": True
    })


@app.route("/api/heartbeat", methods=["POST"])
def heartbeat():
    return jsonify({"status": "alive"})


@app.route("/api/info", methods=["POST"])
def get_info():
    data = request.get_json(force=True, silent=True) or {}
    url = data.get("url")
    if not url:
        return jsonify({"error": "No URL provided"}), 400

    ydl_opts = dict(BASE_YDL_OPTS)
    ydl_opts.update({
        "skip_download": True,
        "extract_flat": False,
    })

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            
            # If a playlist was returned accidentally, pick first item
            if "entries" in info and info["entries"]:
                info = info["entries"][0]

            return jsonify({
                "id": info.get("id"),
                "title": info.get("title", "Video Stream"),
                "uploader": info.get("uploader") or info.get("channel") or info.get("creator", "Creator"),
                "duration": info.get("duration", 0),
                "thumbnail": info.get("thumbnail"),
                "webpage_url": info.get("webpage_url", url),
            })
    except Exception as e:
        logger.error(f"Error extracting info for {url}: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/download", methods=["POST"])
def download_media():
    data = request.get_json(force=True, silent=True) or {}
    url = data.get("url")
    mode = data.get("mode", "video")
    target_quality = data.get("quality", "highest")

    if not url:
        return jsonify({"error": "Missing URL"}), 400

    job_id = str(uuid.uuid4())[:8]
    output_template = os.path.join(DOWNLOAD_DIR, f"{job_id}_%(title)s.%(ext)s")

    ydl_opts = dict(BASE_YDL_OPTS)
    ydl_opts.update({
        "outtmpl": output_template,
        "windowsfilenames": True,
    })

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
            if "entries" in info and info["entries"]:
                info = info["entries"][0]
            raw_title = info.get("title", "media")

        safe_title = re.sub(r'[\\/*?:"<>|]', "", raw_title).strip()
        ext = "mp3" if mode == "audio" else "mp4"
        download_name = f"{safe_title}.{ext}"

        pattern = os.path.join(DOWNLOAD_DIR, f"{job_id}_*")
        matching_files = glob.glob(pattern)

        if not matching_files:
            return jsonify({"error": "Media processed but file was not found on disk."}), 500

        file_path = matching_files[0]

        @after_this_request
        def cleanup_after_transfer(response):
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
        logger.error(f"Download execution failed: {e}")
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
