"""All personal land is available immediately without changing progress or paid records."""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import select

from alembic.migration import MigrationContext
from alembic.operations import Operations
from app.models.city_estate import CityDistrictState, CityEvent
from app.models.enums import Role
from app.services import city_land, city_landmark
from tests.conftest import auth, login, make_user
from tests.test_city_estate import (
    ADMIN,
    buy,
    district_view,
    fund,
    legacy_square,
    open_world,
)

pytestmark = pytest.mark.asyncio


@pytest.mark.parametrize("city,block,bands,price", [("support", 16, 5, 130), ("sales", 6, 3, 150)])
@pytest.mark.parametrize("historical", [False, True])
async def test_empty_district_accepts_outermost_plot_despite_absent_or_stale_state(
    client, session, head, supervisor, operator, city, block, bands, price, historical
):
    admin = await make_user(session, login="all-land-admin", role=Role.ADMIN)
    district_id = f"{city}-team-1"
    await open_world(
        client,
        admin,
        head,
        **{city: [operator.group_id]},
        construction=(district_id,),
    )
    await fund(session, operator.id, 2000)
    assert await session.get(CityDistrictState, district_id) is None
    if historical:
        session.add(
            CityDistrictState(
                district_id=district_id, open_band=1, hq_level=3, built_projects=4
            )
        )
        await session.commit()
    me = auth(await login(client, operator.login))
    before = await district_view(client, me, city, district_id)
    assert before["land"]["taken"] == 0 and before["land"]["open_band"] == bands
    assert before["landmark"]["level"] == 1
    result = await buy(client, me, "house", block, 0, 0)
    assert result.status_code == 200, result.text
    assert (result.json()["price"], result.json()["balance"]) == (price, 2000 - price)
    state = await session.get(CityDistrictState, district_id, populate_existing=True)
    assert state.open_band == bands and state.landmark_peak_plots == 1
    assert (state.hq_level, state.built_projects) == ((3, 4) if historical else (1, 0))
    after = await district_view(client, me, city, district_id)
    assert after["land"]["taken"] == 1 and after["land"]["open_band"] == bands
    events = await session.scalars(select(CityEvent).where(CityEvent.kind == "band"))
    assert list(events) == []


async def test_report_uses_main_building_peak_even_when_legacy_headquarters_has_other_stage(
    client, session, head, supervisor, operator
):
    admin = await make_user(session, login="main-building-report-admin", role=Role.ADMIN)
    await open_world(client, admin, head, support=[operator.group_id])
    await legacy_square(session)
    peak = city_landmark.needed(city_land.plot_count("support-team-1"), 2)
    session.add(
        CityDistrictState(
            district_id="support-team-1",
            open_band=1,
            hq_level=4,
            built_projects=7,
            landmark_peak_plots=peak,
        )
    )
    await session.commit()
    staff = auth(await login(client, admin.login))
    response = await client.get(ADMIN + "/estates", headers=staff)
    assert response.status_code == 200, response.text
    district = next(d for d in response.json()["districts"] if d["id"] == "support-team-1")
    assert (district["landmark_level"], district["hq_level"], district["built_projects"]) == (
        2, 4, 7
    )
    assert district["land"]["taken"] == 0 and district["land"]["open_band"] == 5


async def test_all_land_rollout_preserves_buildings_inventory_projects_coins_and_peaks(
    tmp_path, monkeypatch
):
    path = Path(__file__).resolve().parent.parent / "alembic/versions/20261002_all_district_land.py"
    spec = importlib.util.spec_from_file_location("all_district_land", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    database = sa.create_engine(f"sqlite:///{tmp_path / 'all-land-migration.sqlite3'}")
    with database.begin() as connection:
        connection.exec_driver_sql("""
            CREATE TABLE city_districts (
                district_id TEXT PRIMARY KEY, hq_level INTEGER NOT NULL,
                built_projects INTEGER NOT NULL, open_band INTEGER NOT NULL,
                landmark_peak_plots INTEGER NOT NULL
            )
        """)
        connection.exec_driver_sql("""
            INSERT INTO city_districts VALUES
                ('support-team-1',3,4,1,112), ('sales-team-2',4,5,1,50),
                ('test-support-team-3',2,1,2,30), ('test-sales-team-1',5,7,2,100),
                ('custom-team-8',2,2,2,40)
        """)
        # Use representative complete records, including placement coordinates and payments.
        connection.exec_driver_sql("""
            CREATE TABLE city_objects (
                id INTEGER PRIMARY KEY, district_id TEXT, state TEXT, module INTEGER,
                u INTEGER, v INTEGER, paid INTEGER, version INTEGER
            )
        """)
        connection.exec_driver_sql("""
            INSERT INTO city_objects VALUES
                (1,'support-team-1','placed',3,2,1,180,3),
                (2,'support-team-1','stored',NULL,NULL,NULL,960,4),
                (3,'sales-team-2','placed',0,4,4,300,2)
        """)
        untouched = (
            "coin_accounts",
            "coin_transactions",
            "city_cells",
            "city_projects",
            "city_contributions",
            "city_operations",
        )
        for table in untouched:
            connection.exec_driver_sql(
                f"CREATE TABLE {table} (id INTEGER PRIMARY KEY, payload TEXT)"
            )
            connection.execute(
                sa.text(f"INSERT INTO {table} VALUES (1, :payload)"), {"payload": table}
            )
        unchanged_tables = ("city_objects", *untouched)
        before = {
            table: list(connection.execute(sa.text(f"SELECT * FROM {table}")))
            for table in unchanged_tables
        }
        monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(connection)))
        migration.upgrade()
        expected = [
            ("custom-team-8", 2, 2, 2, 40),
            ("sales-team-2", 4, 5, 3, 50),
            ("support-team-1", 3, 4, 5, 112),
            ("test-sales-team-1", 5, 7, 3, 100),
            ("test-support-team-3", 2, 1, 5, 30),
        ]
        assert list(
            connection.execute(sa.text("SELECT * FROM city_districts ORDER BY district_id"))
        ) == expected
        migration.upgrade()
        migration.downgrade()
        assert list(
            connection.execute(sa.text("SELECT * FROM city_districts ORDER BY district_id"))
        ) == expected
        assert {
            table: list(connection.execute(sa.text(f"SELECT * FROM {table}")))
            for table in unchanged_tables
        } == before
    database.dispose()
