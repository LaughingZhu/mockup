#!/usr/bin/env python3
"""Local Depth Anything V2 Small + SAM ViT-B service for the demo."""

from __future__ import annotations

import base64
import io
import math
import threading
from typing import Any

import numpy as np
import torch
from flask import Flask, jsonify, request
from flask_cors import CORS
from PIL import Image
from transformers import (
    AutoImageProcessor,
    AutoModelForDepthEstimation,
    SamModel,
    SamProcessor,
)

DEPTH_MODEL_NAME = "depth-anything/Depth-Anything-V2-Small-hf"
SURFACE_MODEL_NAME = "facebook/sam-vit-base"
MODEL_LABEL = "Depth Anything V2 Small + SAM ViT-B"
MAX_OUTPUT_SIDE = 512
MAX_INPUT_BYTES = 12 * 1024 * 1024
MAX_INPUT_PIXELS = 25_000_000

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_INPUT_BYTES
CORS(app, resources={
    r"/health": {"origins": ["http://localhost:4173", "http://127.0.0.1:4173"]},
    r"/analyze": {"origins": ["http://localhost:4173", "http://127.0.0.1:4173"]},
})

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
depth_processor = None
depth_model = None
sam_processor = None
sam_model = None
model_lock = threading.Lock()


def load_models() -> None:
    global depth_processor, depth_model, sam_processor, sam_model
    if depth_model is not None and sam_model is not None:
        return
    with model_lock:
        if depth_model is None:
            depth_processor = AutoImageProcessor.from_pretrained(DEPTH_MODEL_NAME)
            depth_model = AutoModelForDepthEstimation.from_pretrained(DEPTH_MODEL_NAME).to(device).eval()
        if sam_model is None:
            sam_processor = SamProcessor.from_pretrained(SURFACE_MODEL_NAME)
            sam_model = SamModel.from_pretrained(SURFACE_MODEL_NAME).to(device).eval()


def decode_image(value: str) -> Image.Image:
    if not isinstance(value, str) or not value.startswith("data:image/"):
        raise ValueError("image must be a base64 image data URL")
    try:
        header, encoded = value.split(",", 1)
    except ValueError as error:
        raise ValueError("image data URL is malformed") from error
    if ";base64" not in header.lower():
        raise ValueError("image data URL must use base64 encoding")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, base64.binascii.Error) as error:
        raise ValueError("image data URL is not valid base64") from error
    if not raw or len(raw) > MAX_INPUT_BYTES:
        raise ValueError("image payload is too large")
    try:
        with Image.open(io.BytesIO(raw)) as decoded:
            if decoded.width * decoded.height > MAX_INPUT_PIXELS:
                raise ValueError("image dimensions are too large")
            decoded.load()
            return decoded.convert("RGB")
    except (OSError, Image.DecompressionBombError) as error:
        raise ValueError("image format is not supported") from error


def normalized_point(value: Any, label: str) -> dict[str, float]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must contain x and y")
    try:
        x = float(value["x"])
        y = float(value["y"])
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError(f"{label} must contain numeric x and y") from error
    if not math.isfinite(x) or not math.isfinite(y) or not 0 <= x <= 1 or not 0 <= y <= 1:
        raise ValueError(f"{label} must be normalized between 0 and 1")
    return {"x": x, "y": y}


def resize_output(array: np.ndarray, is_mask: bool = False) -> np.ndarray:
    image = Image.fromarray(array.astype(np.uint8), mode="L")
    width, height = image.size
    scale = min(1.0, MAX_OUTPUT_SIDE / max(width, height))
    if scale < 1:
        image = image.resize((max(1, round(width * scale)), max(1, round(height * scale))),
                             Image.Resampling.NEAREST if is_mask else Image.Resampling.BILINEAR)
    return np.asarray(image, dtype=np.uint8)


def estimate_depth(image: Image.Image) -> np.ndarray:
    load_models()
    inputs = depth_processor(images=image, return_tensors="pt")
    inputs = {key: value.to(device) if hasattr(value, "to") else value for key, value in inputs.items()}
    with torch.no_grad():
        output = depth_model(**inputs)
        prediction = torch.nn.functional.interpolate(
            output.predicted_depth.unsqueeze(1),
            size=image.size[::-1],
            mode="bicubic",
            align_corners=False,
        ).squeeze().cpu().numpy()
    prediction = (prediction - prediction.min()) / max(float(prediction.max() - prediction.min()), 1e-6)
    return resize_output(prediction * 255)


def segment_surface(image: Image.Image, point: dict[str, float], negative_points: list[dict[str, float]]) -> list[dict[str, Any]]:
    load_models()
    width, height = image.size
    coordinates = [[
        [point["x"] * width, point["y"] * height],
        *[[item["x"] * width, item["y"] * height] for item in negative_points[:8]],
    ]]
    labels = [[1, *([0] * min(8, len(negative_points)))]]
    encoded = sam_processor(
        image,
        input_points=coordinates,
        input_labels=labels,
        return_tensors="pt",
    )
    original_sizes = encoded["original_sizes"]
    reshaped_input_sizes = encoded["reshaped_input_sizes"]
    model_inputs = {key: value.to(device) if hasattr(value, "to") else value for key, value in encoded.items()}
    with torch.no_grad():
        output = sam_model(**model_inputs)
    masks = sam_processor.image_processor.post_process_masks(
        output.pred_masks.detach().cpu(),
        original_sizes.cpu(),
        reshaped_input_sizes.cpu(),
    )[0]
    scores = output.iou_scores.detach().cpu().reshape(-1).tolist()
    if masks.ndim == 4:
        masks = masks[:, 0]
    candidates = []
    for index, mask in enumerate(masks[:3]):
        binary = (mask.numpy() > 0).astype(np.uint8) * 255
        binary = resize_output(binary, is_mask=True)
        if not np.any(binary):
            continue
        candidates.append({
            "id": "sam-vit-b-candidate-" + str(index + 1),
            "score": float(max(0.0, min(1.0, scores[index] if index < len(scores) else 0.0))),
            "mask": {
                "width": int(binary.shape[1]),
                "height": int(binary.shape[0]),
                "values": binary.reshape(-1).tolist(),
            },
        })
    if not candidates:
        raise ValueError("SAM returned no non-empty surface candidate")
    return candidates


@app.get("/health")
def health():
    return jsonify({
        "status": "ok",
        "device": str(device),
        "depthModel": DEPTH_MODEL_NAME,
        "surfaceModel": SURFACE_MODEL_NAME,
        "loaded": depth_model is not None and sam_model is not None,
    })


@app.post("/analyze")
def analyze():
    try:
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify({"error": "request body must be a JSON object"}), 400
        image = decode_image(payload.get("image"))
        point = normalized_point(payload.get("point") or {"x": 0.5, "y": 0.5}, "point")
        raw_negative_points = payload.get("negativePoints") or []
        if not isinstance(raw_negative_points, list) or len(raw_negative_points) > 8:
            return jsonify({"error": "negativePoints must contain at most 8 points"}), 400
        negative_points = [normalized_point(item, "negative point") for item in raw_negative_points]
    except (TypeError, ValueError) as error:
        return jsonify({"error": str(error)}), 400

    try:
        depth = estimate_depth(image)
        candidates = segment_surface(image, point, negative_points)
        return jsonify({
            "version": 1,
            "model": MODEL_LABEL,
            "depth": {
                "width": int(depth.shape[1]),
                "height": int(depth.shape[0]),
                "values": (depth.reshape(-1) / 255.0).astype(float).tolist(),
            },
            "candidates": candidates,
        })
    except Exception:
        app.logger.exception("local model inference failed")
        return jsonify({"error": "local model inference failed"}), 500


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8080, threaded=False)
