import json
import re
from http.server import BaseHTTPRequestHandler
from urllib.parse import quote, urlparse

import yt_dlp

YOUTUBE_PATTERN = re.compile(
    r"(?:shorts/|watch\?v=|[?&]v=|youtu\.be/|embed/|v/)([a-zA-Z0-9_-]{11})"
)


def json_response(handler, status, body):
    payload = json.dumps(body).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(payload)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()
    handler.wfile.write(payload)


def safe_filename(title, extension):
    cleaned = re.sub(r'[\\/*?:"<>|]', "", str(title or "download")).strip()[:80]
    return f"{cleaned or 'download'}.{extension}"


def extract_media(source_url, audio):
    options = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "skip_download": True,
        "format": "bestaudio[ext=m4a]/bestaudio" if audio else "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best",
    }
    with yt_dlp.YoutubeDL(options) as downloader:
        info = downloader.extract_info(source_url, download=False)

    stream_url = info.get("url")
    if not stream_url:
        raise RuntimeError("YouTube returned separate video and audio streams; configure COBALT_API_URL to merge them.")

    extension = info.get("ext") or ("m4a" if audio else "mp4")
    filename = safe_filename(info.get("title"), extension)
    return {
        "title": info.get("title") or "YouTube download",
        "thumb": info.get("thumbnail") or "",
        "filename": filename,
        "downloadUrl": f"/api/download?url={quote(stream_url, safe='')}&filename={quote(filename, safe='')}",
    }


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length) or b"{}")
            source_url = str(body.get("url", "")).strip()
            if not source_url or not urlparse(source_url).scheme.startswith("http"):
                return json_response(self, 400, {"error": "Enter a valid YouTube URL."})
            if not YOUTUBE_PATTERN.search(source_url):
                return json_response(self, 400, {"error": "The URL is not a recognized YouTube link."})

            result = extract_media(source_url, bool(body.get("audio")))
            return json_response(self, 200, result)
        except Exception as error:
            return json_response(self, 502, {"error": str(error) or "yt-dlp extraction failed."})
