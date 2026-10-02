"""
Serve the V1 web interface (web/) and its JSON API using only the standard library.

Run:  python3 scripts/serve_web.py [--port 8765]
Then open http://localhost:8765/

Routes
  GET  /api/corridor            corridor index of the 104 boulevard sites
  GET  /api/site/<site_id>      one SITE record, sidecar, neighbours, vocabularies
  GET  /api/context/<site_id>   factual plan context: streets, trees, contours, cut profile, ROW width
  GET  /api/rules               sources/06_rules.json as served (read-only, for the Source Logic tab)
  GET  /api/block_face/<site_id> the engine's data/processed/block_face_<site>.json as written (read-only)
  POST /api/block_face/evaluate  {site_id, curb, depth, target, soil, land_use, width_level, existing:{…}} -> runs
                                 scripts/run_block_face.py (writes the engine file) and the exporter; returns both
  GET  /api/model/<site_id>      READOUT lines, missing list and layout report from data/processed/rhino_model_<site>.json
  GET  /api/section.svg?site=…&w=<px>  SECTION A–A rendered by export_rhino_model.section_svg from the model JSON
  GET  /api/anchors              source_anchors.md parsed (why panel)
  GET  /api/rhino_captures?site=&tag=   latest three Rhino captures for the curb tag; PNGs at /captures/<name>
  POST /api/evaluate            {site_id, inputs, scenarios} -> base + scenario results
  GET  /...                     static files from web/
"""
import argparse
import json
import pathlib
import sys
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src import web_api  # noqa: E402
from src import scene_api  # noqa: E402

WEB_DIR = ROOT / "web"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def log_message(self, fmt, *args):  # quieter log
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

    def _json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path
        qs = parse_qs(urlparse(self.path).query)
        if path == "/":
            # the root is the six-stage demo; the round-12 one-screen page stays at /index.html
            q = urlparse(self.path).query
            self.send_response(HTTPStatus.FOUND); self.send_header("Location", "/one.html" + ("?" + q if q else "")); self.end_headers()
            return None
        if path.startswith("/data/"):
            name = unquote(path[len("/data/"):])
            body = None
            if name in ("parks-polygon-representation.geojson", "public-streets.geojson", "local-area-boundary.geojson") and (ROOT / "data" / "raw" / name).exists():
                body = (ROOT / "data" / "raw" / name).read_bytes()
            elif name in ("local_area_species.json", "local_area_capacity.json", "citywide_faces.json", "region_base.json", "city_blocks.json", "region_blocks.json") and (ROOT / "data" / "processed" / name).exists():
                body = (ROOT / "data" / "processed" / name).read_bytes()
            if body is not None:
                self.send_response(HTTPStatus.OK); self.send_header("Content-Type", "application/geo+json"); self.send_header("Content-Length", str(len(body))); self.send_header("Cache-Control", "max-age=3600"); self.end_headers(); self.wfile.write(body)
                return
            return self._json(HTTPStatus.NOT_FOUND, {"error": "not served"})
        if path == "/api/trees_all":
            return self._json(HTTPStatus.OK, scene_api.trees_all())
        if path == "/api/address_index":
            return self._json(HTTPStatus.OK, scene_api.address_index())
        if path == "/api/trees_near":
            try:
                return self._json(HTTPStatus.OK, scene_api.trees_near_point(float(qs.get("lon", [""])[0]), float(qs.get("lat", [""])[0]), float(qs.get("r", ["40"])[0])))
            except (ValueError, web_api.ApiError) as e:
                return self._json(HTTPStatus.BAD_REQUEST, {"error": str(e)})
        if path == "/api/scenario/list":
            qs = parse_qs(urlparse(self.path).query)
            try:
                return self._json(HTTPStatus.OK, scene_api.list_frozen(qs.get("site", [""])[0]))
            except web_api.ApiError as exc:
                return self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        if path.startswith("/api/scene/"):
            site = unquote(path[len("/api/scene/"):])
            try:
                return self._json(HTTPStatus.OK, scene_api.scene_result(site))
            except web_api.ApiError as exc:
                return self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
        if path == "/api/tree":
            try:
                return self._json(HTTPStatus.OK, scene_api.tree_lookup(int(qs.get("asset_id", [""])[0])))
            except (ValueError, Exception) as exc:
                return self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
        if path == "/api/corridor":
            return self._json(HTTPStatus.OK, web_api.corridor_summary())
        if path.startswith("/api/site/"):
            site_id = unquote(path[len("/api/site/"):])
            try:
                return self._json(HTTPStatus.OK, web_api.site_detail(site_id))
            except web_api.ApiError as exc:
                return self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
        if path.startswith("/api/context/"):
            site_id = unquote(path[len("/api/context/"):])
            try:
                return self._json(HTTPStatus.OK, web_api.site_context(site_id))
            except web_api.ApiError as exc:
                return self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
        if path == "/api/rules":
            return self._json(HTTPStatus.OK, web_api.rules_doc())
        if path.startswith("/api/block_face/"):
            site_id = unquote(path[len("/api/block_face/"):])
            try:
                return self._json(HTTPStatus.OK, web_api.block_face_result(site_id))
            except web_api.ApiError as exc:
                return self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
        if path.startswith("/api/model/"):
            site_id = unquote(path[len("/api/model/"):])
            try:
                return self._json(HTTPStatus.OK, web_api.model_summary(site_id))
            except web_api.ApiError as exc:
                return self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
        if path == "/api/anchors":
            try:
                return self._json(HTTPStatus.OK, web_api.source_anchors())
            except web_api.ApiError as exc:
                return self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
        if path == "/api/rhino_captures":
            q = parse_qs(urlparse(self.path).query)
            try:
                return self._json(HTTPStatus.OK, web_api.rhino_captures(q.get("site", ["KE-198571"])[0], q.get("tag", [None])[0]))
            except web_api.ApiError as exc:
                return self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
        if path.startswith("/captures/"):
            try:
                fp = web_api.capture_path(unquote(path[len("/captures/"):]))
            except web_api.ApiError as exc:
                return self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
            if not fp.exists():
                return self._json(HTTPStatus.NOT_FOUND, {"error": "no such capture"})
            data = fp.read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return None
        if path == "/api/section.svg":
            q = parse_qs(urlparse(self.path).query)
            site_id = q.get("site", ["KE-198571"])[0]
            try:
                frame = float(q.get("w", [0])[0] or 0) or None
            except ValueError:
                frame = None
            try:
                body = web_api.section_svg(site_id, frame).encode("utf-8")
            except web_api.ApiError as exc:
                return self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
            except Exception as exc:  # renderer fault: tell the page instead of dropping the connection
                return self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"section renderer: {type(exc).__name__}: {exc}"})
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "image/svg+xml; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return None
        if path.startswith("/api/"):
            return self._json(HTTPStatus.NOT_FOUND, {"error": "unknown api route"})
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/capture":
            length = int(self.headers.get("Content-Length") or 0)
            try:
                payload = json.loads(self.rfile.read(length) or b"{}")
                name = "".join(c for c in str(payload.get("name", "")) if c.isalnum() or c in "-_.")[:80] or "capture"
                data = payload.get("data_url", "")
                if not data.startswith("data:image/png;base64,"):
                    raise ValueError("data_url must be a PNG data URL")
                import base64
                out = ROOT / "reports" / "screens" / f"{name}.png"
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_bytes(base64.b64decode(data.split(",", 1)[1]))
                return self._json(HTTPStatus.OK, {"saved": str(out.relative_to(ROOT))})
            except (ValueError, TypeError) as exc:
                return self._json(HTTPStatus.BAD_REQUEST, {"error": f"bad capture: {exc}"})
        if path not in ("/api/evaluate", "/api/block_face/evaluate", "/api/scene/evaluate", "/api/site/run", "/api/scenario/freeze"):
            return self._json(HTTPStatus.NOT_FOUND, {"error": "unknown api route"})
        length = int(self.headers.get("Content-Length") or 0)
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
            if path == "/api/scenario/freeze":
                result = scene_api.freeze_scene(payload.get("site_id"), payload.get("scene"), payload.get("subject"), payload.get("cut_aa_u"))
            elif path == "/api/scene/evaluate":
                result = scene_api.evaluate_scene(payload.get("site_id"), payload)
            elif path == "/api/site/run":
                result = scene_api.run_site(payload)
            elif path == "/api/block_face/evaluate":
                result = web_api.evaluate_block_face(payload.get("site_id"), payload)
            else:
                result = web_api.evaluate(payload.get("site_id"), payload.get("inputs") or {}, payload.get("scenarios") or [])
        except web_api.ApiError as exc:
            return self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except (ValueError, TypeError) as exc:
            return self._json(HTTPStatus.BAD_REQUEST, {"error": f"bad request: {exc}"})
        return self._json(HTTPStatus.OK, result)

    def end_headers(self):
        # Static files: never cache during prototype testing.
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Street-Tree Site Capacity Tool V1 interface: http://{args.host}:{args.port}/")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
