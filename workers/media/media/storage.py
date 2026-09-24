"""Object storage + job status access.

`SupabaseStorage` talks to Supabase Storage/PostgREST with the service-role key.
`LocalStorage` maps buckets to folders (tests and offline development).
"""

from __future__ import annotations

import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol
from urllib.parse import quote

import httpx


@dataclass(frozen=True)
class Ref:
    bucket: str
    path: str

    @classmethod
    def of(cls, obj) -> Ref:
        if isinstance(obj, Ref):
            return obj
        if isinstance(obj, dict):
            return cls(obj["bucket"], obj["path"])
        return cls(obj.bucket, obj.path)


class Storage(Protocol):
    def download(self, ref: Ref, dest: Path) -> Path: ...
    def upload(self, src: Path, ref: Ref, content_type: str) -> int: ...
    def read_url(self, ref: Ref, expires_in: int = 3600) -> str: ...


class JobReporter(Protocol):
    def progress(self, fraction: float, step: str | None = None) -> None: ...


class NullReporter:
    def progress(self, fraction: float, step: str | None = None) -> None:  # noqa: D102
        pass


class LocalStorage:
    def __init__(self, root: Path):
        self.root = Path(root)

    def _p(self, ref: Ref) -> Path:
        return self.root / ref.bucket / ref.path

    def download(self, ref: Ref, dest: Path) -> Path:
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(self._p(ref), dest)
        return dest

    def upload(self, src: Path, ref: Ref, content_type: str) -> int:
        p = self._p(ref)
        p.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, p)
        return p.stat().st_size

    def read_url(self, ref: Ref, expires_in: int = 3600) -> str:
        return str(self._p(ref))


class SupabaseStorage:
    """Minimal Supabase Storage client (streaming download, upsert upload, signed URLs)."""

    def __init__(self, url: str | None = None, service_key: str | None = None):
        self.url = (url or os.environ["SUPABASE_URL"]).rstrip("/")
        self.key = service_key or os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        self.http = httpx.Client(
            headers={"Authorization": f"Bearer {self.key}", "apikey": self.key},
            timeout=httpx.Timeout(60.0, read=600.0),
        )

    def _obj(self, ref: Ref) -> str:
        return f"{self.url}/storage/v1/object/{ref.bucket}/{quote(ref.path)}"

    def download(self, ref: Ref, dest: Path) -> Path:
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(dest.suffix + ".part")
        with self.http.stream("GET", self._obj(ref)) as r:
            r.raise_for_status()
            with open(tmp, "wb") as f:
                for chunk in r.iter_bytes(1 << 20):
                    f.write(chunk)
        tmp.rename(dest)
        return dest

    def upload(self, src: Path, ref: Ref, content_type: str) -> int:
        size = src.stat().st_size
        with open(src, "rb") as f:
            r = self.http.post(
                self._obj(ref),
                content=f,
                headers={"Content-Type": content_type, "x-upsert": "true", "Content-Length": str(size)},
            )
        r.raise_for_status()
        return size

    def read_url(self, ref: Ref, expires_in: int = 3600) -> str:
        r = self.http.post(
            f"{self.url}/storage/v1/object/sign/{ref.bucket}/{quote(ref.path)}", json={"expiresIn": expires_in}
        )
        r.raise_for_status()
        signed = r.json()["signedURL"]
        return f"{self.url}/storage/v1{signed}" if signed.startswith("/") else signed


class SupabaseJobReporter:
    """Writes progress into public.jobs so the UI (Realtime) can show it. Throttled."""

    def __init__(self, job_id: str | None, url: str | None = None, service_key: str | None = None):
        self.job_id = job_id
        self.last = -1.0
        if job_id:
            self.url = (url or os.environ["SUPABASE_URL"]).rstrip("/")
            key = service_key or os.environ["SUPABASE_SERVICE_ROLE_KEY"]
            self.http = httpx.Client(
                headers={"Authorization": f"Bearer {key}", "apikey": key, "Content-Type": "application/json"},
                timeout=10.0,
            )

    def progress(self, fraction: float, step: str | None = None) -> None:
        if not self.job_id:
            return
        fraction = max(0.0, min(1.0, fraction))
        if fraction - self.last < 0.02 and fraction < 1.0 and step is None:
            return
        self.last = fraction
        body: dict = {"progress": round(fraction, 4)}
        if step:
            body["step"] = step
        try:
            self.http.patch(f"{self.url}/rest/v1/jobs?id=eq.{self.job_id}", json=body)
        except httpx.HTTPError:
            pass  # progress is best-effort
