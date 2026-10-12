"""The cells of the team districts (docs/CITY_ESTATES.md), the same as the client's.

The land of each city goes to three districts, each of blocks (a band of a district on the round
island city, a rectangle round the lake on the other), each block a grid of columns × rows of small
cells with some not for sale (the district's centre, the station). A building stands on a square
of PLOT_CELLS × PLOT_CELLS cells, a road, a tree or a lamp on one. The file
app/data/city_land.json is written from the client's grid (frontend/src/city3d/world/land.ts) by
frontend/scripts/city-land.mjs, and a client test fails while it is stale. A cell's address is
(district, block, column, row); what stands on the land keeps it as (module = block, u = column,
v = row), module 0 being the district's old public square of 12 × 12 cells.

Bands count outwards from the centre and determine land prices. All personal land is available
from the start; building still requires assignment to the district and its construction flag.
"""

import json
from functools import cache
from pathlib import Path

LAND_FILE = Path(__file__).resolve().parent.parent / "data" / "city_land.json"
#: A building's plot is this many cells each way (frontend world/land.ts CELLS).
PLOT_CELLS = 3
#: The administrators' test city keeps copies of the districts under ids with this prefix
#: (app/services/city_sandbox.py); they have the same land.
SANDBOX = "test-"


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
                    # Runs of cells not for sale, row by row: [first column, last column, row].
                    "skip": frozenset(
                        (col, row)
                        for first, last, row in b["skip"]
                        for col in range(first, last + 1)
                    ),
                }
                for b in blocks
            }
    bands = {city: land["bands"] for city, land in data["cities"].items()}
    return out, bands


def split(district_id):
    """("support", 1) for "support-team-1" (and for its test copy "test-support-team-1")."""
    city, number = district_id.removeprefix(SANDBOX).rsplit("-team-", 1)
    return city, int(number)


def blocks(district_id):
    """The district's blocks by number: band, columns, rows, cells not for sale; {} without land."""
    return _land()[0].get(split(district_id), {})


def has_land(district_id):
    return bool(blocks(district_id))


def bands(city):
    return _land()[1].get(city, 0)


def plot_count(district_id):
    return sum(b["cols"] * b["rows"] - len(b["skip"]) for b in blocks(district_id).values())


def band_totals(district_id):
    """Cells for sale in each band of the district, the first band first."""
    city, _number = split(district_id)
    totals = [0] * bands(city)
    for b in blocks(district_id).values():
        totals[b["band"] - 1] += b["cols"] * b["rows"] - len(b["skip"])
    return totals


def area(district_id, block, col, row, cols=1, rows=1):
    """The cells of a cols × rows area of one block; None if one is off it or not for sale."""
    b = blocks(district_id).get(block)
    if b is None or col < 0 or row < 0 or col + cols > b["cols"] or row + rows > b["rows"]:
        return None
    plots = [(col + i, row + j) for i in range(cols) for j in range(rows)]
    return None if any(p in b["skip"] for p in plots) else plots


def band_of(district_id, block):
    b = blocks(district_id).get(block)
    return b["band"] if b else None


def open_band(district_id):
    """The entire district is available, independent of old state or the number of taken plots."""
    return max((b["band"] for b in blocks(district_id).values()), default=1)
