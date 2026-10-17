"""The audit journal narrows by section (action prefixes) and by who acted."""

from app.models.enums import Role
from tests.conftest import auth, login, make_user

AUDIT = "/api/v1/admin/audit"


async def test_audit_filters_by_section_and_actor(client, session):
    admin = await make_user(
        session, login="audit-admin", role=Role.ADMIN, full_name="Алия Ахметова"
    )
    await make_user(session, login="audit-operator", full_name="Ержан Сеитов")
    headers = auth(await login(client, admin.login))
    await login(client, "audit-operator")
    created = await client.post(
        "/api/v1/admin/users",
        headers=headers,
        json={"login": "audit-new", "full_name": "Новый Сотрудник", "password": "password123"},
    )
    assert created.status_code == 201, created.text

    def actions(response):
        assert response.status_code == 200, response.text
        return {item["action"] for item in response.json()["items"]}

    everything = actions(await client.get(AUDIT, headers=headers))
    assert {"auth.login", "user.create"} <= everything
    # A section is a set of action prefixes; several prefixes widen it, never narrow it.
    logins = actions(await client.get(AUDIT, headers=headers, params={"prefix": ["auth."]}))
    assert logins == {"auth.login"}
    both = await client.get(AUDIT, headers=headers, params={"prefix": ["auth.", "user."]})
    assert {"auth.login", "user.create"} <= actions(both)
    # «_» and «%» in a prefix are plain characters, not patterns.
    assert actions(await client.get(AUDIT, headers=headers, params={"prefix": ["a%"]})) == set()

    by_name = await client.get(AUDIT, headers=headers, params={"actor": "Сеит"})
    assert actions(by_name) == {"auth.login"}
    assert {item["actor_name"] for item in by_name.json()["items"]} == {"Ержан Сеитов"}
    by_login = await client.get(AUDIT, headers=headers, params={"actor": "AUDIT-ADMIN"})
    assert {item["actor_name"] for item in by_login.json()["items"]} == {"Алия Ахметова"}
    combined = await client.get(
        AUDIT, headers=headers, params={"actor": "Ахметова", "prefix": ["user."]}
    )
    assert actions(combined) == {"user.create"}
    assert (await client.get(AUDIT, headers=headers, params={"actor": "   "})).json()["total"] == (
        await client.get(AUDIT, headers=headers)
    ).json()["total"]
