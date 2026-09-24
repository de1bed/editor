"""Frame sampling through ffmpeg (fast, seeks on input, fixed analysis width)."""

from __future__ import annotations

import subprocess
from collections.abc import Iterator
from dataclasses import dataclass

import numpy as np

from .. import ffmpeg


@dataclass
class Frame:
    t_ms: int
    image: np.ndarray  # H x W x 3, BGR uint8


def sample_frames(video: str, start_ms: int, end_ms: int, fps: float, width: int = 640) -> Iterator[Frame]:
    info = ffmpeg.probe(video)
    src_w, src_h = info["width"], info["height"]
    width = min(width, src_w) // 2 * 2
    height = round(src_h * width / src_w / 2) * 2
    cmd = [
        ffmpeg.FFMPEG,
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-ss",
        f"{start_ms / 1000:.3f}",
        "-t",
        f"{(end_ms - start_ms) / 1000:.3f}",
        "-i",
        video,
        "-vf",
        f"fps={fps},scale={width}:{height}",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "bgr24",
        "-",
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    assert proc.stdout
    size = width * height * 3
    i = 0
    try:
        while True:
            buf = proc.stdout.read(size)
            if len(buf) < size:
                break
            yield Frame(
                t_ms=start_ms + round(i * 1000 / fps), image=np.frombuffer(buf, np.uint8).reshape(height, width, 3)
            )
            i += 1
    finally:
        proc.stdout.close()
        proc.wait()
