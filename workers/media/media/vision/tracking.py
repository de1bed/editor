"""Pure-numpy tracking utilities (unit tested, no ML dependencies)."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Box:
    """Normalized [0,1] box."""

    x: float
    y: float
    w: float
    h: float
    score: float = 1.0
    extra: dict = field(default_factory=dict)

    @property
    def cx(self) -> float:
        return self.x + self.w / 2

    @property
    def cy(self) -> float:
        return self.y + self.h / 2


def iou(a: Box, b: Box) -> float:
    x1, y1 = max(a.x, b.x), max(a.y, b.y)
    x2, y2 = min(a.x + a.w, b.x + b.w), min(a.y + a.h, b.y + b.h)
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    union = a.w * a.h + b.w * b.h - inter
    return inter / union if union > 0 else 0.0


@dataclass
class Track:
    id: int
    points: list[tuple[int, Box]] = field(default_factory=list)  # (t_ms, box)

    @property
    def last(self) -> tuple[int, Box]:
        return self.points[-1]


def link(frames: list[tuple[int, list[Box]]], iou_threshold: float = 0.3, max_gap_ms: int = 1500) -> list[Track]:
    """Greedy IoU association frame to frame. Tracks survive gaps up to `max_gap_ms`
    (a face turned away, a missed detection) and fall back to center distance when IoU is 0."""
    tracks: list[Track] = []
    next_id = 0
    for t_ms, boxes in frames:
        alive = [tr for tr in tracks if t_ms - tr.last[0] <= max_gap_ms]
        pairs = []
        for ti, tr in enumerate(alive):
            for bi, b in enumerate(boxes):
                score = iou(tr.last[1], b)
                if score < iou_threshold:
                    # moving objects at low sample rates: allow near centers
                    d = ((tr.last[1].cx - b.cx) ** 2 + (tr.last[1].cy - b.cy) ** 2) ** 0.5
                    if d < 0.5 * max(b.w, b.h, tr.last[1].w, tr.last[1].h):
                        score = iou_threshold * (1 - d)
                    else:
                        continue
                pairs.append((score, ti, bi))
        pairs.sort(reverse=True)
        used_t, used_b = set(), set()
        for _score, ti, bi in pairs:
            if ti in used_t or bi in used_b:
                continue
            used_t.add(ti)
            used_b.add(bi)
            alive[ti].points.append((t_ms, boxes[bi]))
        for bi, b in enumerate(boxes):
            if bi not in used_b:
                tracks.append(Track(id=next_id, points=[(t_ms, b)]))
                next_id += 1
    return tracks


def smooth(points: list[tuple[int, Box]], alpha: float = 0.5) -> list[tuple[int, Box]]:
    """Exponential smoothing of box geometry (reduces detector jitter)."""
    out: list[tuple[int, Box]] = []
    for t, b in points:
        if not out:
            out.append((t, b))
            continue
        p = out[-1][1]
        out.append(
            (
                t,
                Box(
                    x=p.x + alpha * (b.x - p.x),
                    y=p.y + alpha * (b.y - p.y),
                    w=p.w + alpha * (b.w - p.w),
                    h=p.h + alpha * (b.h - p.h),
                    score=b.score,
                    extra=b.extra,
                ),
            )
        )
    return out


def clamp_box(b: Box, pad: float = 0.0) -> Box:
    """Pads a box by a fraction of its size and keeps it inside the frame."""
    x = max(0.0, b.x - b.w * pad)
    y = max(0.0, b.y - b.h * pad)
    x2 = min(1.0, b.x + b.w * (1 + pad))
    y2 = min(1.0, b.y + b.h * (1 + pad))
    return Box(x=x, y=y, w=max(1e-4, x2 - x), h=max(1e-4, y2 - y), score=b.score, extra=b.extra)


def assign_speakers(
    tracks: list[Track], turns: list[tuple[str, int, int]], min_overlap_ms: int = 500
) -> dict[int, str]:
    """Maps diarized speakers to face tracks: for each speaker, the track whose
    mouth moves the most (relative to its own baseline) while that speaker talks.
    Returns {track_id: speaker}. Each speaker gets at most one track and vice versa."""
    scores: list[tuple[float, int, str]] = []
    for tr in tracks:
        acts = [(t, b.extra.get("mouth", 0.0)) for t, b in tr.points]
        if not acts:
            continue
        baseline = sum(a for _, a in acts) / len(acts)
        for spk in {s for s, _, _ in turns}:
            speaking = [a for t, a in acts if any(s == spk and st <= t < en for s, st, en in turns)]
            silent = [a for t, a in acts if not any(st <= t < en for _s, st, en in turns if _s == spk)]
            if len(speaking) * 200 < min_overlap_ms:
                continue
            ms = sum(speaking) / len(speaking)
            mq = sum(silent) / len(silent) if silent else baseline
            scores.append((ms - mq, tr.id, spk))
    scores.sort(reverse=True)
    out: dict[int, str] = {}
    used: set[str] = set()
    for score, tid, spk in scores:
        if score <= 0 or tid in out or spk in used:
            continue
        out[tid] = spk
        used.add(spk)
    return out


def rdp_keyframes(points: list[tuple[int, Box]], epsilon: float = 0.004) -> list[tuple[int, Box]]:
    """Ramer–Douglas–Peucker on box centers/sizes over time: fewer keyframes, same motion."""
    if len(points) <= 2:
        return points

    def err(i: int, a: int, b: int) -> float:
        ta, ba = points[a]
        tb, bb = points[b]
        t, bx = points[i]
        u = (t - ta) / (tb - ta) if tb != ta else 0.0
        return max(
            abs(bx.x - (ba.x + (bb.x - ba.x) * u)),
            abs(bx.y - (ba.y + (bb.y - ba.y) * u)),
            abs(bx.w - (ba.w + (bb.w - ba.w) * u)),
            abs(bx.h - (ba.h + (bb.h - ba.h) * u)),
        )

    keep = {0, len(points) - 1}
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        i, e = max(((i, err(i, a, b)) for i in range(a + 1, b)), key=lambda x: x[1])
        if e > epsilon:
            keep.add(i)
            stack += [(a, i), (i, b)]
    return [points[i] for i in sorted(keep)]
