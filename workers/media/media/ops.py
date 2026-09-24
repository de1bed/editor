"""Worker operations. Each takes a validated request dict, a Storage and a
JobReporter, and returns a JSON-serializable result. Used by the Modal app
and by the local CLI. Operations are idempotent: outputs go to the
deterministic storage paths given in the request and are overwritten."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

from . import ffmpeg
from .render import execute_plan
from .schemas import AnalyzeFacesRequest, DetectRequest, IngestRequest, RenderRequest, TranscribeRequest
from .storage import JobReporter, NullReporter, Ref, Storage


def _suffix(path: str, default: str) -> str:
    s = Path(path).suffix
    return s if s else default


def ingest(raw: dict, storage: Storage, reporter: JobReporter | None = None) -> dict:
    req = IngestRequest.model_validate(raw)
    rep = reporter or NullReporter()
    with tempfile.TemporaryDirectory(prefix="ingest-") as d:
        src = Path(d) / f"source{_suffix(req.source.path, '.mp4')}"
        rep.progress(0.01, "download")
        storage.download(Ref.of(req.source), src)
        info = ffmpeg.probe(src)
        info["bytes"] = src.stat().st_size
        dur = info["durationMs"]

        proxy = Path(d) / "proxy.mp4"
        rep.progress(0.05, "proxy")
        ffmpeg.make_proxy(src, proxy, req.proxyHeight, info["hasAudio"], dur, lambda f: rep.progress(0.05 + 0.75 * f))
        audio = Path(d) / "audio.wav"
        rep.progress(0.8, "audio")
        if info["hasAudio"]:
            ffmpeg.extract_audio(src, audio, dur, lambda f: rep.progress(0.8 + 0.1 * f))
        else:
            ffmpeg.extract_audio(proxy, audio, dur)
        thumb = Path(d) / "thumb.jpg"
        ffmpeg.thumbnail(proxy, thumb, min(dur // 3, 10_000))
        rep.progress(0.92, "upload")
        pinfo = ffmpeg.probe(proxy)
        proxy_bytes = storage.upload(proxy, Ref.of(req.proxyOut), "video/mp4")
        audio_bytes = storage.upload(audio, Ref.of(req.audioOut), "audio/wav")
        thumb_bytes = storage.upload(thumb, Ref.of(req.thumbOut), "image/jpeg")
    rep.progress(1.0, "done")
    return {
        "probe": info,
        "proxy": {"width": pinfo["width"], "height": pinfo["height"], "bytes": proxy_bytes},
        "audioBytes": audio_bytes,
        "thumbBytes": thumb_bytes,
    }


def transcribe(raw: dict, storage: Storage, reporter: JobReporter | None = None, transcriber=None) -> dict:
    from .transcribe import get_transcriber, segments_to_transcript

    req = TranscribeRequest.model_validate(raw)
    rep = reporter or NullReporter()
    tr = transcriber or get_transcriber()
    with tempfile.TemporaryDirectory(prefix="asr-") as d:
        audio = Path(d) / "audio.wav"
        rep.progress(0.01, "download")
        storage.download(Ref.of(req.audio), audio)
        duration = ffmpeg.probe(audio)["durationMs"]
        segments, lang = tr.transcribe(
            audio,
            req.language,
            req.diarize,
            req.minSpeakers,
            req.maxSpeakers,
            on_progress=lambda f, step=None: rep.progress(0.05 + 0.9 * f, step),
        )
        transcript = segments_to_transcript(
            segments,
            asset_id=req.assetId,
            language=lang,
            provider=tr.name,
            provider_version=str(tr.version),
            duration_ms=duration,
        )
        out = Path(d) / "transcript.json"
        out.write_text(json.dumps(transcript, ensure_ascii=False), encoding="utf-8")
        storage.upload(out, Ref.of(req.out), "application/json")
    rep.progress(1.0, "done")
    return {
        "out": {"bucket": req.out.bucket, "path": req.out.path},
        "language": lang,
        "wordCount": len(transcript["words"]),
        "durationMs": duration,
        "provider": tr.name,
    }


def analyze_faces(raw: dict, storage: Storage, reporter: JobReporter | None = None) -> dict:
    from .vision.faces import analyze_faces as run

    req = AnalyzeFacesRequest.model_validate(raw)
    rep = reporter or NullReporter()
    video = storage.read_url(Ref.of(req.video))  # ffmpeg seeks over HTTP range requests
    turns = [t.model_dump() for t in req.speakerTurns]
    res = run(video, req.startMs, req.endMs, req.sampleFps, turns, on_progress=lambda f: rep.progress(f, None))
    res["assetId"] = req.assetId
    rep.progress(1.0, "done")
    return res


def detect_objects(raw: dict, storage: Storage, reporter: JobReporter | None = None) -> dict:
    from .vision.detect import detect_objects as run

    req = DetectRequest.model_validate(raw)
    rep = reporter or NullReporter()
    video = storage.read_url(Ref.of(req.video))
    tracks = run(req.model_dump(), video, on_progress=lambda f: rep.progress(f, None))
    rep.progress(1.0, "done")
    return {"tracks": tracks}


def render(raw: dict, storage: Storage, reporter: JobReporter | None = None) -> dict:
    req = RenderRequest.model_validate(raw)
    rep = reporter or NullReporter()
    plan = req.plan.model_dump(mode="json")
    inputs = {k: storage.read_url(Ref.of(v)) for k, v in req.inputs.items()}
    with tempfile.TemporaryDirectory(prefix="render-") as d:
        out = Path(d) / "out.mp4"
        rep.progress(0.01, "render")
        execute_plan(plan, inputs, out, on_progress=lambda f: rep.progress(0.02 + 0.93 * f))
        rep.progress(0.96, "upload")
        size = storage.upload(out, Ref.of(req.out), "video/mp4")
        duration = ffmpeg.probe(out)["durationMs"]
    rep.progress(1.0, "done")
    return {"out": {"bucket": req.out.bucket, "path": req.out.path}, "bytes": size, "durationMs": duration}


OPS = {
    "ingest": ingest,
    "transcribe": transcribe,
    "analyze_faces": analyze_faces,
    "detect_objects": detect_objects,
    "render": render,
}


def fetch_url(raw: dict, storage: Storage, reporter: JobReporter | None = None) -> dict:
    """Downloads a remote video with yt-dlp (only reachable behind the YouTube feature flag)."""
    import subprocess

    from .schemas.generated.FetchUrlRequest_schema import FetchUrlRequest

    req = FetchUrlRequest.model_validate(raw)
    rep = reporter or NullReporter()
    h = req.maxHeight
    with tempfile.TemporaryDirectory(prefix="fetch-") as d:
        rep.progress(0.02, "download")
        proc = subprocess.run(
            [
                "yt-dlp", "--no-playlist", "--no-progress",
                "-f", f"bv*[height<={h}]+ba/b[height<={h}]", "--merge-output-format", "mp4",
                "-o", str(Path(d) / "video.%(ext)s"), "--print", "after_move:%(title)s", str(req.url),
            ],
            capture_output=True, text=True, timeout=3 * 3600,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"yt-dlp failed: {proc.stderr[-2000:]}")
        file = next(Path(d).glob("video.*"))
        rep.progress(0.8, "upload")
        size = storage.upload(file, Ref.of(req.out), "video/mp4")
        dur = ffmpeg.probe(file)["durationMs"]
    rep.progress(1.0, "done")
    title = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else ""
    return {"out": {"bucket": req.out.bucket, "path": req.out.path}, "bytes": size, "title": title, "durationMs": dur or None, "mimeType": "video/mp4"}


OPS["fetch_url"] = fetch_url
