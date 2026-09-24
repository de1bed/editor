"""Modal deployment of the media workers.

    cd workers/media && modal deploy media/modal_app.py

Secrets (create in Modal):
  editor-supabase : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
  editor-worker   : MEDIA_WORKER_TOKEN (shared with the web app / Trigger.dev)
  editor-hf       : HF_TOKEN (pyannote diarization models are gated; accept their terms first)

HTTP API (FastAPI, bearer MEDIA_WORKER_TOKEN):
  POST /ops/{op}        body = request JSON → {"callId"}   (op: fetch_url|ingest|transcribe|analyze_faces|detect_objects|render)
  GET  /calls/{callId}  → {"status": "running"} | {"status": "succeeded", "result": …} | {"status": "failed", "error": …}
"""

from __future__ import annotations

import os
from pathlib import Path

import modal

HERE = Path(__file__).resolve().parent
FONTS = HERE.parents[2] / "assets" / "fonts"
YUNET_URL = (
    "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
)

app = modal.App("editor-media")
models = modal.Volume.from_name("editor-models", create_if_missing=True)
supabase = modal.Secret.from_name("editor-supabase")
worker_token = modal.Secret.from_name("editor-worker")
hf = modal.Secret.from_name("editor-hf")

base_env = {"MEDIA_FONTS_DIR": "/assets/fonts", "HF_HOME": "/models/hf", "PYTHONUNBUFFERED": "1"}

cpu_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "fonts-dejavu-core")
    .pip_install("pydantic>=2.9", "httpx>=0.27", "numpy>=1.26", "yt-dlp")
    .env(base_env)
    .add_local_dir(str(FONTS), "/assets/fonts")
    .add_local_python_source("media")
)

gpu_base = (
    modal.Image.from_registry("nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04", add_python="3.11")
    .apt_install("ffmpeg", "git", "curl", "libgl1", "libglib2.0-0")
    .pip_install("pydantic>=2.9", "httpx>=0.27", "numpy>=1.26")
    .env(base_env)
)

asr_image = gpu_base.pip_install("whisperx==3.4.2").add_local_python_source("media")

vision_image = (
    gpu_base.pip_install(
        "torch==2.5.1",
        "torchvision==0.20.1",
        "transformers>=4.46,<5",
        "opencv-python-headless>=4.10",
        "pillow>=10",
        "git+https://github.com/facebookresearch/sam2.git",
    )
    .run_commands(f"mkdir -p /opt/models && curl -fsSL -o /opt/models/yunet.onnx {YUNET_URL}")
    .env({"YUNET_MODEL": "/opt/models/yunet.onnx"})
    .add_local_python_source("media")
)


def _run(op: str, raw: dict) -> dict:
    from media.ops import OPS
    from media.storage import SupabaseJobReporter, SupabaseStorage

    return OPS[op](raw, SupabaseStorage(), SupabaseJobReporter(raw.get("jobId")))


@app.function(image=cpu_image, secrets=[supabase], cpu=4.0, memory=8192, timeout=4 * 3600, ephemeral_disk=200 * 1024)
def ingest(raw: dict) -> dict:
    return _run("ingest", raw)


@app.function(image=cpu_image, secrets=[supabase], cpu=2.0, memory=4096, timeout=4 * 3600, ephemeral_disk=100 * 1024)
def fetch_url(raw: dict) -> dict:
    return _run("fetch_url", raw)


@app.function(image=cpu_image, secrets=[supabase], cpu=8.0, memory=8192, timeout=2 * 3600)
def render(raw: dict) -> dict:
    return _run("render", raw)


@app.cls(
    image=asr_image,
    gpu="L4",
    secrets=[supabase, hf],
    volumes={"/models": models},
    timeout=4 * 3600,
    scaledown_window=120,
)
class Transcriber:
    @modal.enter()
    def load(self):
        from media.transcribe import get_transcriber

        self.tr = get_transcriber("whisperx")

    @modal.method()
    def run(self, raw: dict) -> dict:
        from media.ops import transcribe
        from media.storage import SupabaseJobReporter, SupabaseStorage

        return transcribe(raw, SupabaseStorage(), SupabaseJobReporter(raw.get("jobId")), transcriber=self.tr)


@app.function(image=vision_image, gpu="T4", secrets=[supabase], volumes={"/models": models}, timeout=3600)
def analyze_faces(raw: dict) -> dict:
    return _run("analyze_faces", raw)


@app.function(image=vision_image, gpu="L4", secrets=[supabase], volumes={"/models": models}, timeout=3600)
def detect_objects(raw: dict) -> dict:
    return _run("detect_objects", raw)


web_image = modal.Image.debian_slim(python_version="3.11").pip_install("fastapi[standard]>=0.115")


@app.function(image=web_image, secrets=[worker_token])
@modal.asgi_app()
def api():
    from fastapi import FastAPI, Header, HTTPException

    web = FastAPI(title="editor-media")
    spawners = {
        "fetch_url": fetch_url.spawn,
        "ingest": ingest.spawn,
        "render": render.spawn,
        "transcribe": Transcriber().run.spawn,
        "analyze_faces": analyze_faces.spawn,
        "detect_objects": detect_objects.spawn,
    }

    def check(auth: str | None) -> None:
        expected = os.environ["MEDIA_WORKER_TOKEN"]
        if not auth or auth.removeprefix("Bearer ").strip() != expected:
            raise HTTPException(status_code=401, detail="unauthorized")

    @web.post("/ops/{op}")
    def spawn(op: str, body: dict, authorization: str | None = Header(default=None)):
        check(authorization)
        if op not in spawners:
            raise HTTPException(status_code=404, detail=f"unknown op {op}")
        call = spawners[op](body)
        return {"callId": call.object_id}

    @web.get("/calls/{call_id}")
    def status(call_id: str, authorization: str | None = Header(default=None)):
        check(authorization)
        fc = modal.FunctionCall.from_id(call_id)
        try:
            return {"status": "succeeded", "result": fc.get(timeout=0)}
        except TimeoutError:
            return {"status": "running"}
        except modal.exception.OutputExpiredError:
            return {"status": "failed", "error": "result expired"}
        except Exception as e:  # noqa: BLE001 — surface worker errors to the orchestrator
            return {"status": "failed", "error": f"{type(e).__name__}: {e}"}

    @web.delete("/calls/{call_id}")
    def cancel(call_id: str, authorization: str | None = Header(default=None)):
        check(authorization)
        modal.FunctionCall.from_id(call_id).cancel()
        return {"status": "canceled"}

    return web
