"""Runs real ffmpeg: ingest and render against the fixture video with LocalStorage."""

import json
import shutil

import pytest

from media import ffmpeg
from media.ops import ingest, render
from media.storage import LocalStorage

pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")


@pytest.fixture
def storage(tmp_path, fixtures):
    s = LocalStorage(tmp_path)
    (tmp_path / "media/u/p/a").mkdir(parents=True)
    shutil.copy(fixtures / "video/sample_10s.mp4", tmp_path / "media/u/p/a/source.mp4")
    return s


def ref(path):
    return {"bucket": "media", "path": path}


def test_ingest_makes_proxy_audio_thumb(storage, tmp_path):
    res = ingest(
        {
            "source": ref("u/p/a/source.mp4"),
            "proxyOut": ref("u/p/a/proxy.mp4"),
            "audioOut": ref("u/p/a/audio.wav"),
            "thumbOut": ref("u/p/a/thumb.jpg"),
            "proxyHeight": 240,
        },
        storage,
    )
    assert res["probe"]["durationMs"] == 10000
    assert res["probe"]["width"] == 640 and res["probe"]["hasAudio"]
    assert res["proxy"]["height"] == 240
    p = ffmpeg.probe(tmp_path / "media/u/p/a/proxy.mp4")
    assert p["fps"] == {"num": 30, "den": 1} and p["hasAudio"]
    a = ffmpeg.probe(tmp_path / "media/u/p/a/audio.wav")
    assert abs(a["durationMs"] - 10000) < 50


def test_render_parity_with_typescript_plan(storage, tmp_path, fixtures):
    plan = json.loads((fixtures / "plans/sample.plan.json").read_text())
    res = render({"plan": plan, "inputs": {"src": ref("u/p/a/source.mp4")}, "out": ref("u/p/renders/x.mp4")}, storage)
    out = ffmpeg.probe(tmp_path / "media/u/p/renders/x.mp4")
    assert (out["width"], out["height"]) == (540, 960)
    assert abs(out["durationMs"] - plan["output"]["durationMs"]) <= 70
    assert res["bytes"] > 10_000
