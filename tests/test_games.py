import asyncio
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select

from app.models.coin import CoinTransaction
from app.models.games import Raffle, RaffleEntry, WheelSpin
from app.models.progress import XpEntry
from tests.conftest import auth, login


async def enable(client, head):
    headers = auth(await login(client, head.login))
    response = await client.put(
        "/api/v1/admin/games/wheel",
        headers=headers,
        json={
            "enabled": True,
            "daily_spins": 1,
            "segments": [
                {"title": "Награда A", "weight": 1, "xp": 10, "coins": 5},
                {"title": "Награда B", "weight": 1, "xp": 20, "coins": 5},
            ],
        },
    )
    assert response.status_code == 200, response.text
    return headers


async def test_wheel_server_choice_idempotency_and_daily_limit(client, session, operator, head):
    headers = auth(await login(client, operator.login))
    path = "/api/v1/games/wheel/spin"
    assert (
        await client.post(path, headers=headers, json={"request_id": "spin-before-enable"})
    ).status_code == 409
    await enable(client, head)
    result = await client.post(path, headers=headers, json={"request_id": "spin-idempotency-001"})
    assert result.status_code == 200, result.text
    data = result.json()
    assert data["reward"] == data["segments"][data["segment"]]
    replay = await client.post(path, headers=headers, json={"request_id": "spin-idempotency-001"})
    assert replay.json() == data
    assert (
        await client.post(path, headers=headers, json={"request_id": "spin-idempotency-002"})
    ).status_code == 409
    assert (
        await client.post(
            path, headers=headers, json={"request_id": "spin-tampered-001", "segment": 0}
        )
    ).status_code == 422
    assert await session.scalar(select(func.count(WheelSpin.id))) == 1
    assert await session.scalar(select(func.count(XpEntry.id))) == 1
    assert await session.scalar(select(func.count(CoinTransaction.id))) == 1
    assert (await client.get("/api/v1/games/wheel", headers=headers)).json()["used_today"] == 1


async def test_parallel_spins_cannot_exceed_daily_limit(client, session, operator, head):
    await enable(client, head)
    headers = auth(await login(client, operator.login))
    responses = await asyncio.gather(
        *[
            client.post(
                "/api/v1/games/wheel/spin",
                headers=headers,
                json={"request_id": f"parallel-spin-{index:04d}"},
            )
            for index in range(2)
        ]
    )
    assert sorted(response.status_code for response in responses) == [200, 409]
    assert await session.scalar(select(func.count(WheelSpin.id))) == 1


async def test_raffle_entry_draw_and_reward_are_once(client, session, operator, head):
    admin = auth(await login(client, head.login))
    own = auth(await login(client, operator.login))
    payload = {
        "title": "Розыгрыш недели",
        "prize": "Кофе",
        "status": "published",
        "closes_at": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
        "xp_reward": 25,
        "coins_reward": 10,
    }
    created = await client.post("/api/v1/admin/games/raffles", headers=admin, json=payload)
    assert created.status_code == 201, created.text
    raffle_id = created.json()["id"]
    for _ in range(2):
        assert (
            await client.post(f"/api/v1/games/raffles/{raffle_id}/enter", headers=own)
        ).status_code == 200
    assert await session.scalar(select(func.count(RaffleEntry.id))) == 1
    assert (
        await client.put(
            f"/api/v1/admin/games/raffles/{raffle_id}",
            headers=admin,
            json={**payload, "prize": "Другой приз"},
        )
    ).status_code == 409
    draw_path = f"/api/v1/admin/games/raffles/{raffle_id}/draw"
    assert (await client.post(draw_path, headers=admin)).status_code == 409
    item = await session.get(Raffle, raffle_id)
    item.closes_at = datetime.now(UTC) - timedelta(minutes=1)
    await session.commit()
    result = (await client.post(draw_path, headers=admin)).json()
    assert result["winner_name"] == operator.full_name
    assert (await client.post(draw_path, headers=admin)).json() == result
    assert await session.scalar(select(func.count(XpEntry.id))) == 1
    assert await session.scalar(select(func.count(CoinTransaction.id))) == 1
    public = (await client.get("/api/v1/games/raffles", headers=own)).json()
    assert public[0]["won"] is True


async def test_games_configuration_is_role_guarded_and_validated(client, supervisor, head):
    staff = auth(await login(client, supervisor.login))
    admin = auth(await login(client, head.login))
    invalid = {
        "enabled": True,
        "daily_spins": 1,
        "segments": [{"title": "Без награды", "weight": 0}, {"title": "Подарок", "weight": 1}],
    }
    assert (
        await client.put("/api/v1/admin/games/wheel", headers=staff, json=invalid)
    ).status_code == 403
    assert (
        await client.put("/api/v1/admin/games/wheel", headers=admin, json=invalid)
    ).status_code == 422
