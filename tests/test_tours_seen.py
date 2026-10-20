"""Подсказки Пульсара на рабочих сайтах запоминаются для учётной записи, а не для браузера."""

from tests.conftest import auth, login

API = "/api/v1"


async def see(client, headers, tour, state):
    return await client.put(f"{API}/auth/tours/{tour}", headers=headers, json={"state": state})


async def test_a_seen_tour_is_kept_for_the_account(client, operator):
    headers = auth(await login(client, operator.login))
    assert (await client.get(f"{API}/auth/me", headers=headers)).json()["tours_seen"] is None
    closed = await see(client, headers, "oktell", "closed")
    assert closed.status_code == 200, closed.text
    assert closed.json()["tours_seen"] == {"oktell": "closed"}
    finished = await see(client, headers, "oktell", "done")
    assert finished.json()["tours_seen"] == {"oktell": "done"}
    # Closing it early on another device later does not undo a finished walk.
    again = await see(client, headers, "oktell", "closed")
    assert again.json()["tours_seen"] == {"oktell": "done"}
    await see(client, headers, "promoConnect", "closed")
    # A new login (another browser) gets the same record.
    other = auth(await login(client, operator.login))
    me = (await client.get(f"{API}/auth/me", headers=other)).json()
    assert me["tours_seen"] == {"oktell": "done", "promoConnect": "closed"}


async def test_only_tour_names_and_known_states_are_stored(client, operator):
    headers = auth(await login(client, operator.login))
    for wrong in ("1fleet", "a" * 41, "fleet.x", "флот"):
        response = await see(client, headers, wrong, "done")
        assert response.status_code in (404, 422), wrong
    assert (await see(client, headers, "fleet", "seen")).status_code == 422
    for number in range(32):
        saved = await see(client, headers, f"tour{number}", "closed")
        assert saved.status_code == 200, saved.text
    assert (await see(client, headers, "fleet", "done")).status_code == 409
    # A tour already in the record can still be finished.
    finished = await see(client, headers, "tour3", "done")
    assert finished.json()["tours_seen"]["tour3"] == "done"


async def test_tours_need_a_login(client):
    response = await client.put(f"{API}/auth/tours/fleet", json={"state": "done"})
    assert response.status_code == 401
