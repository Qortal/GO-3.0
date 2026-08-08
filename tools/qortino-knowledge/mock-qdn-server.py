#!/usr/bin/env python3
"""Local QDN stand-in for Qortino Assemble QA (adb reverse tcp:18765 tcp:18765)."""
from __future__ import annotations

import mimetypes
import os
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.environ.get(
    "QORTINO_PUBLISH_DIR",
    os.path.expanduser("~/Desktop/Qortino-QShare-publish"),
)
PORT = int(os.environ.get("QORTINO_MOCK_PORT", "18765"))

ROUTES = {
    "/arbitrary/FILE/Qortino%20AI/qortino_pack_standard": "Qortino-Standard.zip",
    "/arbitrary/FILE/Qortino AI/qortino_pack_standard": "Qortino-Standard.zip",
    "/arbitrary/FILE/Qortino%20AI/qortino_pack_lite": "Qortino-Lite.zip",
    "/arbitrary/FILE/Qortino AI/qortino_pack_lite": "Qortino-Lite.zip",
    "/arbitrary/DOCUMENT/Qortino%20AI/qortino_agent_manifest": "qortino_agent_manifest.json",
    "/arbitrary/DOCUMENT/Qortino AI/qortino_agent_manifest": "qortino_agent_manifest.json",
}


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Expose-Headers", "Content-Length, Content-Type")

    def _resolve(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        candidates = [path, urllib.parse.unquote(path)]
        for key in candidates:
            filename = ROUTES.get(key)
            if filename:
                full = os.path.join(ROOT, filename)
                if os.path.isfile(full):
                    return full
                return None
        return False

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_HEAD(self):  # noqa: N802
        full = self._resolve()
        if full is False:
            self.send_error(404, f"No mock resource for {self.path}")
            return
        if full is None:
            self.send_error(404, "Missing file")
            return
        size = os.path.getsize(full)
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(size))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()

    def do_GET(self):  # noqa: N802
        full = self._resolve()
        if full is False:
            self.send_error(404, f"No mock resource for {self.path}")
            return
        if full is None:
            self.send_error(404, "Missing file")
            return
        size = os.path.getsize(full)
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(size))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        with open(full, "rb") as fh:
            while True:
                chunk = fh.read(1024 * 1024)
                if not chunk:
                    break
                self.wfile.write(chunk)

    def log_message(self, fmt, *args):
        print(f"[qortino-mock] {self.address_string()} {fmt % args}")


def main():
    print(f"Serving Qortino QDN mock from {ROOT} on 0.0.0.0:{PORT}")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
