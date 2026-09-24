"""Пол оператора и имя его помощника в учебном городе."""

from tests.conftest import auth, login

API = "/api/v1"


async def test_head_creates_operator_with_gender_and_can_change_it(client, head):
    headers = auth(await login(client, head.login))
    created = await client.post(
        f"{API}/admin/users",
        headers=headers,
        json={
            "login": "newop",
            "full_name": "Новый Оператор",
            "password": "password123",
            "gender": "female",
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["gender"] == "female"
    assert created.json()["guide_name"] is None
    changed = await client.patch(
        f"{API}/admin/users/{created.json()['id']}", headers=headers, json={"gender": "male"}
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["gender"] == "male"
    bad = await client.post(
        f"{API}/admin/users",
        headers=headers,
        json={
            "login": "badop",
            "full_name": "Плохой Пол",
            "password": "password123",
            "gender": "other",
        },
    )
    assert bad.status_code == 422


async def test_operator_names_the_guide_and_picks_a_figure(client, operator):
    headers = auth(await login(client, operator.login))
    saved = await client.put(
        f"{API}/auth/guide", headers=headers, json={"gender": "male", "guide_name": "  Арман  "}
    )
    assert saved.status_code == 200, saved.text
    me = (await client.get(f"{API}/auth/me", headers=headers)).json()
    assert (me["gender"], me["guide_name"]) == ("male", "Арман")
    # Only the name changes; the figure stays as chosen.
    renamed = await client.put(
        f"{API}/auth/guide", headers=headers, json={"guide_name": "Айя-Лана"}
    )
    assert renamed.json()["guide_name"] == "Айя-Лана" and renamed.json()["gender"] == "male"
    for wrong in ("А", "Robot<3", "x" * 41):
        response = await client.put(
            f"{API}/auth/guide", headers=headers, json={"guide_name": wrong}
        )
        assert response.status_code == 422, wrong
    cleared = await client.put(f"{API}/auth/guide", headers=headers, json={"guide_name": "   "})
    assert cleared.json()["guide_name"] is None
