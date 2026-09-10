"""Расстояния и проекция на маршрут; исходный GPS остаётся основой проверки прибытия."""

from itertools import pairwise
from math import cos, radians
from types import SimpleNamespace

from app.services.driver_location import distance_meters


def distance(a, b):
    return distance_meters(
        SimpleNamespace(**{k: a[k] for k in ("latitude", "longitude")}),
        SimpleNamespace(**{k: b[k] for k in ("latitude", "longitude")}),
    )


def point(pair):
    return {"longitude": pair[0], "latitude": pair[1]}


def project(fix, route):
    geometry = route["coordinates"]
    scale = max(0.001, cos(radians(fix["latitude"])))
    lengths = [distance(point(a), point(b)) for a, b in pairwise(geometry)]
    best, before, total = None, 0, sum(lengths)
    for i, (a, b) in enumerate(pairwise(geometry)):
        # Wrap longitude deltas to handle the antimeridian.
        dx = ((b[0] - a[0] + 180) % 360 - 180) * scale
        dy = b[1] - a[1]
        x = ((fix["longitude"] - a[0] + 180) % 360 - 180) * scale
        y = fix["latitude"] - a[1]
        t = max(0, min(1, (x * dx + y * dy) / (dx * dx + dy * dy))) if dx or dy else 0
        snapped = {
            "longitude": (a[0] + dx / scale * t + 180) % 360 - 180,
            "latitude": a[1] + dy * t,
        }
        gap = distance(fix, snapped)
        if best is None or gap < best["off_route"]:
            fraction = (before + lengths[i] * t) / total if total else 1
            best = {
                "snapped": snapped,
                "off_route": gap,
                "progress": fraction,
                "remaining": route["distance"] * (1 - fraction),
                "eta": route["duration"] * (1 - fraction),
            }
        before += lengths[i]
    return best


def along(route, meters):
    geometry = route["coordinates"]
    total = sum(distance(point(a), point(b)) for a, b in pairwise(geometry))
    left = max(0, meters) * total / max(1, route["distance"])
    for a, b in pairwise(geometry):
        length = distance(point(a), point(b))
        if left <= length:
            t = left / length if length else 1
            return {
                "latitude": a[1] + (b[1] - a[1]) * t,
                "longitude": (a[0] + ((b[0] - a[0] + 180) % 360 - 180) * t + 180) % 360 - 180,
            }
        left -= length
    return point(geometry[-1])
