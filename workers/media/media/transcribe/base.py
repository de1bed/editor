"""Transcriber interface. WhisperX is the default; Deepgram/AssemblyAI are
implemented on the TypeScript side (packages/jobs) since they are plain HTTP APIs."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Protocol


class Transcriber(Protocol):
    name: str
    version: str

    def transcribe(
        self,
        audio_path: Path,
        language: str | None,
        diarize: bool,
        min_speakers: int | None,
        max_speakers: int | None,
        on_progress=None,
    ) -> tuple[list[dict], str]:
        """Returns (segments in WhisperX format with per-word timings and speakers, detected language)."""
        ...


def get_transcriber(name: str | None = None) -> Transcriber:
    name = name or os.environ.get("TRANSCRIBER", "whisperx")
    if name == "whisperx":
        from .whisperx_impl import WhisperXTranscriber

        return WhisperXTranscriber()
    raise ValueError(f"unknown transcriber {name!r}")
