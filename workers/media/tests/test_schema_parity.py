"""The Python models are generated from the same JSON Schema as the Zod types:
anything the TypeScript side produces must validate here, and vice versa."""

import json

from media.schemas import RenderPlan, Timeline, Transcript


def test_fixture_transcript_validates(fixtures):
    t = Transcript.model_validate_json((fixtures / "transcripts/sample_10s.json").read_text())
    assert len(t.words) == 19
    assert t.words[7].text == "mierda"


def test_ts_timeline_validates(fixtures):
    raw = json.loads((fixtures / "plans/sample.timeline.json").read_text())
    t = Timeline.model_validate(raw)
    assert [s.id for s in t.segments] == ["seg_1", "seg_2"]
    assert t.blurs[0].kind.value == "face"
    # round-trip keeps the data
    again = json.loads(t.model_dump_json(exclude_none=True))
    assert again["segments"] == raw["segments"]


def test_ts_render_plan_validates(fixtures):
    plan = RenderPlan.model_validate_json((fixtures / "plans/sample.plan.json").read_text())
    assert plan.output.width == 540
    assert "{{input:src}}" in plan.args
