"""The cells of the team districts (docs/CITY_ESTATES.md), the same as the client's.

The land of each city goes to three districts, each of blocks (a band of a district on the round
island city, a rectangle round the lake on the other), each block a grid of columns × rows of small
cells with some not for sale (the district's centre, the station). A building stands on cells of
its size (a house 3 × 3, a square or an office tower 2 × 2), a road, a tree or a lamp on one. The
columns and rows run in threes (PLOT_CELLS), so the old plot lines pass between cells. The file
app/data/city_land.json is written from the client's grid (frontend/src/city3d/world/land.ts) by
frontend/scripts/city-land.mjs, and a client test fails while it is stale. A cell's address is
(district, block, column, row); what stands on the land keeps it as (module = block, u = column,
v = row), module 0 being the district's old public square of 12 × 12 cells.

Bands count outwards from the centre and determine land prices. All personal land is available
from the start; building still requires assignment to the district and its construction flag.
"""

import json
import re
from functools import cache
from pathlib import Path

LAND_FILE = Path(__file__).resolve().parent.parent / "data" / "city_land.json"
#: The old plots were this many cells each way: blocks run in threes of them (frontend world/land.ts
#: CELLS).
PLOT_CELLS = 3
#: The administrators' test city keeps copies of the districts under ids with this prefix
#: (app/services/city_sandbox.py); they have the same land.
SANDBOX = "test-"
#: A city may be cut into this many districts; three is its first layout, whose ids carry no count
#: ("support-team-2"). Another layout's ids name their count: "support-5-team-2".
COUNTS = (2, 3, 4, 5)
DEFAULT = 3
ID = re.compile(r"^(?:test-)?(support|sales)(?:-([2-5]))?-team-([1-9])$")


def district_id(city, count, number):
    """The id of district `number` of `city` cut into `count` districts."""
    return f"{city}-team-{number}" if count == DEFAULT else f"{city}-{count}-team-{number}"


def parse(district_id):
    """(city, count, number) of a district id: ("support", 5, 2) for "support-5-team-2"."""
    match = ID.match(district_id)
    if not match:
        raise ValueError(f"Unknown district {district_id!r}")
    city, count, number = match.groups()
    return city, int(count) if count else DEFAULT, int(number)


def layout(district_id):
    """How many districts the district's city is cut into in its layout."""
    return parse(district_id)[1]


@cache
def _land():
    data = json.loads(LAND_FILE.read_text(encoding="utf-8"))
    out = {}
    layouts = [
        (city, count, districts)
        for city, land in data["cities"].items()
        for count, districts in [
            (DEFAULT, land["districts"]),
            *((int(n), d) for n, d in land.get("layouts", {}).items()),
        ]
    ]
    for city, count, districts in layouts:
        for number, blocks in districts.items():
            out[(city, count, int(number))] = {
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
    city, _count, number = parse(district_id)
    return city, number


def blocks(district_id):
    """The district's blocks by number: band, columns, rows, cells not for sale; {} without land."""
    try:
        key = parse(district_id)
    except ValueError:
        return {}
    return _land()[0].get(key, {})


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
