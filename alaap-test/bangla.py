"""Loopback-only Bangla transcription worker. Audio stays in memory."""
from http.server import BaseHTTPRequestHandler, HTTPServer
from io import BytesIO
import json
from time import perf_counter
import unicodedata

from faster_whisper import WhisperModel
from indic_transliteration import sanscript

MODELS = {
    "standard": "SayedShaun/bengali-whisper-medium-ct2",
    "regional": "sha1779/Faster_BengaliRegionalASR",
}


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path not in ("/standard", "/regional"):
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        if not 0 < length <= 1_000_000:
            self.send_error(413)
            return
        data = self.rfile.read(length)
        started = perf_counter()
        try:
            segments, _ = models[self.path[1:]].transcribe(
                BytesIO(data), language="bn", beam_size=3,
                condition_on_previous_text=False, vad_filter=False,
                temperature=0.0, max_new_tokens=128,
            )
            transcript = "".join(segment.text for segment in segments).strip()
        except Exception:
            self.send_error(422, "Could not transcribe this audio")
            return
        cleaned = " ".join(unicodedata.normalize("NFC", transcript).split())
        cleaned = cleaned.replace("দাগ গুলো", "দাগগুলো").replace("পোকা গুলো", "পোকাগুলো")
        result = json.dumps({
            "text": transcript,
            "cleaned": cleaned,
            "latin": sanscript.transliterate(cleaned, sanscript.BENGALI, sanscript.IAST),
            "suspect": "\ufffd" in transcript or any(
                unicodedata.category(char).startswith("L")
                and not ("\u0980" <= char <= "\u09ff" or char.isascii())
                for char in transcript
            ),
            "inferenceMs": round((perf_counter() - started) * 1000),
        }, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(result)))
        self.end_headers()
        try:
            self.wfile.write(result)
        except ConnectionError:
            pass

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    models = {
        name: WhisperModel(model, device="cpu", compute_type="int8", cpu_threads=4)
        for name, model in MODELS.items()
    }
    print("Bangla transcription worker ready on 127.0.0.1:8767", flush=True)
    HTTPServer(("127.0.0.1", 8767), Handler).serve_forever()
