"""Automatic full-square complexes, with durable progress and preserved legacy projects."""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import func, select

from alembic.migration import MigrationContext
from alembic.operations import Operations
from app.models.city_estate import CityCell, CityDistrictState, CityEvent, CityProject
from app.models.coin import CoinTransaction
from app.models.enums import Role
from app.services import city_land, city_landmark
from tests.conftest import auth, login, make_user
from tests.test_city_estate import (
    CITY,
    buy,
    district_view,
    estate,
    fund,
    key,
    legacy_square,
    open_world,
)
from tests.test_city_sandbox import SANDBOX, district, project, sandbox

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def landmark_team(client, session, head, supervisor, operator):
    admin = await make_user(session, login="landmark-admin", role=Role.ADMIN)
    await open_world(client, admin, head, support=[operator.group_id])
    await fund(session, operator.id, 5000)
    return admin, supervisor, operator


@pytest.mark.parametrize(
    "plots,thresholds", [(101, [0, 11, 26, 51, 76]), (178, [0, 18, 45, 89, 134])]
)
async def test_complex_levels_use_rounded_thresholds_of_all_land(plots, thresholds):
    for level, need in enumerate(thresholds, 1):
        assert city_landmark.needed(plots, level) == need
        assert city_landmark.level_for(plots, need) == level
        if level > 1:
            assert city_landmark.level_for(plots, need - 1) == level - 1
    progress = city_landmark.view(plots, 0, thresholds[2])
    assert progress["level"] == 3 and progress["taken"] == 0
    assert progress["next"]["remaining"] == thresholds[3]
    assert progress["next"]["percent"] == 50
    assert city_landmark.view(plots, thresholds[-1])["next"] is None
    assert city_landmark.view(0, 0) is None


async def test_fresh_complex_reserves_the_whole_square_in_real_and_test_cities(
    client, session, landmark_team
):
    admin, supervisor, operator = landmark_team
    me = auth(await login(client, operator.login))
    sv = auth(await login(client, supervisor.login))
    staff = auth(await login(client, admin.login))
    view = await district_view(client, me)
    landmark = view["landmark"]
    assert landmark["status"] == "active" and landmark["level"] == 1
    assert {k: landmark[k] for k in ("module", "u", "v", "w", "h", "rotation")} == {
        "module": 0,
        "u": 0,
        "v": 0,
        "w": 12,
        "h": 12,
        "rotation": 0,
    }
    assert landmark["plots"] == city_land.plot_count("support-team-1")
    assert landmark["next"]["need"] == 112 and landmark["peak"] == 0
    denied = await client.post(
        f"{CITY}/projects",
        headers=sv,
        json={
            "key": key(),
            "district_id": "support-team-1",
            "family": "fountain",
            "module": 0,
            "u": 0,
            "v": 0,
            "economy_revision": 0,
        },
    )
    assert denied.status_code == 409 and denied.json()["code"] == "district_landmark"
    test_denied = await project(client, staff, "square", u=11, v=11)
    assert test_denied.status_code == 409 and test_denied.json()["code"] == "district_landmark"
    assert (await sandbox(client, staff))["landmark"]["status"] == "active"
    assert await session.scalar(select(func.count()).select_from(CityCell)) == 0
    assert await session.scalar(select(func.count()).select_from(CityProject)) == 0
    # The only journal entry is the fixture's credit; neither complex nor rejected project pays.
    assert list(await session.scalars(select(CoinTransaction.amount))) == [5000]


async def test_legacy_building_stays_and_its_upgrade_can_still_be_funded(
    client, session, landmark_team
):
    _admin, supervisor, operator = landmark_team
    old = await legacy_square(session, family="gazebo")
    me = auth(await login(client, operator.login))
    sv = auth(await login(client, supervisor.login))
    assert (await district_view(client, me))["landmark"]["status"] == "legacy_occupied"
    opened = await client.post(
        f"{CITY}/projects",
        headers=sv,
        json={
            "key": key(),
            "district_id": "support-team-1",
            "family": "gazebo",
            "target_id": old.id,
            "economy_revision": 0,
        },
    )
    assert opened.status_code == 200, opened.text
    upgrade = opened.json()["project"]
    funded = await client.post(
        f"{CITY}/projects/{upgrade['id']}/contributions",
        headers=me,
        json={"key": key(), "amount": upgrade["cost"]},
    )
    assert funded.status_code == 200 and funded.json()["completed"]
    view = await district_view(client, me)
    assert view["landmark"]["status"] == "legacy_occupied"
    assert [(o["id"], o["family"], o["level"], o["u"], o["v"]) for o in view["objects"]] == [
        (old.id, "gazebo", 2, 11, 11)
    ]
    assert view["projects"] == [] and view["hq"]["level"] == 2
    assert await session.scalar(select(func.count()).select_from(CityCell)) == 1


async def test_cancelling_the_last_legacy_project_refunds_it_and_activates_complex(
    client, session, landmark_team
):
    _admin, supervisor, operator = landmark_team
    old = CityProject(
        district_id="support-team-1",
        family="fountain",
        level=1,
        module=0,
        u=5,
        v=5,
        rotation=0,
        size="main",
        cost=300,
        funded=0,
        status="open",
        created_by_id=supervisor.id,
    )
    session.add(old)
    await session.flush()
    session.add_all(
        [
            CityCell(district_id=old.district_id, module=0, u=u, v=v, project_id=old.id)
            for u in (5, 6)
            for v in (5, 6)
        ]
    )
    await session.commit()
    me = auth(await login(client, operator.login))
    sv = auth(await login(client, supervisor.login))
    payment_key = key()
    funded = await client.post(
        f"{CITY}/projects/{old.id}/contributions",
        headers=me,
        json={"key": payment_key, "amount": 50},
    )
    assert funded.status_code == 200, funded.text
    view = await district_view(client, me)
    assert view["landmark"]["status"] == "legacy_occupied" and len(view["projects"]) == 1
    cancelled = await client.post(
        f"{CITY}/projects/{old.id}/cancel",
        headers=sv,
        json={"key": key()},
    )
    assert cancelled.status_code == 200 and cancelled.json()["refunded"] == 50
    view = await district_view(client, me)
    assert view["landmark"]["status"] == "active" and view["projects"] == []
    assert (await estate(client, me))["available"] == 5000
    assert sorted(await session.scalars(select(CoinTransaction.amount))) == [-50, 50, 5000]
    # Previous idempotent operation results and financial history remain readable.
    status = await client.get(f"{CITY}/operations/{payment_key}", headers=me)
    assert status.json()["status"] == "done" and status.json()["result"]["accepted"] == 50


async def test_filled_plot_cells_grow_complex_once_and_transfers_preserve_its_peak(
    client, session, landmark_team, head
):
    admin, _supervisor, operator = landmark_team
    await open_world(client, admin, head, sales=[operator.group_id], construction=("sales-team-1",))
    me = auth(await login(client, operator.login))
    totals = city_land.band_totals("sales-team-1")
    need = city_landmark.needed(sum(totals), 2)
    first = [
        (block, u, v)
        for block, shape in city_land.blocks("sales-team-1").items()
        if shape["band"] == 1
        for v in range(shape["rows"])
        for u in range(shape["cols"])
        if (u, v) not in shape["skip"]
    ]
    assert need == 18 and len(first) >= need
    for block, u, v in first[: need - 1]:
        result = await buy(client, me, "square", block, u, v)
        assert result.status_code == 200, result.text
    view = await district_view(client, me, "sales", "sales-team-1")
    assert view["landmark"]["level"] == 1 and view["landmark"]["next"]["remaining"] == 1
    op = key()
    result = await buy(client, me, "square", *first[need - 1], op=op)
    assert result.status_code == 200, result.text
    assert (await buy(client, me, "square", *first[need - 1], op=op)).json()["replayed"]
    view = await district_view(client, me, "sales", "sales-team-1")
    assert view["landmark"]["level"] == 2 and view["landmark"]["taken"] == need
    assert len(view["objects"]) < need  # Several squares have merged into parks.
    events = list(await session.scalars(select(CityEvent).where(CityEvent.kind == "landmark")))
    assert [event.payload["level"] for event in events] == [2]
    staff = auth(await login(client, admin.login))
    moved = await client.patch(
        f"/api/v1/admin/users/{operator.id}", headers=staff, json={"group_id": None}
    )
    assert moved.status_code == 200, moved.text
    await estate(client, me)
    after = (await district_view(client, me, "sales", "sales-team-1"))["landmark"]
    assert (after["taken"], after["peak"], after["level"]) == (0, need, 2)
    assert after["next"]["remaining"] == city_landmark.needed(sum(totals), 3)
    assert (
        len(list(await session.scalars(select(CityEvent).where(CityEvent.kind == "landmark")))) == 1
    )


async def test_test_city_manual_complex_levels_reset_without_affecting_real_progress(
    client, session, landmark_team
):
    admin, _supervisor, operator = landmark_team
    staff = auth(await login(client, admin.login))
    me = auth(await login(client, operator.login))
    for level in (2, 5, 3, 1):
        changed = await district(client, staff, landmark_level=level)
        assert changed.status_code == 200 and changed.json()["landmark_level"] == level
        assert (await sandbox(client, staff))["landmark"]["level"] == level
    await district(client, staff, landmark_level=5)
    assert (await district_view(client, me))["landmark"]["level"] == 1
    reset = await client.post(f"{SANDBOX}/cities/support/reset", headers=staff)
    assert reset.status_code == 200
    progress = (await sandbox(client, staff))["landmark"]
    assert progress["level"] == 1 and progress["peak"] == 0
    state = await session.get(CityDistrictState, "test-support-team-1", populate_existing=True)
    assert state.landmark_peak_plots == 0
    assert (await district(client, staff, landmark_level=6)).status_code == 422


async def test_landmark_migration_backfills_existing_land_without_changing_financial_data(
    monkeypatch,
):
    path = Path(__file__).parents[1] / "alembic/versions/20261002_district_landmark.py"
    spec = importlib.util.spec_from_file_location("landmark_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    assert migration.down_revision == "20261001_city_land"
    database = sa.create_engine("sqlite://")
    with database.begin() as connection:
        connection.exec_driver_sql("""
            CREATE TABLE city_districts (
                district_id TEXT PRIMARY KEY, hq_level INTEGER NOT NULL,
                built_projects INTEGER NOT NULL, open_band INTEGER NOT NULL
            )
        """)
        connection.exec_driver_sql("""
            CREATE TABLE city_cells (
                district_id TEXT, module INTEGER, u INTEGER, v INTEGER,
                object_id INTEGER, project_id INTEGER
            )
        """)
        connection.exec_driver_sql("INSERT INTO city_districts VALUES ('support-team-1',3,4,2)")
        connection.exec_driver_sql("""
            INSERT INTO city_cells VALUES
                ('support-team-1',1,0,0,1,NULL), ('support-team-1',1,1,0,1,NULL),
                ('support-team-1',0,5,5,NULL,7), ('sales-team-2',2,0,0,2,NULL)
        """)
        untouched = (
            "city_objects",
            "city_projects",
            "coin_transactions",
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
        cells_before = list(connection.execute(sa.text("SELECT * FROM city_cells")))
        records_before = {
            table: list(connection.execute(sa.text(f"SELECT * FROM {table}")))
            for table in untouched
        }
        monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(connection)))
        migration.upgrade()
        rows = list(
            connection.execute(sa.text("SELECT * FROM city_districts ORDER BY district_id"))
        )
        assert rows == [("sales-team-2", 1, 0, 1, 1), ("support-team-1", 3, 4, 2, 2)]
        assert list(connection.execute(sa.text("SELECT * FROM city_cells"))) == cells_before
        assert {
            table: list(connection.execute(sa.text(f"SELECT * FROM {table}")))
            for table in untouched
        } == records_before
        # A repeat cannot lower a peak captured by later use of the application.
        connection.exec_driver_sql(
            "UPDATE city_districts SET landmark_peak_plots=20 WHERE district_id='support-team-1'"
        )
        migration.backfill_peaks(connection)
        assert (
            connection.scalar(
                sa.text(
                    "SELECT landmark_peak_plots FROM city_districts "
                    "WHERE district_id='support-team-1'"
                )
            )
            == 20
        )
    database.dispose()
