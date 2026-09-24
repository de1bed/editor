from media.schemas import Transcript
from media.transcribe import segments_to_transcript

SEGMENTS = [
    {
        "start": 0.5,
        "end": 2.4,
        "speaker": "SPEAKER_00",
        "words": [
            {"word": "Hola", "start": 0.5, "end": 0.8, "score": 0.9, "speaker": "SPEAKER_00"},
            {"word": "a", "start": 0.85, "end": 0.9, "score": 0.8, "speaker": "SPEAKER_00"},
            {"word": "todos.", "start": 0.95, "end": 1.4, "score": 0.95, "speaker": "SPEAKER_00"},
            {"word": "2024"},  # alignment could not time it
            {"word": "fue", "start": 1.9, "end": 2.1, "score": 0.9, "speaker": "SPEAKER_00"},
        ],
    },
    {
        "start": 3.0,
        "end": 4.0,
        "speaker": "SPEAKER_01",
        "words": [
            {"word": "¿En", "start": 3.0, "end": 3.2, "speaker": "SPEAKER_01"},
            {"word": "serio?", "start": 3.25, "end": 3.9},
        ],
    },
]


def test_converts_and_validates():
    t = segments_to_transcript(
        SEGMENTS, asset_id="a1", language="es", provider="whisperx", provider_version="3", duration_ms=5000
    )
    Transcript.model_validate(t)
    words = t["words"]
    assert [w["id"] for w in words] == [f"w{i}" for i in range(7)]
    untimed = words[3]
    assert untimed["text"] == "2024" and 1400 <= untimed["startMs"] <= untimed["endMs"] <= 1900
    assert all(a["startMs"] <= b["startMs"] for a, b in zip(words, words[1:], strict=False))
    # word without speaker inherits the segment speaker
    assert words[6]["speaker"] == "SPEAKER_01"
    # sentences: "Hola a todos." | "2024 fue" | "¿En serio?"
    assert [len(s["wordIds"]) for s in t["sentences"]] == [3, 2, 2]
    assert [s["label"] for s in t["speakers"]] == ["Hablante 1", "Hablante 2"]
