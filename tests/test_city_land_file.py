"""The map's own land (app/data/city_land.json), which the other tests swap for the ring land.

The client writes the file from its grid (frontend/scripts/city-land.mjs) and checks it is up to
date; here the server reads it: three districts of each city with land in every band, the island
city's in square cells on one lattice, whose blocks are rectangles round each band's cells.
"""

from pathlib import Path

import pytest

from app.services import city_land

REAL_LAND = Path(city_land.__file__).resolve().parent.parent / "data" / "city_land.json"


@pytest.fixture(autouse=True)
def real_land(ring_land, monkeypatch):
    monkeypatch.setattr(city_land, "LAND_FILE", REAL_LAND)
    city_land._land.cache_clear()
    yield
    city_land._land.cache_clear()


def first_house(district_id, block):
    """The first 3 × 3 cells for sale of a block, row by row, or None."""
    b = city_land.blocks(district_id)[block]
    for row in range(b["rows"] - 2):
        for col in range(b["cols"] - 2):
            if city_land.area(district_id, block, col, row, 3, 3):
                return col, row
    return None


@pytest.mark.parametrize("city", ["support", "sales"])
def test_every_district_has_land_in_every_band_and_room_for_a_house(city):
    bands = city_land.bands(city)
    assert bands == (5 if city == "support" else 3)
    counts = []
    for number in (1, 2, 3):
        district_id = f"{city}-team-{number}"
        totals = city_land.band_totals(district_id)
        assert len(totals) == bands and all(totals), f"{district_id}: {totals}"
        assert sum(totals) == city_land.plot_count(district_id)
        assert city_land.open_band(district_id) == bands
        counts.append(sum(totals))
        for block, b in city_land.blocks(district_id).items():
            assert city_land.band_of(district_id, block) == b["band"]
            assert first_house(district_id, block), f"{district_id}: no house fits block {block}"
    # Three districts of about the same size.
    assert max(counts) < min(counts) * 1.15, counts
    # The test city's copies have the same land.
    assert city_land.plot_count(f"test-{city}-team-1") == counts[0]


def test_the_island_city_is_cut_into_square_cells_round_each_bands_land():
    for number in (1, 2, 3):
        district_id = f"support-team-{number}"
        blocks = city_land.blocks(district_id)
        assert sorted(blocks) == [1, 2, 3, 4, 5]
        assert [blocks[k]["band"] for k in sorted(blocks)] == [1, 2, 3, 4, 5]
        cells = city_land.plot_count(district_id)
        assert 9000 < cells < 12000, cells
        for block, b in blocks.items():
            # A rectangle round its band's piece of a ring: its corners are not for sale.
            corners = [
                (0, 0),
                (b["cols"] - 1, 0),
                (0, b["rows"] - 1),
                (b["cols"] - 1, b["rows"] - 1),
            ]
            assert any(c in b["skip"] for c in corners), f"{district_id}: block {block}"
            assert city_land.area(district_id, block, -1, 0) is None
            assert city_land.area(district_id, block, b["cols"], 0) is None
