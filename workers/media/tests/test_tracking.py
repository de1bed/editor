from media.vision.tracking import Box, assign_speakers, iou, link, rdp_keyframes


def b(x, y, w=0.1, h=0.1, **extra):
    return Box(x=x, y=y, w=w, h=h, extra=extra)


def test_iou():
    assert iou(b(0, 0), b(0, 0)) == 1
    assert iou(b(0, 0), b(0.5, 0.5)) == 0
    assert abs(iou(b(0, 0, 0.2, 0.2), b(0.1, 0, 0.2, 0.2)) - 1 / 3) < 1e-9


def test_link_two_objects_with_gap():
    frames = []
    for i in range(10):
        boxes = [b(0.1 + i * 0.01, 0.1), b(0.7, 0.6 - i * 0.01)]
        if i == 4:
            boxes = boxes[1:]  # object A missed for one frame
        frames.append((i * 200, boxes))
    tracks = link(frames, max_gap_ms=500)
    assert len(tracks) == 2
    assert sorted(len(t.points) for t in tracks) == [9, 10]


def test_assign_speakers_by_mouth_activity():
    # face 0 talks during 0–2 s, face 1 during 2–4 s
    frames = []
    for i in range(20):
        t = i * 200
        frames.append((t, [b(0.1, 0.3, mouth=1.0 if t < 2000 else 0.1), b(0.7, 0.3, mouth=0.1 if t < 2000 else 1.0)]))
    tracks = link(frames)
    turns = [("S0", 0, 2000), ("S1", 2000, 4000)]
    m = assign_speakers(tracks, turns)
    left = next(t for t in tracks if t.points[0][1].x < 0.5)
    right = next(t for t in tracks if t.points[0][1].x > 0.5)
    assert m == {left.id: "S0", right.id: "S1"}


def test_rdp_keeps_turns_only():
    pts = [(i * 100, b(0.01 * i, 0.2)) for i in range(11)] + [
        (1000 + i * 100, b(0.1, 0.2 + 0.02 * i)) for i in range(1, 6)
    ]
    kept = rdp_keyframes(pts, 0.002)
    assert len(kept) == 3
    assert kept[0][0] == 0 and kept[-1][0] == 1500
