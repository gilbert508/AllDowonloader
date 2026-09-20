import json
import re
from http.server import BaseHTTPRequestHandler
from urllib.parse import quote, urlparse

import yt_dlp

YOUTUBE_ID = re.compile(r"(?:shorts/|watch\?v=|[?&]v=|youtu\.be/|embed/|v/)([A-Za-z0-9_-]{11})")


def respond(handler, status, body):
    payload = json.dumps(body).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)


def safe_name(title, extension):
    cleaned = re.sub(r'[\\/*?:"<>|]', "", title or "download").strip()[:80]
    return f"{cleaned or 'download'}.{extension}"


def proxied(url):
    return f"/api/stream?url={quote(url, safe='')}"


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
            if not urlparse(source_url).scheme.startswith("http") or not YOUTUBE_ID.search(source_url):
                return respond(self, 400, {"error": "Enter a valid YouTube URL."})

            audio_only = bool(body.get("audio"))
            options = {
                "quiet": True,
                "no_warnings": True,
                "noplaylist": True,
                "skip_download": True,
                "format": "bestaudio[ext=m4a]/bestaudio" if audio_only else "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best",
            }
            with yt_dlp.YoutubeDL(options) as downloader:
                info = downloader.extract_info(source_url, download=False)

            requested = info.get("requested_formats") or []
            video = next((item for item in requested if item.get("vcodec") != "none"), None)
            audio = next((item for item in requested if item.get("acodec") != "none"), None)
            direct = info.get("url")
            video_url = (video or {}).get("url") or (info if info.get("vcodec") != "none" else {}).get("url")
            audio_url = (audio or {}).get("url") or (info if info.get("acodec") != "none" else {}).get("url")

            if audio_only:
                if not audio_url:
                    return respond(self, 502, {"error": "yt-dlp returned no audio stream."})
                filename = safe_name(info.get("title"), "m4a" if (audio or info).get("ext") == "m4a" else "webm")
                return respond(self, 200, {
                    "title": info.get("title") or "YouTube audio",
                    "thumb": info.get("thumbnail") or "",
                    "videoUrl": None,
                    "audioUrl": proxied(audio_url),
                    "isCombined": True,
                    "filename": filename,
                })

            if not video_url:
                return respond(self, 502, {"error": "yt-dlp returned no video stream."})
            combined = bool(direct and not audio_url)
            filename = safe_name(info.get("title"), "mp4")
            return respond(self, 200, {
                "title": info.get("title") or "YouTube video",
                "thumb": info.get("thumbnail") or "",
                "videoUrl": proxied(video_url),
                "audioUrl": proxied(audio_url) if audio_url else None,
                "isCombined": combined,
                "filename": filename,
            })
        except Exception as error:
            return respond(self, 502, {"error": str(error) or "YouTube extraction failed."})
