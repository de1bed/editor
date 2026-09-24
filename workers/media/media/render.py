"""Executes a RenderPlan compiled by @editor/core (same placeholder rules as packages/render/src/execute.ts)."""

from __future__ import annotations

import os
import re
import tempfile
from collections.abc import Callable
from pathlib import Path

from . import ffmpeg

FONTS_DIR = Path(os.environ.get("MEDIA_FONTS_DIR") or Path(__file__).resolve().parents[3] / "assets" / "fonts")


def _escape_filter_path(p: str) -> str:
    return p.replace("\\", "/").replace(":", "\\:").replace("'", "\\'")


def substitute(
    args: list[str], inputs: dict[str, str], files: dict[str, str], fonts_dir: str, output: str
) -> list[str]:
    def input_repl(m: re.Match) -> str:
        key = m.group(1)
        if key not in inputs:
            raise KeyError(f'render plan references unknown input "{key}"')
        return inputs[key]

    def file_repl(m: re.Match) -> str:
        key = m.group(1)
        if key not in files:
            raise KeyError(f'render plan references unknown file "{key}"')
        return _escape_filter_path(files[key])

    out = []
    for a in args:
        a = re.sub(r"\{\{input:([^}]+)\}\}", input_repl, a)
        a = re.sub(r"\{\{file:([^}]+)\}\}", file_repl, a)
        a = a.replace("{{fontsdir}}", _escape_filter_path(fonts_dir)).replace("{{output}}", output)
        out.append(a)
    return out


def execute_plan(
    plan: dict,
    inputs: dict[str, str],
    output: Path,
    fonts_dir: Path | None = None,
    on_progress: Callable[[float], None] | None = None,
) -> None:
    """`inputs` maps each plan input key to a local path or URL."""
    fonts = fonts_dir or FONTS_DIR
    with tempfile.TemporaryDirectory(prefix="render-") as work:
        files = {}
        for name, content in plan.get("files", {}).items():
            p = Path(work) / name
            p.write_text(content, encoding="utf-8")
            files[name] = str(p)
        args = substitute(plan["args"], inputs, files, str(fonts), str(output))
        # The plan already contains -hide_banner/-nostdin/-y; ffmpeg.run adds progress flags.
        args = [a for a in args if a not in ("-hide_banner", "-nostdin", "-y")]
        ffmpeg.run(args, plan["output"]["durationMs"], on_progress)
