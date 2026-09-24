"""WhisperX-style segments → shared Transcript JSON (ids, integer ms, sentences)."""

from __future__ import annotations

import re

_SENTENCE_END = re.compile(r"[.!?…][\"»”')]*$")


def segments_to_transcript(
    segments: list[dict],
    *,
    asset_id: str,
    language: str,
    provider: str,
    provider_version: str,
    duration_ms: int,
) -> dict:
    words: list[dict] = []
    for seg in segments:
        seg_speaker = seg.get("speaker")
        seg_words = seg.get("words") or []
        # Words that alignment could not time (numbers, symbols) inherit neighbours' times.
        for i, w in enumerate(seg_words):
            text = (w.get("word") or w.get("text") or "").strip()
            if not text:
                continue
            start = w.get("start")
            end = w.get("end")
            if start is None or end is None:
                prev_end = words[-1]["endMs"] / 1000 if words else seg.get("start", 0)
                nxt = next((x for x in seg_words[i + 1 :] if x.get("start") is not None), None)
                start = prev_end if start is None else start
                end = (nxt["start"] if nxt else seg.get("end", start)) if end is None else end
            start_ms = max(0, round(float(start) * 1000))
            end_ms = max(start_ms, round(float(end) * 1000))
            if words and start_ms < words[-1]["startMs"]:
                start_ms = words[-1]["startMs"]
                end_ms = max(end_ms, start_ms)
            words.append(
                {
                    "id": f"w{len(words)}",
                    "text": text,
                    "startMs": min(start_ms, duration_ms),
                    "endMs": min(end_ms, duration_ms),
                    "speaker": w.get("speaker") or seg_speaker,
                    "confidence": float(max(0.0, min(1.0, w.get("score", w.get("confidence", 1.0)) or 0.0))),
                }
            )

    sentences: list[dict] = []
    current: list[dict] = []
    for w in words:
        if current and (w["speaker"] != current[-1]["speaker"] or w["startMs"] - current[-1]["endMs"] > 1500):
            sentences.append(_sentence(current, len(sentences)))
            current = []
        current.append(w)
        if _SENTENCE_END.search(w["text"]):
            sentences.append(_sentence(current, len(sentences)))
            current = []
    if current:
        sentences.append(_sentence(current, len(sentences)))

    speakers = sorted({w["speaker"] for w in words if w["speaker"]})
    return {
        "assetId": asset_id,
        "language": language,
        "provider": provider,
        "providerVersion": provider_version,
        "durationMs": duration_ms,
        "words": words,
        "speakers": [{"id": s, "label": f"Hablante {i + 1}"} for i, s in enumerate(speakers)],
        "sentences": sentences,
    }


def _sentence(ws: list[dict], i: int) -> dict:
    return {
        "id": f"s{i}",
        "startMs": ws[0]["startMs"],
        "endMs": ws[-1]["endMs"],
        "wordIds": [w["id"] for w in ws],
        "speaker": ws[0]["speaker"],
    }
