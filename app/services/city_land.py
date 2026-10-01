"""The plots of the team districts (docs/CITY_ESTATES.md), the same as the client's.

The land of each city is cut into plots like the properties of a Monopoly board: three districts,
each of blocks (between two ring roads and two avenues, or between streets), each block a grid of
columns × rows with some plots not for sale (the district's centre, a group quarter, the station).
The file app/data/city_land.json is written from the client's grid
(frontend/src/city3d/world/land.ts) by frontend/scripts/city-land.mjs, and a client test fails
while it is stale. A plot's address is (district, block, column, row); a building on plots keeps
them as (module = block, u = column, v = row), module 0 being the district's public square of
12 × 12 cells.

Bands count outwards from the centre: land nearer the centre costs more, and a district's next band
opens once OPEN_SHARE of its plots in the bands before it are taken.
"""

import json
from functools import cache
from pathlib import Path

LAND_FILE = Path(__file__).resolve().parent.parent / "data" / "city_land.json"
#: The next band opens when this share of the plots of the bands before it is taken.
OPEN_SHARE = 0.7


@cache
def _land():
    data = json.loads(LAND_FILE.read_text(encoding="utf-8"))
    out = {}
    for city, land in data["cities"].items():
        for number, blocks in land["districts"].items():
            out[(city, int(number))] = {
                b["block"]: {
                    "band": b["band"],
                    "cols": b["cols"],
                    "rows": b["rows"],
                    "skip": frozenset(tuple(s) for s in b["skip"]),
                }
                for b in blocks
            }
    bands = {city: land["bands"] for city, land in data["cities"].items()}
    return out, bands


def split(district_id):
    """("support", 1) for "support-team-1"."""
    city, number = district_id.rsplit("-team-", 1)
    return city, int(number)


def blocks(district_id):
    """The district's blocks by number: band, columns, rows, plots not for sale; {} without land."""
    return _land()[0].get(split(district_id), {})


def has_land(district_id):
    return bool(blocks(district_id))


def bands(city):
    return _land()[1].get(city, 0)


def plot_count(district_id):
    return sum(b["cols"] * b["rows"] - len(b["skip"]) for b in blocks(district_id).values())


def band_totals(district_id):
    """Plots for sale in each band of the district, the first band first."""
    city, _number = split(district_id)
    totals = [0] * bands(city)
    for b in blocks(district_id).values():
        totals[b["band"] - 1] += b["cols"] * b["rows"] - len(b["skip"])
    return totals


def area(district_id, block, col, row, cols=1, rows=1):
    """The plots of a cols × rows area of one block; None if one is off it or not for sale."""
    b = blocks(district_id).get(block)
    if b is None or col < 0 or row < 0 or col + cols > b["cols"] or row + rows > b["rows"]:
        return None
    plots = [(col + i, row + j) for i in range(cols) for j in range(rows)]
    return None if any(p in b["skip"] for p in plots) else plots


def band_of(district_id, block):
    b = blocks(district_id).get(block)
    return b["band"] if b else None


def open_band(totals, taken, current=1):
    """The outermost band for sale: it never closes again, the next opens as inner ones fill."""
    band = max(1, current)
    while band < len(totals):
        inner, held = sum(totals[:band]), sum(taken[:band])
        if inner and held < OPEN_SHARE * inner:
            break
        band += 1
    return band
