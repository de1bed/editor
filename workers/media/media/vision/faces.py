"""Face tracks + active-speaker assignment for 9:16 reframing.

Detector: OpenCV YuNet (MIT, runs on CPU in real time at 640px).
Active speaker: mouth-region motion energy per face, matched against the
diarization turns (who speaks when). A learned ASD model (e.g. LR-ASD) can
replace `mouth_activity` later without touching the output format.
"""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np

from .frames import sample_frames
from .tracking import Box, assign_speakers, clamp_box, link, rdp_keyframes, smooth

YUNET_URL = (
    "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
)
YUNET_PATH = Path(os.environ.get("YUNET_MODEL", "/models/face_detection_yunet_2023mar.onnx"))


class FaceDetector:
    def __init__(self, score_threshold: float = 0.7):
        import cv2

        self.cv2 = cv2
        self.detector = cv2.FaceDetectorYN.create(str(YUNET_PATH), "", (320, 320), score_threshold, 0.3, 5000)

    def detect(self, img: np.ndarray) -> list[Box]:
        h, w = img.shape[:2]
        self.detector.setInputSize((w, h))
        _, faces = self.detector.detect(img)
        out = []
        for f in faces if faces is not None else []:
            x, y, bw, bh = (float(v) for v in f[:4])
            # landmarks: right eye, left eye, nose, right mouth corner, left mouth corner
            mouth = (float(f[10]), float(f[11]), float(f[12]), float(f[13]))
            box = clamp_box(Box(x=x / w, y=y / h, w=bw / w, h=bh / h, score=float(f[14]), extra={"mouth_px": mouth}))
            out.append(box)
        return out


def mouth_patch(img: np.ndarray, mouth_px: tuple[float, float, float, float], face_w_px: float) -> np.ndarray | None:
    x1, y1, x2, y2 = mouth_px
    cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
    half_w = max(abs(x2 - x1) * 0.8, face_w_px * 0.2)
    half_h = half_w * 0.7
    h, w = img.shape[:2]
    a, b = int(max(0, cx - half_w)), int(min(w, cx + half_w))
    c, d = int(max(0, cy - half_h * 0.6)), int(min(h, cy + half_h))
    if b - a < 4 or d - c < 4:
        return None
    gray = img[c:d, a:b].mean(axis=2)
    return gray


def analyze_faces(
    video: str, start_ms: int, end_ms: int, sample_fps: float, speaker_turns: list[dict], on_progress=None
) -> dict:
    import cv2

    det = FaceDetector()
    frames_out: list[tuple[int, list[Box]]] = []
    size = None
    total = max(1, int((end_ms - start_ms) / 1000 * sample_fps))
    for i, frame in enumerate(sample_frames(video, start_ms, end_ms, sample_fps)):
        size = frame.image.shape[1], frame.image.shape[0]
        boxes = det.detect(frame.image)
        frames_out.append((frame.t_ms, boxes))
        if on_progress and i % 10 == 0:
            on_progress(min(0.9, i / total))
        # Mouth activity needs the image: compute now and keep only the number.
        for b in boxes:
            patch = mouth_patch(frame.image, b.extra["mouth_px"], b.w * frame.image.shape[1])
            b.extra["patch"] = None if patch is None else cv2.resize(patch.astype(np.float32), (24, 16))

    tracks = link(frames_out, iou_threshold=0.3, max_gap_ms=1500)
    for tr in tracks:
        prev = None
        for _, b in tr.points:
            p = b.extra.pop("patch", None)
            b.extra.pop("mouth_px", None)
            b.extra["mouth"] = float(np.abs(p - prev).mean()) if p is not None and prev is not None else 0.0
            prev = p if p is not None else prev

    # Drop flickers: tracks shorter than a second of samples.
    tracks = [t for t in tracks if len(t.points) >= max(2, int(sample_fps))]
    turns = [(t["speaker"], t["startMs"], t["endMs"]) for t in speaker_turns]
    speaker_of = assign_speakers(tracks, turns) if turns else {}

    out_tracks = []
    for tr in tracks:
        pts = rdp_keyframes(smooth(tr.points, 0.6), 0.004)
        mouth_by_t = {t: b.extra.get("mouth", 0.0) for t, b in tr.points}
        out_tracks.append(
            {
                "id": f"face_{tr.id}",
                "speakerId": speaker_of.get(tr.id),
                "startMs": tr.points[0][0],
                "endMs": tr.points[-1][0] + round(1000 / sample_fps),
                "keyframes": [
                    {
                        "tMs": t,
                        "x": b.x,
                        "y": b.y,
                        "w": b.w,
                        "h": b.h,
                        "mouthActivity": round(mouth_by_t.get(t, 0.0), 4),
                    }
                    for t, b in pts
                ],
            }
        )
    w, h = size or (1, 1)
    return {"assetId": "", "sampleFps": sample_fps, "width": w, "height": h, "tracks": out_tracks}
