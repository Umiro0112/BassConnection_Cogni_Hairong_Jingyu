from __future__ import annotations

import json
import os
import socket
import threading
import time
import uuid
from pathlib import Path

import cv2
import numpy as np
import qrcode
from flask import Flask, jsonify, redirect, render_template, request, send_from_directory, url_for
from werkzeug.utils import secure_filename
from werkzeug.middleware.proxy_fix import ProxyFix

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
UPLOADS = DATA / "uploads"
DB = DATA / "postcards.json"
PUBLIC_URL = DATA / "public_url.txt"
MAX_VISIBLE = 20
ALLOWED = {"jpg", "jpeg", "png", "webp", "heic", "heif"}

DATA.mkdir(exist_ok=True)
UPLOADS.mkdir(exist_ok=True)
if not DB.exists():
    DB.write_text("[]\n", encoding="utf-8")

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024
db_lock = threading.Lock()


def read_cards() -> list[dict]:
    with db_lock:
        try:
            return json.loads(DB.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return []


def write_cards(cards: list[dict]) -> None:
    with db_lock:
        temp = DB.with_suffix(".tmp")
        temp.write_text(json.dumps(cards, indent=2), encoding="utf-8")
        temp.replace(DB)


def order_points(points: np.ndarray) -> np.ndarray:
    ordered = np.zeros((4, 2), dtype=np.float32)
    sums = points.sum(axis=1)
    diffs = np.diff(points, axis=1).ravel()
    ordered[0] = points[np.argmin(sums)]
    ordered[2] = points[np.argmax(sums)]
    ordered[1] = points[np.argmin(diffs)]
    ordered[3] = points[np.argmax(diffs)]
    return ordered


def extract_postcard(source: Path, destination: Path) -> tuple[bool, str]:
    raw = np.fromfile(str(source), dtype=np.uint8)
    image = cv2.imdecode(raw, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("This image format could not be read. Please use JPG, PNG, or WebP.")

    height, width = image.shape[:2]
    scale = min(1.0, 1400 / max(height, width))
    small = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(gray, 45, 140)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8), iterations=2)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

    candidate = None
    image_area = small.shape[0] * small.shape[1]
    for contour in sorted(contours, key=cv2.contourArea, reverse=True):
        area = cv2.contourArea(contour)
        if area < image_area * 0.12 or area > image_area * 0.98:
            continue
        perimeter = cv2.arcLength(contour, True)
        polygon = cv2.approxPolyDP(contour, 0.025 * perimeter, True)
        if len(polygon) != 4 or not cv2.isContourConvex(polygon):
            continue
        candidate = polygon.reshape(4, 2).astype(np.float32) / scale
        break

    detected = candidate is not None
    if detected:
        rect = order_points(candidate)
        tl, tr, br, bl = rect
        target_w = int(max(np.linalg.norm(br - bl), np.linalg.norm(tr - tl)))
        target_h = int(max(np.linalg.norm(tr - br), np.linalg.norm(tl - bl)))
        target_w = max(320, min(target_w, 1800))
        target_h = max(220, min(target_h, 1400))
        target = np.array([[0, 0], [target_w - 1, 0], [target_w - 1, target_h - 1], [0, target_h - 1]], dtype=np.float32)
        matrix = cv2.getPerspectiveTransform(rect, target)
        output = cv2.warpPerspective(image, matrix, (target_w, target_h))
        detail = "Postcard detected and straightened."
    else:
        output = image
        detail = "Rectangle was not detected, so the full photo was used."

    if output.shape[1] > 1600:
        ratio = 1600 / output.shape[1]
        output = cv2.resize(output, None, fx=ratio, fy=ratio, interpolation=cv2.INTER_AREA)
    ok, encoded = cv2.imencode(".jpg", output, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not ok:
        raise ValueError("The processed image could not be saved.")
    encoded.tofile(str(destination))
    return detected, detail


@app.get("/")
def index():
    return render_template("kiosk.html")


@app.get("/upload")
def upload_page():
    return render_template("upload.html")


@app.post("/upload")
def upload_without_javascript():
    response = upload_card()
    status = 200
    if isinstance(response, tuple):
        response, status = response
    payload = response.get_json() or {}
    message = payload.get("detail") if payload.get("ok") else payload.get("error", "Upload failed.")
    return render_template("upload_result.html", ok=bool(payload.get("ok")), message=message), status


@app.post("/api/upload")
def upload_card():
    photo = request.files.get("photo")
    if not photo or not photo.filename:
        return jsonify(error="Choose or take a photo first."), 400
    extension = secure_filename(photo.filename).rsplit(".", 1)[-1].lower() if "." in photo.filename else "jpg"
    if extension not in ALLOWED:
        return jsonify(error="Please upload a JPG, PNG, WebP, or HEIC photo."), 400

    card_id = uuid.uuid4().hex[:12]
    original = UPLOADS / f"{card_id}-original.{extension}"
    processed = UPLOADS / f"{card_id}.jpg"
    photo.save(original)
    try:
        detected, detail = extract_postcard(original, processed)
    except ValueError as exc:
        original.unlink(missing_ok=True)
        return jsonify(error=str(exc)), 400
    finally:
        original.unlink(missing_ok=True)

    cards = read_cards()
    visible = [card for card in cards if not card.get("archived")]
    if len(visible) >= MAX_VISIBLE:
        oldest = min(visible, key=lambda card: card["created_at"])
        oldest["archived"] = True
        oldest["archived_at"] = time.time()

    occupied = {card.get("anchor") for card in cards if not card.get("archived")}
    available = [index for index in range(MAX_VISIBLE) if index not in occupied]
    anchor = available[0] if available else int(time.time()) % MAX_VISIBLE
    card = {
        "id": card_id,
        "created_at": time.time(),
        "archived": False,
        "anchor": anchor,
        "url": f"/uploads/{card_id}.jpg",
    }
    cards.append(card)
    write_cards(cards)
    return jsonify(ok=True, detected=detected, detail=detail, card=card)


@app.get("/api/postcards")
def postcards():
    cards = sorted(read_cards(), key=lambda card: card["created_at"])
    return jsonify(
        version=max([card["created_at"] for card in cards], default=0),
        visible=[card for card in cards if not card.get("archived")],
        archived=[card for card in cards if card.get("archived")],
    )


@app.get("/uploads/<path:filename>")
def uploaded_file(filename: str):
    return send_from_directory(UPLOADS, filename)


@app.get("/qr.png")
def qr_code():
    public_base = PUBLIC_URL.read_text(encoding="utf-8").strip().rstrip("/") if PUBLIC_URL.exists() else ""
    if public_base.startswith("https://"):
        upload_url = public_base + url_for("upload_page")
    elif request.is_secure:
        upload_url = request.url_root.rstrip("/") + url_for("upload_page")
    else:
        host = request.host.split(":", 1)[0]
        port = request.host.rsplit(":", 1)[1] if ":" in request.host else "8000"
        if host in {"localhost", "127.0.0.1"}:
            try:
                probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                probe.connect(("8.8.8.8", 80))
                host = probe.getsockname()[0]
                probe.close()
            except OSError:
                pass
        upload_url = f"http://{host}:{port}{url_for('upload_page')}"
    qr = qrcode.make(upload_url)
    from io import BytesIO

    buffer = BytesIO()
    qr.save(buffer, format="PNG")
    response = app.response_class(buffer.getvalue(), mimetype="image/png")
    response.headers["Cache-Control"] = "no-store, max-age=0"
    return response


@app.get("/api/access")
def access_info():
    public_base = PUBLIC_URL.read_text(encoding="utf-8").strip().rstrip("/") if PUBLIC_URL.exists() else ""
    return jsonify(public_url=public_base or None)


@app.get("/health")
def health():
    return jsonify(ok=True)


@app.errorhandler(413)
def too_large(_error):
    return jsonify(error="Photo is larger than 16 MB."), 413


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    app.run(host="0.0.0.0", port=port, debug=False)
