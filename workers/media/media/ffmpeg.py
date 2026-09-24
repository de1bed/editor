"""FFmpeg/ffprobe helpers."""

from __future__ import annotations

import json
import re
import subprocess
from collections.abc import Callable
from pathlib import Path

FFMPEG = "ffmpeg"
FFPROBE = "ffprobe"


def probe(path: str | Path) -> dict:
    out = subprocess.run(
        [FFPROBE, "-v", "error", "-print_format", "json", "-show_streams", "-show_format", str(path)],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    j = json.loads(out)
    v = next((s for s in j["streams"] if s.get("codec_type") == "video"), None)
    a = next((s for s in j["streams"] if s.get("codec_type") == "audio"), None)
    rate = (v or {}).get("avg_frame_rate") or "0/0"
    if rate == "0/0":
        rate = (v or {}).get("r_frame_rate") or "30/1"
    num, den = (int(x) for x in rate.split("/"))
    size = int(j["format"].get("size") or 0)
    return {
        "durationMs": round(float(j["format"].get("duration") or 0) * 1000),
        "width": int((v or {}).get("width") or 0),
        "height": int((v or {}).get("height") or 0),
        "fps": {"num": num or 30, "den": den or 1},
        "hasAudio": a is not None,
        "videoCodec": (v or {}).get("codec_name"),
        "audioCodec": (a or {}).get("codec_name"),
        "bytes": size,
    }


def run(args: list[str], duration_ms: int | None = None, on_progress: Callable[[float], None] | None = None) -> str:
    """Runs ffmpeg with `-progress pipe:1`, reporting fraction done. Returns stderr tail on success."""
    cmd = [FFMPEG, "-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-nostats", *args]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    assert proc.stdout and proc.stderr
    pattern = re.compile(r"out_time_us=(\d+)")
    for line in proc.stdout:
        m = pattern.match(line.strip())
        if m and on_progress and duration_ms:
            on_progress(min(1.0, int(m.group(1)) / 1000 / duration_ms))
    stderr = proc.stderr.read()
    if proc.wait() != 0:
        raise RuntimeError(f"ffmpeg failed ({proc.returncode}): {stderr[-4000:]}")
    return stderr[-4000:]


def make_proxy(src: Path, dest: Path, height: int, has_audio: bool, duration_ms: int, on_progress=None) -> None:
    """Constant-frame-rate H.264 proxy with keyframes every second (fast seeking), always with an audio track."""
    inputs = ["-i", str(src)]
    maps = ["-map", "0:v:0"]
    if has_audio:
        maps += ["-map", "0:a:0"]
    else:
        inputs += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
        maps += ["-map", "1:a:0", "-shortest"]
    run(
        [
            *inputs,
            *maps,
            "-vf",
            f"scale=-2:{height}:flags=bicubic,fps=30,format=yuv420p",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "26",
            "-g",
            "30",
            "-keyint_min",
            "30",
            "-sc_threshold",
            "0",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-movflags",
            "+faststart",
            str(dest),
        ],
        duration_ms,
        on_progress,
    )


def extract_audio(src: Path, dest: Path, duration_ms: int, on_progress=None) -> None:
    """16 kHz mono WAV for ASR."""
    run(["-i", str(src), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(dest)], duration_ms, on_progress)


def thumbnail(src: Path, dest: Path, at_ms: int) -> None:
    run(["-ss", f"{at_ms / 1000:.3f}", "-i", str(src), "-frames:v", "1", "-vf", "scale=-2:360", "-q:v", "4", str(dest)])
