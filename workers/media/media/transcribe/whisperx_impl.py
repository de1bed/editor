"""WhisperX: faster-whisper ASR + wav2vec2 word alignment + pyannote diarization (GPU)."""

from __future__ import annotations

import os
from pathlib import Path


class WhisperXTranscriber:
    name = "whisperx"

    def __init__(self):
        import whisperx  # heavy import, only inside the GPU image

        self.whisperx = whisperx
        self.version = getattr(whisperx, "__version__", "3")
        self.device = "cuda" if _cuda() else "cpu"
        self.model_name = os.environ.get("WHISPER_MODEL", "large-v3")
        compute_type = "float16" if self.device == "cuda" else "int8"
        # Profanity must be transcribed verbatim so we can censor it ourselves;
        # an empty initial prompt avoids Whisper's tendency to sanitize.
        self.model = whisperx.load_model(self.model_name, self.device, compute_type=compute_type)

    def transcribe(self, audio_path: Path, language, diarize, min_speakers, max_speakers, on_progress=None):
        wx = self.whisperx
        report = on_progress or (lambda *_: None)
        audio = wx.load_audio(str(audio_path))
        report(0.05, "asr")
        result = self.model.transcribe(audio, batch_size=16, language=language or None)
        lang = result.get("language") or language or "en"
        report(0.55, "align")
        align_model, metadata = wx.load_align_model(language_code=lang, device=self.device)
        result = wx.align(result["segments"], align_model, metadata, audio, self.device, return_char_alignments=False)
        if diarize and os.environ.get("HF_TOKEN"):
            report(0.75, "diarize")
            from whisperx.diarize import DiarizationPipeline

            pipe = DiarizationPipeline(use_auth_token=os.environ["HF_TOKEN"], device=self.device)
            diar = pipe(audio, min_speakers=min_speakers, max_speakers=max_speakers)
            result = wx.assign_word_speakers(diar, result)
        report(0.95, "convert")
        return result["segments"], lang


def _cuda() -> bool:
    try:
        import torch

        return torch.cuda.is_available()
    except Exception:  # noqa: BLE001
        return False
