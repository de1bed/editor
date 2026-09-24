"""Open-vocabulary detection ("el logo de la gorra") + temporal tracking.

- Detector: Grounding DINO tiny (Apache-2.0) through Hugging Face transformers.
  Faces use YuNet instead (faster and more accurate for that class).
- Tracker: SAM 2 video predictor (Apache-2.0) when available, seeded with the
  best detection of each object; otherwise IoU linking of per-frame detections.
Ultralytics YOLO is intentionally not used (AGPL-3.0).
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

import numpy as np

from .frames import sample_frames
from .tracking import Box, Track, clamp_box, link, rdp_keyframes, smooth

GDINO_MODEL = os.environ.get("GDINO_MODEL", "IDEA-Research/grounding-dino-tiny")
SAM2_MODEL = os.environ.get("SAM2_MODEL", "facebook/sam2.1-hiera-small")

KIND_PROMPTS = {
    "plate": "license plate.",
    "screen": "screen. monitor. phone screen. laptop screen.",
    "logo": "logo. brand logo.",
}


def build_prompt(query: str, kind: str) -> str:
    q = query.strip().lower().rstrip(".")
    base = KIND_PROMPTS.get(kind, "")
    return f"{q}. {base}".strip() if q else base


class GroundingDino:
    def __init__(self):
        import torch
        from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor

        self.torch = torch
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.processor = AutoProcessor.from_pretrained(GDINO_MODEL)
        self.model = AutoModelForZeroShotObjectDetection.from_pretrained(GDINO_MODEL).to(self.device).eval()

    def detect(self, img_bgr: np.ndarray, prompt: str, threshold: float) -> list[Box]:
        from PIL import Image

        h, w = img_bgr.shape[:2]
        image = Image.fromarray(img_bgr[:, :, ::-1])
        inputs = self.processor(images=image, text=prompt, return_tensors="pt").to(self.device)
        with self.torch.no_grad():
            outputs = self.model(**inputs)
        kwargs = dict(text_threshold=0.25, target_sizes=[(h, w)])
        try:
            res = self.processor.post_process_grounded_object_detection(
                outputs, inputs.input_ids, threshold=threshold, **kwargs
            )[0]
        except TypeError:  # older transformers
            res = self.processor.post_process_grounded_object_detection(
                outputs, inputs.input_ids, box_threshold=threshold, **kwargs
            )[0]
        boxes = []
        for (x1, y1, x2, y2), score in zip(res["boxes"].tolist(), res["scores"].tolist(), strict=False):
            boxes.append(clamp_box(Box(x=x1 / w, y=y1 / h, w=(x2 - x1) / w, h=(y2 - y1) / h, score=float(score))))
        return boxes


def detect_objects(req: dict, video: str, on_progress=None) -> list[dict]:
    kind = req["kind"]
    start, end, fps = req["startMs"], req["endMs"], req["sampleFps"]
    frames = list(sample_frames(video, start, end, fps))
    if not frames:
        return []
    if kind == "face":
        from .faces import FaceDetector

        fd = FaceDetector(score_threshold=max(0.5, req["boxThreshold"]))
        detector = lambda img: [clamp_box(b, 0.15) for b in fd.detect(img)]  # noqa: E731
        model = "yunet-2023mar"
    else:
        gd = GroundingDino()
        prompt = build_prompt(req["query"], kind)
        detector = lambda img: gd.detect(img, prompt, req["boxThreshold"])  # noqa: E731
        model = GDINO_MODEL

    detections: list[tuple[int, list[Box]]] = []
    for i, f in enumerate(frames):
        detections.append((f.t_ms, detector(f.image)))
        if on_progress:
            on_progress(0.6 * (i + 1) / len(frames))

    tracks = link(detections, iou_threshold=0.2, max_gap_ms=int(3000 / max(fps, 0.1)))
    tracks = [t for t in tracks if len(t.points) >= 2 or len(frames) <= 2]

    if req.get("tracker") == "sam2" and tracks:
        try:
            tracks = refine_with_sam2(frames, tracks, fps, on_progress)
            model += "+sam2"
        except Exception as e:  # noqa: BLE001 — SAM 2 is an optional refinement
            print(f"sam2 refinement skipped: {e}")

    step = round(1000 / fps)
    out = []
    for tr in tracks:
        pts = rdp_keyframes(smooth(tr.points, 0.7), 0.003)
        pad = 0.08  # blur a little beyond the detected object
        kfs = [{"tMs": t, **_box(clamp_box(b, pad)), "score": round(b.score, 4)} for t, b in pts]
        out.append(
            {
                "id": f"det_{tr.id}",
                "assetId": req["assetId"],
                "query": req["query"],
                "kind": kind,
                "model": model,
                "startMs": tr.points[0][0],
                "endMs": min(end, tr.points[-1][0] + step),
                "score": round(float(np.mean([b.score for _, b in tr.points])), 4),
                "keyframes": kfs,
            }
        )
    out.sort(key=lambda d: -d["score"])
    return out


def refine_with_sam2(frames, tracks: list[Track], fps: float, on_progress=None) -> list[Track]:
    """Seeds SAM 2 with each track's highest-scoring box and propagates through all sampled frames."""
    import cv2
    import torch
    from sam2.sam2_video_predictor import SAM2VideoPredictor

    predictor = SAM2VideoPredictor.from_pretrained(SAM2_MODEL)
    h, w = frames[0].image.shape[:2]
    with tempfile.TemporaryDirectory() as d:
        for i, f in enumerate(frames):
            cv2.imwrite(str(Path(d) / f"{i:05d}.jpg"), f.image)
        t_index = {f.t_ms: i for i, f in enumerate(frames)}
        with torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16, enabled=torch.cuda.is_available()):
            state = predictor.init_state(video_path=d)
            for tr in tracks:
                t_best, b_best = max(tr.points, key=lambda p: p[1].score)
                box = np.array(
                    [b_best.x * w, b_best.y * h, (b_best.x + b_best.w) * w, (b_best.y + b_best.h) * h], dtype=np.float32
                )
                predictor.add_new_points_or_box(state, frame_idx=t_index[t_best], obj_id=tr.id, box=box)
            refined: dict[int, list[tuple[int, Box]]] = {tr.id: [] for tr in tracks}
            scores = {tr.id: float(np.mean([b.score for _, b in tr.points])) for tr in tracks}
            for reverse in (False, True):
                for frame_idx, obj_ids, mask_logits in predictor.propagate_in_video(state, reverse=reverse):
                    for k, oid in enumerate(obj_ids):
                        m = (mask_logits[k] > 0).squeeze().cpu().numpy()
                        ys, xs = np.nonzero(m)
                        if len(xs) == 0:
                            continue
                        b = Box(
                            x=xs.min() / w,
                            y=ys.min() / h,
                            w=(xs.max() - xs.min() + 1) / w,
                            h=(ys.max() - ys.min() + 1) / h,
                            score=scores[oid],
                        )
                        refined[oid].append((frames[frame_idx].t_ms, b))
                if on_progress:
                    on_progress(0.8 if not reverse else 0.95)
    out = []
    for tr in tracks:
        pts = sorted({t: b for t, b in refined[tr.id]}.items())
        out.append(Track(id=tr.id, points=pts or tr.points))
    return out


def _box(b: Box) -> dict:
    return {"x": round(b.x, 5), "y": round(b.y, 5), "w": round(b.w, 5), "h": round(b.h, 5)}


def dumps(tracks: list[dict]) -> str:
    return json.dumps({"tracks": tracks})
