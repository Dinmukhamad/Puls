"""City ownership, live supervisor teams, and transactional district transfers."""

from copy import deepcopy
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.models.city import CityWorld
from app.models.city_estate import CityCell, CityEvent, CityObject
from app.models.coin import CoinTransaction
from app.models.enums import Role, TxType
from app.models.settings import AuditLog
from app.models.user import CoinAccount, Group
from app.services import city_world
from app.services.coins import post_transaction
from tests.conftest import auth, login, make_group, make_user
from tests.test_city_estate import legacy_square

pytestmark = pytest.mark.asyncio
CITY = "/api/v1/learning/city"
EDITOR = "/api/v1/admin/learning/city/world"


@pytest.fixture
async def assignment_admin(session):
    return await make_user(session, login="assignment-admin", role=Role.ADMIN)


async def headers(client, user):
    return auth(await login(client, user.login))


async def editor(client, actor_headers):
    response = await client.get(EDITOR, headers=actor_headers)
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "private, no-store"
    return response.json()


def editable(data):
    body = {"revision": data["revision"], "cities": deepcopy(data["cities"])}
    for city in body["cities"]:
        for item in city["districts"]:
            item.pop("legacy_assignment", None)
    return body


def department(data, city="support"):
    return next(item for item in data["cities"] if item["id"] == city)


def district(data, city="support", number=1):
    return next(
        item for item in department(data, city)["districts"]
        if item["id"] == f"{city}-team-{number}"
    )


async def configure(client, actor_headers, body):
    response = await client.put(EDITOR, headers=actor_headers, json=body)
    assert response.status_code == 200, response.text
    return response.json()


async def seed(client, admin_headers, *, head=None, supervisor=None, sales_head=None):
    body = {"revision": 0, "cities": city_world.defaults()}
    department(body)["head_id"] = head.id if head else None
    department(body, "sales")["head_id"] = sales_head.id if sales_head else None
    if supervisor:
        district(body)["supervisor_id"] = supervisor.id
        district(body)["construction"] = True
    return await configure(client, admin_headers, body)


async def fund(session, user, amount=2000):
    await post_transaction(
        session, user_id=user.id, amount=amount, tx_type=TxType.MANUAL_CREDIT, reason="Тест"
    )
    await session.commit()


async def purchase(client, actor_headers, *, col=0):
    return await client.post(
        CITY + "/plots", headers=actor_headers,
        json={"key": uuid4().hex, "family": "house", "block": 3, "col": col,
              "row": 0, "economy_revision": 0},
    )


async def project(client, actor_headers, *, city="support", u=0):
    return await client.post(
        CITY + "/projects", headers=actor_headers,
        json={"key": uuid4().hex, "district_id": f"{city}-team-1", "family": "square",
              "module": 0, "u": u, "v": 0, "economy_revision": 0},
    )


async def count(session, model, *, action=None):
    query = select(func.count()).select_from(model)
    if action is not None:
        query = query.where(model.action == action)
    return await session.scalar(query)


async def test_editor_lists_active_staff_and_each_heads_full_city_scope(
    client, session, assignment_admin, head, supervisor, operator
):
    other_head = await make_user(session, login="other-city-head", role=Role.HEAD)
    idle_head = await make_user(session, login="unassigned-head", role=Role.HEAD)
    idle_sv = await make_user(session, login="unassigned-sv", role=Role.SUPERVISOR)
    inactive_head = await make_user(session, login="inactive-head", role=Role.HEAD)
    inactive_sv = await make_user(session, login="inactive-sv", role=Role.SUPERVISOR)
    inactive_head.is_active = inactive_sv.is_active = False
    await make_user(session, login="active-teammate", group_id=operator.group_id)
    inactive_operator = await make_user(
        session, login="inactive-teammate", group_id=operator.group_id
    )
    inactive_operator.is_active = False
    await session.commit()
    admin_headers = await headers(client, assignment_admin)
    await seed(client, admin_headers, head=head, supervisor=supervisor, sales_head=other_head)
    data = await editor(client, admin_headers)
    assert data["can_manage_heads"] and data["editable_city_ids"] == ["support", "sales"]
    assert {item["id"] for item in data["heads"]} == {head.id, other_head.id, idle_head.id}
    supervisors = {item["id"]: item for item in data["supervisors"]}
    assert set(supervisors) == {supervisor.id, idle_sv.id}
    assert supervisors[supervisor.id]["group_ids"] == [operator.group_id]
    assert supervisors[supervisor.id]["operator_count"] == 2
    assert supervisors[idle_sv.id]["group_ids"] == []
    assert supervisors[idle_sv.id]["operator_count"] == 0
    for user, scope in ((head, ["support"]), (other_head, ["sales"]), (idle_head, [])):
        view = await editor(client, await headers(client, user))
        assert len(view["cities"]) == 2
        assert view["editable_city_ids"] == scope
        assert view["can_edit"] is bool(scope)
        assert not view["can_manage_heads"]
    sv_view = await editor(client, await headers(client, supervisor))
    assert not sv_view["can_edit"] and sv_view["editable_city_ids"] == []


async def test_head_changes_only_owned_city_and_omitted_owners_are_preserved(
    client, session, assignment_admin, head, supervisor
):
    foreign_head = await make_user(session, login="sales-owner", role=Role.HEAD)
    admin_headers = await headers(client, assignment_admin)
    saved = await seed(client, admin_headers, head=head, sales_head=foreign_head)
    boss = await headers(client, head)
    body = editable(saved)
    sales_before = deepcopy(department(body, "sales"))
    department(body)["name"] = "Служба поддержки"
    district(body)["name"] = "Команда супервайзера"
    district(body)["supervisor_id"] = supervisor.id
    district(body)["construction"] = True
    for city in body["cities"]:
        city.pop("head_id", None)
    changed = await configure(client, boss, body)
    assert department(changed)["head_id"] == head.id
    assert department(changed, "sales") == sales_before
    assert district(changed)["supervisor_id"] == supervisor.id
    assert district(changed)["construction"]
    before_audits = await count(session, AuditLog)
    forbidden = editable(changed)
    department(forbidden, "sales")["name"] = "Чужой город"
    response = await client.put(EDITOR, headers=boss, json=forbidden)
    assert response.status_code == 403
    assert editable(await editor(client, admin_headers)) == editable(changed)
    assert await count(session, AuditLog) == before_audits
    assert await count(session, CoinTransaction) == 0


async def test_admin_can_transfer_and_clear_city_ownership_revoking_previous_head(
    client, session, assignment_admin, head, supervisor
):
    next_head = await make_user(session, login="next-city-head", role=Role.HEAD)
    admin_headers = await headers(client, assignment_admin)
    saved = await seed(client, admin_headers, head=head, supervisor=supervisor)
    body = editable(saved)
    department(body)["head_id"] = next_head.id
    department(body, "sales")["name"] = "Продажи"
    moved = await configure(client, admin_headers, body)
    old_headers = await headers(client, head)
    assert (await editor(client, old_headers))["editable_city_ids"] == []
    denied_body = editable(moved)
    department(denied_body)["name"] = "Старый владелец"
    assert (await client.put(EDITOR, headers=old_headers, json=denied_body)).status_code == 403
    assert (await project(client, old_headers)).status_code == 403
    next_headers = await headers(client, next_head)
    assert (await editor(client, next_headers))["editable_city_ids"] == ["support"]
    cleared_body = editable(moved)
    department(cleared_body)["head_id"] = None
    cleared = await configure(client, admin_headers, cleared_body)
    assert department(cleared)["head_id"] is None
    assert district(cleared)["supervisor_id"] == supervisor.id
    assert (await editor(client, next_headers))["editable_city_ids"] == []
    assert (await project(client, next_headers)).status_code == 403
    assert await count(session, CoinTransaction) == 0


@pytest.mark.parametrize("attempt", ["adopt-unowned", "forge-owned", "clear-owner", "add-foreign"])
async def test_head_cannot_take_unowned_cities_or_change_owner_ids(
    client, session, assignment_admin, head, attempt
):
    admin_headers = await headers(client, assignment_admin)
    saved = await seed(client, admin_headers, head=head)
    body = editable(saved)
    if attempt == "adopt-unowned":
        department(body, "sales")["name"] = "Присвоенный город"
        department(body, "sales")["head_id"] = head.id
    elif attempt == "forge-owned":
        other = await make_user(session, login="forged-owner", role=Role.HEAD)
        department(body)["head_id"] = other.id
    elif attempt == "clear-owner":
        department(body)["head_id"] = None
    else:
        department(body, "sales")["districts"].append(
            {"id": "sales-team-4", "name": "Чужой район", "group_ids": []}
        )
    response = await client.put(EDITOR, headers=await headers(client, head), json=body)
    assert response.status_code == 403, response.text
    assert editable(await editor(client, admin_headers)) == editable(saved)


@pytest.mark.parametrize("kind", ["inactive", "supervisor", "admin", "missing"])
async def test_only_active_head_can_be_appointed_by_admin(
    client, session, assignment_admin, kind
):
    owner_id = 999999
    if kind != "missing":
        role = {"inactive": Role.HEAD, "supervisor": Role.SUPERVISOR, "admin": Role.ADMIN}[kind]
        candidate = await make_user(session, login=f"invalid-owner-{kind}", role=role)
        if kind == "inactive":
            candidate.is_active = False
            await session.commit()
        owner_id = candidate.id
    body = {"revision": 0, "cities": city_world.defaults()}
    department(body)["head_id"] = owner_id
    response = await client.put(EDITOR, headers=await headers(client, assignment_admin), json=body)
    assert response.status_code == 400, response.text
    assert await count(session, CityWorld) == 0
    assert await count(session, AuditLog, action="city.world") == 0


@pytest.mark.parametrize("kind", ["inactive", "head", "admin", "trainer", "operator", "missing"])
async def test_only_active_supervisor_can_be_assigned_to_district(
    client, session, assignment_admin, kind
):
    supervisor_id = 999999
    if kind != "missing":
        role = Role.SUPERVISOR if kind == "inactive" else Role(kind)
        candidate = await make_user(session, login=f"invalid-sv-{kind}", role=role)
        if kind == "inactive":
            candidate.is_active = False
            await session.commit()
        supervisor_id = candidate.id
    body = {"revision": 0, "cities": city_world.defaults()}
    district(body)["supervisor_id"] = supervisor_id
    response = await client.put(EDITOR, headers=await headers(client, assignment_admin), json=body)
    assert response.status_code == 400, response.text
    assert await count(session, CityWorld) == 0
    assert await count(session, CoinTransaction) == 0


async def test_assignment_includes_all_active_groups_and_excludes_stale_foreign_ids(
    client, session, assignment_admin, supervisor, operator
):
    second_group = await make_group(session, code="second-active", supervisor_id=supervisor.id)
    archived = await make_group(session, code="archived", supervisor_id=supervisor.id)
    archived.is_active = False
    foreign_sv = await make_user(session, login="foreign-sv", role=Role.SUPERVISOR)
    foreign_group = await make_group(session, code="foreign", supervisor_id=foreign_sv.id)
    teammate = await make_user(session, login="second-group-op", group_id=second_group.id)
    await session.commit()
    admin_headers = await headers(client, assignment_admin)
    body = {"revision": 0, "cities": city_world.defaults()}
    district(body)["supervisor_id"] = supervisor.id
    district(body)["group_ids"] = [foreign_group.id]
    result = await configure(client, admin_headers, body)
    assert set(district(result)["group_ids"]) == {operator.group_id, second_group.id}
    assert archived.id not in district(result)["group_ids"]
    for user in (operator, teammate):
        view = (await client.get(CITY + "/world", headers=await headers(client, user))).json()
        assert view["home_district"] == "support-team-1"
        assert district(view)["supervisor"] == supervisor.full_name
        assert district(view)["assigned"]
        assert all(secret not in str(view) for secret in ("group_ids", "supervisor_id", "head_id"))
    await session.refresh(operator)
    await session.refresh(teammate)
    assert operator.group_id != teammate.group_id
    assert await count(session, CoinTransaction) == 0


async def test_supervisor_with_no_groups_is_assigned_and_future_group_joins_without_world_save(
    client, session, assignment_admin, head
):
    supervisor = await make_user(session, login="future-sv", role=Role.SUPERVISOR)
    admin_headers = await headers(client, assignment_admin)
    saved = await seed(client, admin_headers, head=head, supervisor=supervisor)
    assert district(saved)["group_ids"] == []
    sv_headers = await headers(client, supervisor)
    world = (await client.get(CITY + "/world", headers=sv_headers)).json()
    assert district(world)["assigned"] and district(world)["supervisor"] == supervisor.full_name
    sv_estate = (await client.get(CITY + "/estate", headers=sv_headers)).json()
    assert "support-team-1" in sv_estate["managed"]
    await legacy_square(session)
    opened = await project(client, sv_headers)
    assert opened.status_code == 200, opened.text
    created = await client.post(
        "/api/v1/admin/groups", headers=admin_headers,
        json={"code": "future-group", "name": "Новая группа", "supervisor_id": supervisor.id},
    )
    assert created.status_code == 201, created.text
    operator = await make_user(session, login="future-operator", group_id=created.json()["id"])
    await fund(session, operator)
    updated = await editor(client, admin_headers)
    assert updated["revision"] == saved["revision"]
    assert district(updated)["group_ids"] == [operator.group_id]
    me = await headers(client, operator)
    estate = (await client.get(CITY + "/estate", headers=me)).json()
    assert estate["district"]["id"] == "support-team-1" and estate["status"] == "ready"
    bought = await purchase(client, me)
    assert bought.status_code == 200, bought.text


@pytest.mark.parametrize("other_city", ["support", "sales"])
async def test_supervisor_cannot_hold_two_districts_even_without_groups(
    client, session, assignment_admin, other_city
):
    supervisor = await make_user(session, login="duplicate-empty-sv", role=Role.SUPERVISOR)
    body = {"revision": 0, "cities": city_world.defaults()}
    district(body)["supervisor_id"] = supervisor.id
    district(body, other_city, 2)["supervisor_id"] = supervisor.id
    response = await client.put(EDITOR, headers=await headers(client, assignment_admin), json=body)
    assert response.status_code == 400, response.text
    assert await count(session, CityWorld) == 0
    assert await count(session, AuditLog, action="city.world") == 0


async def test_reassigning_supervisor_stores_old_buildings_and_releases_plots_without_coins(
    client, session, assignment_admin, head, supervisor, operator
):
    next_sv = await make_user(session, login="replacement-sv", role=Role.SUPERVISOR)
    next_group = await make_group(session, code="replacement", supervisor_id=next_sv.id)
    next_operator = await make_user(session, login="replacement-op", group_id=next_group.id)
    admin_headers = await headers(client, assignment_admin)
    saved = await seed(client, admin_headers, head=head, supervisor=supervisor)
    await fund(session, operator)
    await fund(session, next_operator)
    me = await headers(client, operator)
    bought = await purchase(client, me)
    assert bought.status_code == 200, bought.text
    house = bought.json()["object"]
    upgrade = await client.post(
        f"{CITY}/buildings/{house['id']}/upgrade", headers=me,
        json={"key": uuid4().hex, "version": house["version"], "economy_revision": 0},
    )
    assert upgrade.status_code == 200, upgrade.text
    upgraded = upgrade.json()["object"]
    before_transactions = await count(session, CoinTransaction)
    balances_before = dict(
        (await session.execute(select(CoinAccount.user_id, CoinAccount.balance))).all()
    )
    body = editable(saved)
    district(body)["supervisor_id"] = next_sv.id
    # The stale groups from an open settings form cannot retain the old team's access.
    assert district(body)["group_ids"] == [operator.group_id]
    saved = await configure(client, await headers(client, head), body)
    assert district(saved)["group_ids"] == [next_group.id]
    stored = await session.scalar(select(CityObject).execution_options(populate_existing=True))
    assert (stored.owner_id, stored.state, stored.level, stored.paid) == (
        operator.id, "stored", upgraded["level"], upgraded["paid"]
    )
    assert await count(session, CityCell) == 0
    assert await count(session, CoinTransaction) == before_transactions
    balances_after = dict(
        (await session.execute(select(CoinAccount.user_id, CoinAccount.balance))).all()
    )
    assert balances_after == balances_before
    old_estate = (await client.get(CITY + "/estate", headers=me)).json()
    assert old_estate["status"] == "no_team"
    assert old_estate["objects"][0]["level"] == upgraded["level"]
    denied_purchase = await purchase(client, me, col=1)
    assert denied_purchase.status_code == 409
    assert denied_purchase.json()["code"] == "construction_no_team"
    assert (await project(client, await headers(client, supervisor))).status_code == 403
    replacement = await purchase(client, await headers(client, next_operator))
    assert replacement.status_code == 200, replacement.text
    clear = editable(saved)
    district(clear)["supervisor_id"] = None
    cleared = await configure(client, admin_headers, clear)
    assert district(cleared)["group_ids"] == []
    assert await count(session, CityCell) == 0
    next_object = await session.scalar(
        select(CityObject).where(CityObject.owner_id == next_operator.id)
        .execution_options(populate_existing=True)
    )
    assert next_object.state == "stored" and next_object.paid == replacement.json()["price"]
    assert await count(session, CoinTransaction) == before_transactions + 1


async def test_heads_and_supervisors_manage_projects_only_in_their_assigned_city_or_district(
    client, session, assignment_admin, head, supervisor
):
    sales_head = await make_user(session, login="projects-sales-head", role=Role.HEAD)
    sales_sv = await make_user(session, login="projects-sales-sv", role=Role.SUPERVISOR)
    admin_headers = await headers(client, assignment_admin)
    saved = await seed(
        client, admin_headers, head=head, supervisor=supervisor, sales_head=sales_head
    )
    body = editable(saved)
    district(body, "sales")["supervisor_id"] = sales_sv.id
    district(body, "sales")["construction"] = True
    await configure(client, admin_headers, body)
    for user in (head, supervisor):
        actor_headers = await headers(client, user)
        assert (await project(client, actor_headers, city="sales")).status_code == 403
        managed = (await client.get(CITY + "/estate", headers=actor_headers)).json()["managed"]
        assert "support-team-1" in managed and "sales-team-1" not in managed
    await legacy_square(session, "sales-team-1")
    opened = await project(client, await headers(client, sales_sv), city="sales")
    assert opened.status_code == 200, opened.text
    denied = await client.post(
        f"{CITY}/projects/{opened.json()['project']['id']}/cancel",
        headers=await headers(client, head), json={"key": uuid4().hex},
    )
    assert denied.status_code == 403
    cancelled = await client.post(
        f"{CITY}/projects/{opened.json()['project']['id']}/cancel",
        headers=admin_headers, json={"key": uuid4().hex},
    )
    assert cancelled.status_code == 200, cancelled.text


async def test_group_supervisor_patch_moves_existing_buildings_and_denies_previous_manager(
    client, session, assignment_admin, supervisor, operator
):
    next_sv = await make_user(session, login="patch-next-sv", role=Role.SUPERVISOR)
    admin_headers = await headers(client, assignment_admin)
    saved = await seed(client, admin_headers, supervisor=supervisor)
    body = editable(saved)
    district(body, "sales")["supervisor_id"] = next_sv.id
    district(body, "sales")["construction"] = True
    saved = await configure(client, admin_headers, body)
    await fund(session, operator)
    me = await headers(client, operator)
    bought = await purchase(client, me)
    assert bought.status_code == 200, bought.text
    before_transactions = await count(session, CoinTransaction)
    patched = await client.patch(
        f"/api/v1/admin/groups/{operator.group_id}", headers=admin_headers,
        json={"supervisor_id": next_sv.id},
    )
    assert patched.status_code == 200, patched.text
    data = await editor(client, admin_headers)
    assert data["revision"] == saved["revision"]
    assert district(data)["group_ids"] == []
    assert district(data, "sales")["group_ids"] == [operator.group_id]
    stored = await session.scalar(select(CityObject).execution_options(populate_existing=True))
    assert stored.state == "stored" and stored.paid == bought.json()["price"]
    assert await count(session, CityCell) == 0
    assert await count(session, CoinTransaction) == before_transactions
    view = (await client.get(CITY + "/world", headers=me)).json()
    assert view["home_city"] == "sales" and view["home_district"] == "sales-team-1"
    await legacy_square(session, "sales-team-1")
    previous_manager = await project(client, await headers(client, supervisor), city="sales")
    assert previous_manager.status_code == 403
    assert (await project(client, await headers(client, next_sv), city="sales")).status_code == 200


async def test_group_patch_from_mixed_legacy_team_routes_to_canonical_supervisor_once(
    client, session, assignment_admin, supervisor, operator
):
    mixed_sv = await make_user(session, login="mixed-legacy-sv", role=Role.SUPERVISOR)
    mixed_group = await make_group(session, code="mixed-legacy", supervisor_id=mixed_sv.id)
    next_sv = await make_user(session, login="canonical-next-sv", role=Role.SUPERVISOR)
    raw = city_world.defaults()
    data = {"cities": raw}
    district(data).pop("supervisor_id")
    district(data)["group_ids"] = [operator.group_id, mixed_group.id]
    district(data)["construction"] = True
    district(data, "sales")["supervisor_id"] = next_sv.id
    district(data, "sales")["construction"] = True
    session.add(CityWorld(id=1, revision=3, cities=raw, updated_by_id=assignment_admin.id))
    await session.commit()
    await fund(session, operator)
    me = await headers(client, operator)
    bought = await purchase(client, me)
    assert bought.status_code == 200, bought.text
    patched = await client.patch(
        f"/api/v1/admin/groups/{operator.group_id}",
        headers=await headers(client, assignment_admin), json={"supervisor_id": next_sv.id},
    )
    assert patched.status_code == 200, patched.text
    house = await session.scalar(select(CityObject).execution_options(populate_existing=True))
    assert house.state == "stored" and house.paid == bought.json()["price"]
    assert await count(session, CityCell) == 0
    config = await editor(client, await headers(client, assignment_admin))
    assert operator.group_id not in district(config)["group_ids"]
    assert district(config, "sales")["group_ids"] == [operator.group_id]
    mapped = [group_id for city in config["cities"] for item in city["districts"]
              for group_id in item["group_ids"]]
    assert mapped.count(operator.group_id) == 1
    world = (await client.get(CITY + "/world", headers=me)).json()
    assert world["home_district"] == "sales-team-1"
    legacy_row = await session.get(CityWorld, 1, populate_existing=True)
    assert legacy_row.cities == raw and legacy_row.revision == 3


async def test_new_assignment_cannot_take_groups_from_untouched_foreign_legacy_city(
    client, session, assignment_admin, head, supervisor, operator
):
    foreign_head = await make_user(session, login="legacy-foreign-head", role=Role.HEAD)
    mixed_sv = await make_user(session, login="foreign-mixed-sv", role=Role.SUPERVISOR)
    mixed_group = await make_group(session, code="foreign-mixed", supervisor_id=mixed_sv.id)
    raw = city_world.defaults()
    data = {"cities": raw}
    department(data)["head_id"] = foreign_head.id
    department(data, "sales")["head_id"] = head.id
    district(data).pop("supervisor_id")
    district(data)["group_ids"] = [operator.group_id, mixed_group.id]
    district(data)["construction"] = True
    session.add(CityWorld(id=1, revision=4, cities=raw, updated_by_id=assignment_admin.id))
    await session.commit()
    await fund(session, operator)
    bought = await purchase(client, await headers(client, operator))
    assert bought.status_code == 200, bought.text
    boss = await headers(client, head)
    before = await editor(client, boss)
    body = editable(before)
    district(body, "sales")["supervisor_id"] = supervisor.id
    rejected = await client.put(EDITOR, headers=boss, json=body)
    assert rejected.status_code == 400, rejected.text
    assert editable(await editor(client, boss)) == editable(before)
    house = await session.scalar(select(CityObject).execution_options(populate_existing=True))
    assert house.state == "placed" and house.paid == bought.json()["price"]
    assert await count(session, CityCell) == 1
    assert await count(session, AuditLog, action="city.world") == 0
    legacy_row = await session.get(CityWorld, 1, populate_existing=True)
    assert legacy_row.cities == raw and legacy_row.revision == 4


async def test_assigned_supervisor_cannot_be_disabled_before_groups_are_reassigned(
    client, session, assignment_admin, supervisor, operator
):
    admin_headers = await headers(client, assignment_admin)
    saved = await seed(client, admin_headers, supervisor=supervisor)
    await fund(session, operator)
    me = await headers(client, operator)
    sv_headers = await headers(client, supervisor)
    bought = await purchase(client, me)
    assert bought.status_code == 200, bought.text
    before_transactions = await count(session, CoinTransaction)
    disabled = await client.patch(
        f"/api/v1/admin/users/{supervisor.id}", headers=admin_headers,
        json={"is_active": False},
    )
    assert disabled.status_code == 409, disabled.text
    house = await session.scalar(select(CityObject).execution_options(populate_existing=True))
    assert house.state == "placed" and house.paid == bought.json()["price"]
    assert await count(session, CityCell) == 1
    assert await count(session, CoinTransaction) == before_transactions
    view = (await client.get(CITY + "/world", headers=me)).json()
    assert view["home_district"] == "support-team-1" and district(view)["assigned"]
    data = await editor(client, admin_headers)
    assert data["revision"] == saved["revision"]
    assert district(data)["group_ids"] == [operator.group_id]
    assert supervisor.id in {item["id"] for item in data["supervisors"]}
    await legacy_square(session)
    assert (await project(client, sv_headers)).status_code == 200


async def test_external_inactive_supervisor_cannot_retain_operator_building_access(
    client, session, assignment_admin, supervisor, operator
):
    admin_headers = await headers(client, assignment_admin)
    saved = await seed(client, admin_headers, supervisor=supervisor)
    await fund(session, operator)
    me = await headers(client, operator)
    bought = await purchase(client, me)
    assert bought.status_code == 200, bought.text
    before_transactions = await count(session, CoinTransaction)
    # Simulate existing data imported before the account deactivation guard was present.
    supervisor.is_active = False
    await session.commit()
    data = await editor(client, admin_headers)
    assert data["revision"] == saved["revision"] and district(data)["group_ids"] == []
    assert supervisor.id not in {item["id"] for item in data["supervisors"]}
    view = (await client.get(CITY + "/world", headers=me)).json()
    assert view["home_district"] is None and not district(view)["assigned"]
    denied_purchase = await purchase(client, me, col=1)
    assert denied_purchase.status_code == 409
    assert denied_purchase.json()["code"] == "construction_no_team"
    estate = (await client.get(CITY + "/estate", headers=me)).json()
    assert estate["status"] == "no_team" and estate["objects"][0]["state"] == "stored"
    assert estate["objects"][0]["paid"] == bought.json()["price"]
    assert await count(session, CityCell) == 0
    assert await count(session, CoinTransaction) == before_transactions


async def test_stale_save_and_failed_audit_roll_back_assignment_and_inventory(
    client, session, monkeypatch, assignment_admin, supervisor, operator
):
    admin_headers = await headers(client, assignment_admin)
    saved = await seed(client, admin_headers, supervisor=supervisor)
    await fund(session, operator)
    bought = await purchase(client, await headers(client, operator))
    assert bought.status_code == 200, bought.text
    before = {model: await count(session, model) for model in (
        AuditLog, CityEvent, CityCell, CoinTransaction
    )}
    body = editable(saved)
    district(body)["supervisor_id"] = None
    body["revision"] -= 1
    stale = await client.put(EDITOR, headers=admin_headers, json=body)
    assert stale.status_code == 409
    assert editable(await editor(client, admin_headers)) == editable(saved)
    body["revision"] = saved["revision"]

    async def fail_audit(*args, **kwargs):
        raise IntegrityError("audit insert", {}, RuntimeError("write failed"))

    monkeypatch.setattr(city_world, "write_audit", fail_audit)
    failed = await client.put(EDITOR, headers=admin_headers, json=body)
    assert failed.status_code == 409, failed.text
    assert editable(await editor(client, admin_headers)) == editable(saved)
    for model, expected in before.items():
        assert await count(session, model) == expected
    house = await session.scalar(select(CityObject).execution_options(populate_existing=True))
    assert house.state == "placed" and house.paid == bought.json()["price"]


async def test_legacy_world_reads_and_omitted_assignment_fields_preserve_existing_team(
    client, session, assignment_admin, head, supervisor, operator
):
    legacy = city_world.defaults()
    for city in legacy:
        city.pop("head_id", None)
        for item in city["districts"]:
            item.pop("supervisor_id", None)
            item.pop("construction", None)
    district({"cities": legacy})["group_ids"] = [operator.group_id]
    session.add(CityWorld(id=1, revision=7, cities=legacy, updated_by_id=assignment_admin.id))
    await session.commit()
    me = await headers(client, operator)
    world = (await client.get(CITY + "/world", headers=me)).json()
    assert world["home_district"] == "support-team-1"
    assert district(world)["supervisor"] == supervisor.full_name
    admin_headers = await headers(client, assignment_admin)
    read = await editor(client, admin_headers)
    assert read["revision"] == 7 and district(read)["group_ids"] == [operator.group_id]
    raw = await session.get(CityWorld, 1, populate_existing=True)
    assert raw.cities == legacy
    body = editable(read)
    department(body)["head_id"] = head.id
    assigned = await configure(client, admin_headers, body)
    old_form = editable(assigned)
    department(old_form)["name"] = "Совместимая форма"
    for city in old_form["cities"]:
        city.pop("head_id", None)
        for item in city["districts"]:
            item.pop("supervisor_id", None)
            item.pop("group_ids", None)
    changed = await configure(client, await headers(client, head), old_form)
    assert department(changed)["head_id"] == head.id
    assert district(changed)["supervisor_id"] == supervisor.id
    assert district(changed)["group_ids"] == [operator.group_id]
    assert await count(session, CoinTransaction) == 0
    audit = await session.scalar(
        select(AuditLog).where(AuditLog.action == "city.world").order_by(AuditLog.id.desc())
    )
    assert audit.actor_id == head.id and audit.entity_type == "city_world"
    assert audit.payload["before"]["revision"] == assigned["revision"]
    assert audit.payload["revision"] == changed["revision"]


@pytest.mark.parametrize("legacy_kind", ["mixed", "split", "all-filtered"])
async def test_untouched_legacy_assignment_survives_rename_and_explicit_clear_is_deliberate(
    client, session, assignment_admin, head, supervisor, operator, legacy_kind
):
    raw = city_world.defaults()
    data = {"cities": raw}
    for city in raw:
        city["head_id"] = head.id
    district(data).pop("supervisor_id")
    district(data)["group_ids"] = [operator.group_id]
    if legacy_kind == "mixed":
        other_sv = await make_user(session, login="rename-mixed-sv", role=Role.SUPERVISOR)
        group = await make_group(session, code="rename-mixed", supervisor_id=other_sv.id)
        district(data)["group_ids"].append(group.id)
    elif legacy_kind == "split":
        group = await make_group(session, code="rename-split", supervisor_id=supervisor.id)
        district(data, "sales").pop("supervisor_id")
        district(data, "sales")["group_ids"] = [group.id]
    else:
        district(data, "sales")["supervisor_id"] = supervisor.id
    original_groups = list(district(data)["group_ids"])
    session.add(CityWorld(id=1, revision=6, cities=raw, updated_by_id=assignment_admin.id))
    await session.commit()
    boss = await headers(client, head)
    current = await editor(client, boss)
    assert district(current)["legacy_assignment"]
    if legacy_kind == "all-filtered":
        assert district(current)["group_ids"] == []
    renamed_body = editable(current)
    department(renamed_body)["name"] = "Переименованный город"
    for city in current["cities"]:
        for item in city["districts"]:
            if item.get("legacy_assignment"):
                target = district(renamed_body, city["id"], int(item["id"].rsplit("-", 1)[1]))
                target.pop("supervisor_id", None)
                target.pop("group_ids", None)
    renamed = await configure(client, boss, renamed_body)
    stored = await session.get(CityWorld, 1, populate_existing=True)
    persisted = district({"cities": stored.cities})
    assert persisted["group_ids"] == original_groups and "supervisor_id" not in persisted
    assert district(renamed)["legacy_assignment"]
    clear_body = editable(renamed)
    # Omit every other unresolved district as a current editor does for unchanged assignments.
    for city in renamed["cities"]:
        for item in city["districts"]:
            if item.get("legacy_assignment"):
                target = district(clear_body, city["id"], int(item["id"].rsplit("-", 1)[1]))
                target.pop("supervisor_id", None)
                target.pop("group_ids", None)
    district(clear_body)["supervisor_id"] = None
    await configure(client, boss, clear_body)
    stored = await session.get(CityWorld, 1, populate_existing=True)
    persisted = district({"cities": stored.cities})
    assert persisted["supervisor_id"] is None and persisted["group_ids"] == []
    assert await count(session, AuditLog, action="city.world") == 2
    assert await count(session, CoinTransaction) == 0


@pytest.mark.parametrize("legacy_kind", [
    "mixed-supervisors", "supervisor-in-both-cities", "supervisor-in-mixed-second-city"
])
async def test_ambiguous_legacy_world_read_preserves_groups_and_does_not_write(
    client, session, assignment_admin, supervisor, operator, legacy_kind
):
    other_sv = supervisor
    if legacy_kind != "supervisor-in-both-cities":
        other_sv = await make_user(session, login="legacy-other-sv", role=Role.SUPERVISOR)
    other_group = await make_group(session, code="legacy-other", supervisor_id=other_sv.id)
    other_operator = await make_user(session, login="legacy-other-op", group_id=other_group.id)
    legacy = city_world.defaults()
    for city in legacy:
        city.pop("head_id", None)
        for item in city["districts"]:
            item.pop("supervisor_id", None)
    data = {"cities": legacy}
    district(data)["group_ids"] = [operator.group_id]
    other_city = "support" if legacy_kind == "mixed-supervisors" else "sales"
    district(data, other_city)["group_ids"].append(other_group.id)
    expected_homes = [(operator, "support-team-1"), (other_operator, f"{other_city}-team-1")]
    if legacy_kind == "supervisor-in-mixed-second-city":
        additional = await make_group(session, code="legacy-mixed-a", supervisor_id=supervisor.id)
        additional_operator = await make_user(
            session, login="legacy-mixed-a-op", group_id=additional.id
        )
        district(data, "sales")["group_ids"].append(additional.id)
        expected_homes.append((additional_operator, "sales-team-1"))
    session.add(CityWorld(id=1, revision=4, cities=legacy, updated_by_id=assignment_admin.id))
    await session.commit()
    read = await editor(client, await headers(client, assignment_admin))
    assert district(read)["group_ids"] == district(data)["group_ids"]
    assert district(read, "sales")["group_ids"] == district(data, "sales")["group_ids"]
    for user, expected in expected_homes:
        world = (await client.get(CITY + "/world", headers=await headers(client, user))).json()
        assert world["home_district"] == expected
    raw = await session.get(CityWorld, 1, populate_existing=True)
    assert raw.cities == legacy and raw.revision == 4
    assert await count(session, AuditLog, action="city.world") == 0
    assert await count(session, CoinTransaction) == 0


async def test_reactivated_operator_in_archived_legacy_group_cannot_build(
    client, session, assignment_admin, supervisor, operator
):
    other_sv = await make_user(session, login="archived-legacy-sv", role=Role.SUPERVISOR)
    other_group = await make_group(session, code="archived-legacy-other", supervisor_id=other_sv.id)
    raw = city_world.defaults()
    team = district({"cities": raw})
    team.pop("supervisor_id")
    team["group_ids"] = [operator.group_id, other_group.id]
    team["construction"] = True
    session.add(CityWorld(id=1, revision=3, cities=raw, updated_by_id=assignment_admin.id))
    await session.commit()
    await fund(session, operator)
    me = await headers(client, operator)
    bought = await purchase(client, me)
    assert bought.status_code == 200, bought.text
    # An imported legacy account may retain its archived group when reactivated later.
    operator.is_active = False
    group = await session.get(Group, operator.group_id)
    group.is_active = False
    await session.commit()
    before_transactions = await count(session, CoinTransaction)
    admin_headers = await headers(client, assignment_admin)
    activated = await client.patch(
        f"/api/v1/admin/users/{operator.id}", headers=admin_headers, json={"is_active": True}
    )
    assert activated.status_code == 200, activated.text
    data = await editor(client, admin_headers)
    assert district(data)["legacy_assignment"]
    assert district(data)["group_ids"] == [other_group.id]
    stored_world = await session.get(CityWorld, 1, populate_existing=True)
    assert district({"cities": stored_world.cities})["group_ids"] == team["group_ids"]
    me = await headers(client, operator)
    view = (await client.get(CITY + "/world", headers=me)).json()
    assert view["home_district"] is None
    denied = await purchase(client, me, col=1)
    assert denied.status_code == 409 and denied.json()["code"] == "construction_no_team"
    house = await session.scalar(select(CityObject).execution_options(populate_existing=True))
    assert house.state == "stored" and house.paid == bought.json()["price"]
    assert await count(session, CityCell) == 0
    assert await count(session, CoinTransaction) == before_transactions
