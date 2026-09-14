import secrets
from datetime import UTC, datetime

from fastapi import APIRouter
from sqlalchemy import func, select, text

from app.core.deps import CurrentUser, HeadUser, PaginationDep, SessionDep, StaffUser
from app.core.errors import ConflictError, DomainError, NotFoundError
from app.models.enums import TxType
from app.models.games import Raffle, RaffleEntry, WheelConfig, WheelSpin
from app.models.progress import Notification
from app.models.user import User
from app.schemas.common import Message, Page
from app.schemas.games import RaffleInput, SpinInput, WheelInput
from app.services.coins import post_transaction
from app.services.learning import lock_learner
from app.services.rules import write_audit

router = APIRouter(tags=["Игры и розыгрыши"])


def utc(value):
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def coin_segment(segment):
    result = {key: value for key, value in segment.items() if key != "xp"}
    if "XP" in result.get("title", "").upper():
        result["title"] = (
            str(result.get("coins", 0)) + " коинов" if result.get("coins") else "Без награды"
        )
    return result


def config_data(config):
    return {
        "enabled": config.enabled if config else False,
        "daily_spins": config.daily_spins if config else 1,
        "segments": [coin_segment(item) for item in config.segments]
        if config
        else [
            {"title": "В этот раз без награды", "weight": 1, "coins": 0},
            {"title": "5 коинов", "weight": 1, "coins": 5},
        ],
    }


@router.get("/games/wheel")
async def wheel(session: SessionDep, user: CurrentUser):
    data = config_data(await session.get(WheelConfig, 1))
    data["used_today"] = int(
        await session.scalar(
            select(func.count(WheelSpin.id)).where(
                WheelSpin.user_id == user.id, WheelSpin.day == datetime.now(UTC).date()
            )
        )
        or 0
    )
    return data


@router.put("/admin/games/wheel")
async def save_wheel(session: SessionDep, actor: HeadUser, payload: WheelInput):
    config = await session.get(WheelConfig, 1)
    before = config_data(config)
    if config is None:
        config = WheelConfig(id=1)
        session.add(config)
    for key, value in payload.model_dump().items():
        setattr(config, key, value)
    await write_audit(
        session,
        actor_id=actor.id,
        action="wheel.configure",
        entity_type="wheel",
        entity_id=1,
        payload={"before": before, "after": payload.model_dump()},
    )
    await session.commit()
    return config_data(config)


async def reward(session, user_id: int, coins: int, key: str, reason: str):
    if coins:
        await post_transaction(
            session,
            user_id=user_id,
            amount=coins,
            tx_type=TxType.GAME_REWARD,
            reason=reason,
            idempotency_key=key,
        )


def spin_data(item):
    return {
        "id": item.id,
        "segment": item.segment,
        "reward": coin_segment(item.reward),
        "segments": [coin_segment(segment) for segment in item.segments],
        "created_at": item.created_at,
    }


@router.post("/games/wheel/spin")
async def spin(session: SessionDep, user: CurrentUser, payload: SpinInput):
    await lock_learner(session, user.id)
    key = f"wheel:{user.id}:{payload.request_id}"
    previous = await session.scalar(select(WheelSpin).where(WheelSpin.request_key == key))
    if previous:
        return spin_data(previous)
    config = await session.get(WheelConfig, 1)
    if config is None or not config.enabled:
        raise ConflictError("Колесо сейчас недоступно")
    today = datetime.now(UTC).date()
    used = (
        await session.scalar(
            select(func.count(WheelSpin.id)).where(
                WheelSpin.user_id == user.id, WheelSpin.day == today
            )
        )
        or 0
    )
    if used >= config.daily_spins:
        raise ConflictError("Попытки на сегодня закончились. Новые доступны после 00:00 UTC.")
    target = secrets.randbelow(sum(item["weight"] for item in config.segments))
    chosen = 0
    for index, segment in enumerate(config.segments):
        if target < segment["weight"]:
            chosen = index
            break
        target -= segment["weight"]
    segment = coin_segment(config.segments[chosen])
    item = WheelSpin(
        user_id=user.id,
        day=today,
        request_key=key,
        segment=chosen,
        reward=segment,
        segments=config.segments,
    )
    session.add(item)
    await session.flush()
    await reward(session, user.id, segment["coins"], key, f"Колесо WOW: {segment['title']}")
    session.add(
        Notification(
            user_id=user.id,
            title="Результат Колеса WOW",
            body=segment["title"],
            kind="games",
            link="/games?tab=wheel",
        )
    )
    await session.commit()
    return spin_data(item)


@router.get("/games/wheel/history")
async def spin_history(session: SessionDep, user: CurrentUser, pagination: PaginationDep):
    condition = WheelSpin.user_id == user.id
    total = int(await session.scalar(select(func.count(WheelSpin.id)).where(condition)) or 0)
    rows = await session.scalars(
        select(WheelSpin)
        .where(condition)
        .order_by(WheelSpin.id.desc())
        .offset(pagination.offset)
        .limit(pagination.size)
    )
    return Page.build([spin_data(item) for item in rows], total, pagination.page, pagination.size)


async def raffle_data(session, item, user_id):
    count = int(
        await session.scalar(
            select(func.count(RaffleEntry.id)).where(RaffleEntry.raffle_id == item.id)
        )
        or 0
    )
    entered = (
        await session.scalar(
            select(RaffleEntry.id).where(
                RaffleEntry.raffle_id == item.id, RaffleEntry.user_id == user_id
            )
        )
        is not None
    )
    winner = await session.get(User, item.winner_id) if item.winner_id else None
    return {
        "id": item.id,
        "title": item.title,
        "description": item.description,
        "prize": item.prize,
        "closes_at": utc(item.closes_at),
        "status": item.status,
        "coins_reward": item.coins_reward,
        "participants": count,
        "entered": entered,
        "winner_name": winner.full_name if winner else None,
        "won": item.winner_id == user_id,
        "drawn_at": utc(item.drawn_at) if item.drawn_at else None,
        "accepting_entries": item.status == "published" and utc(item.closes_at) > datetime.now(UTC),
    }


@router.get("/games/raffles")
async def raffles(session: SessionDep, user: CurrentUser):
    rows = await session.scalars(
        select(Raffle).where(Raffle.status != "draft").order_by(Raffle.id.desc()).limit(100)
    )
    return [await raffle_data(session, item, user.id) for item in rows]


@router.get("/admin/games/raffles")
async def admin_raffles(session: SessionDep, actor: StaffUser):
    rows = await session.scalars(select(Raffle).order_by(Raffle.id.desc()).limit(100))
    return [await raffle_data(session, item, actor.id) for item in rows]


async def lock_raffle(session, raffle_id):
    if session.get_bind().dialect.name == "sqlite":
        await session.execute(text("UPDATE raffles SET id = id WHERE id = :id"), {"id": raffle_id})
    item = await session.scalar(
        select(Raffle)
        .where(Raffle.id == raffle_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if item is None:
        raise NotFoundError("Розыгрыш не найден")
    return item


async def save_raffle(session, actor, payload, item=None):
    if item:
        count = await session.scalar(
            select(func.count(RaffleEntry.id)).where(RaffleEntry.raffle_id == item.id)
        )
        if item.status == "closed" or count:
            raise ConflictError("Условия розыгрыша с участниками или результатом менять нельзя")
    if payload.status == "published" and utc(payload.closes_at) <= datetime.now(UTC):
        raise DomainError("Дата завершения должна быть в будущем")
    before = {key: getattr(item, key, None) for key in type(payload).model_fields} if item else None
    if item is None:
        item = Raffle()
        session.add(item)
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    if before:
        before["closes_at"] = before["closes_at"].isoformat()
    await session.flush()
    await write_audit(
        session,
        actor_id=actor.id,
        action="raffle.save",
        entity_type="raffle",
        entity_id=item.id,
        payload={"before": before, "after": payload.model_dump(mode="json")},
    )
    await session.commit()
    return await raffle_data(session, item, actor.id)


@router.post("/admin/games/raffles", status_code=201)
async def create_raffle(session: SessionDep, actor: HeadUser, payload: RaffleInput):
    return await save_raffle(session, actor, payload)


@router.put("/admin/games/raffles/{raffle_id}")
async def edit_raffle(session: SessionDep, actor: HeadUser, raffle_id: int, payload: RaffleInput):
    return await save_raffle(session, actor, payload, await lock_raffle(session, raffle_id))


@router.post("/games/raffles/{raffle_id}/enter", response_model=Message)
async def enter(session: SessionDep, user: CurrentUser, raffle_id: int):
    item = await lock_raffle(session, raffle_id)
    existing = await session.scalar(
        select(RaffleEntry.id).where(
            RaffleEntry.raffle_id == item.id, RaffleEntry.user_id == user.id
        )
    )
    if existing:
        return Message(detail="Вы уже участвуете")
    if item.status != "published" or utc(item.closes_at) <= datetime.now(UTC):
        raise ConflictError("Приём участников завершён")
    session.add(RaffleEntry(raffle_id=item.id, user_id=user.id))
    await session.commit()
    return Message(detail="Вы участвуете в розыгрыше")


@router.post("/admin/games/raffles/{raffle_id}/draw")
async def draw(session: SessionDep, actor: HeadUser, raffle_id: int):
    item = await lock_raffle(session, raffle_id)
    if item.status == "closed":
        return await raffle_data(session, item, actor.id)
    if item.status != "published" or utc(item.closes_at) > datetime.now(UTC):
        raise ConflictError("Результат можно определить после окончания опубликованного розыгрыша")
    ids = list(
        await session.scalars(
            select(RaffleEntry.user_id)
            .where(RaffleEntry.raffle_id == item.id)
            .order_by(RaffleEntry.id)
        )
    )
    item.winner_id = secrets.choice(ids) if ids else None
    item.drawn_at = datetime.now(UTC)
    item.status = "closed"
    if item.winner_id:
        await lock_learner(session, item.winner_id)
        await reward(
            session,
            item.winner_id,
            item.coins_reward,
            f"raffle:{item.id}",
            f"Розыгрыш: {item.title}",
        )
        session.add(
            Notification(
                user_id=item.winner_id,
                title="Вы выиграли в розыгрыше",
                body=item.prize,
                kind="games",
                link="/games?tab=raffles",
            )
        )
    await write_audit(
        session,
        actor_id=actor.id,
        action="raffle.draw",
        entity_type="raffle",
        entity_id=item.id,
        payload={
            "participants": len(ids),
            "winner_id": item.winner_id,
            "method": "uniform_secure_random",
        },
    )
    await session.commit()
    return await raffle_data(session, item, actor.id)
