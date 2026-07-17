"""Сервис экономики коинов (ТЗ «Экономика коинов, магазин призов и
стартовый сезон Puls», v1.0).

Здесь живут:
- разрешение активного сезона (§7);
- эффективная цена товара с учётом сезона и «будущей цены» (§7, §8);
- движок начисления наград по управляемым правилам с идемпотентностью (§4, §14);
- ограничения ручных начислений: запрет self-award и лимит с подтверждением (§6, §15).

Кошелёк и ledger переиспользуются (§12): единственная точка изменения
баланса — app.modules.wallet.service.add_transaction.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.datetime_utils import now_utc
from app.models.entities import (
    CoinTransaction,
    EconomySeason,
    Operator,
    RewardRule,
    ShopItem,
    ShopItemPrice,
    User,
)

# ТЗ §15: ручное начисление свыше лимита требует дополнительного подтверждения.
MANUAL_ACCRUAL_CONFIRM_LIMIT = 100


# ---------------------------------------------------------------------------
# Сезоны
# ---------------------------------------------------------------------------

def get_active_season(db: Session, at: datetime | None = None) -> EconomySeason | None:
    """Активный сезон на момент `at` (naive UTC): статус active и окно дат
    покрывает момент. При перекрытии окон берётся сезон с более поздним
    starts_at — «последний объявленный побеждает»."""
    moment = at or now_utc()
    return db.scalar(
        select(EconomySeason)
        .where(
            EconomySeason.status == "active",
            EconomySeason.starts_at <= moment,
            (EconomySeason.ends_at.is_(None)) | (EconomySeason.ends_at > moment),
        )
        .order_by(EconomySeason.starts_at.desc())
        .limit(1)
    )


def season_price(db: Session, item_id: int, season: EconomySeason | None) -> ShopItemPrice | None:
    if season is None:
        return None
    return db.scalar(
        select(ShopItemPrice).where(
            ShopItemPrice.shop_item_id == item_id,
            ShopItemPrice.season_id == season.id,
            ShopItemPrice.active.is_(True),
        )
    )


def effective_item_pricing(
    db: Session,
    item: ShopItem,
    season: EconomySeason | None = None,
    *,
    _season_resolved: bool = False,
) -> dict:
    """Эффективная цена карточки (ТЗ §7, §9).

    Возвращает словарь для API:
    - price — цена, по которой товар продаётся сейчас;
    - regular_price — базовая («будущая») цена из ShopItem.price;
    - is_seasonal_price — активна ли сезонная цена (метка «Стартовая цена»);
    - season_id/season_code/season_name/season_ends_at — контекст сезона.

    ТЗ: «Нельзя повышать цены скрытно» — при сезонной цене карточка обязана
    показывать и обычную будущую цену, и дату завершения предложения.
    """
    if season is None and not _season_resolved:
        season = get_active_season(db)
    override = season_price(db, item.id, season)
    if override is not None:
        return {
            "price": override.coin_price,
            "regular_price": item.price,
            "is_seasonal_price": True,
            "season_id": season.id,
            "season_code": season.code,
            "season_name": season.name,
            "season_ends_at": season.ends_at,
        }
    return {
        "price": item.price,
        "regular_price": item.price,
        "is_seasonal_price": False,
        "season_id": season.id if season else None,
        "season_code": season.code if season else None,
        "season_name": season.name if season else None,
        "season_ends_at": season.ends_at if season else None,
    }


# ---------------------------------------------------------------------------
# Движок наград
# ---------------------------------------------------------------------------

def find_reward_rule(
    db: Session,
    source_type: str,
    source_code: str,
    season: EconomySeason | None = None,
    at: datetime | None = None,
) -> RewardRule | None:
    """Подбор правила: сезонное правило приоритетнее глобального (season_id
    IS NULL). Учитываются active и окно valid_from/valid_to."""
    moment = at or now_utc()
    query = (
        select(RewardRule)
        .where(
            RewardRule.source_type == source_type,
            RewardRule.source_code == source_code,
            RewardRule.active.is_(True),
            (RewardRule.valid_from.is_(None)) | (RewardRule.valid_from <= moment),
            (RewardRule.valid_to.is_(None)) | (RewardRule.valid_to > moment),
        )
    )
    if season is not None:
        query = query.where(
            (RewardRule.season_id == season.id) | (RewardRule.season_id.is_(None))
        )
        # nulls last: сначала сезонные правила
        query = query.order_by(RewardRule.season_id.is_(None), RewardRule.id.desc())
    else:
        query = query.where(RewardRule.season_id.is_(None)).order_by(RewardRule.id.desc())
    return db.scalar(query.limit(1))


def _period_start(period: str, moment: datetime) -> datetime | None:
    if period == "week":
        start_of_day = moment.replace(hour=0, minute=0, second=0, microsecond=0)
        return start_of_day - timedelta(days=moment.weekday())
    if period == "month":
        return moment.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return None  # all_time


def _payout_count(
    db: Session, operator_id: int, source_type: str, source_code: str, since: datetime | None
) -> int:
    """Сколько выплат по source_type+source_code уже было у оператора.
    source_code хранится в metadata_json — фильтруем в Python: выплат на
    оператора единицы-десятки, выборка по индексам operator_id/source_type."""
    conditions = [
        CoinTransaction.operator_id == operator_id,
        CoinTransaction.source_type == source_type,
        CoinTransaction.type == "reward",
        CoinTransaction.amount > 0,
    ]
    if since is not None:
        conditions.append(CoinTransaction.created_at >= since)
    rows = db.scalars(select(CoinTransaction).where(*conditions)).all()
    return sum(
        1
        for tx in rows
        if (tx.metadata_json or {}).get("source_code") == source_code
    )


def accrue_reward(
    db: Session,
    operator: Operator,
    *,
    source_type: str,
    source_code: str,
    source_id: int | None = None,
    event_key: str | None = None,
    score: float | None = None,
    comment: str | None = None,
    created_by: User | None = None,
) -> dict:
    """Оценка подтверждённого события и начисление по правилу (ТЗ §14).

    Возвращает {"awarded": bool, "amount": int, "reason": str,
    "transaction_id": int | None}. Никогда не бросает исключение из-за
    отсутствия правила или недобора порога — источник события не должен
    падать из-за экономики; отказ фиксируется в reason.

    Идемпотентность: стабильный ключ строится как
    "{source_type}:{source_code}:operator:{id}[:{event_key}]".
    Повторное событие возвращает исходный результат без повторной выплаты.
    """
    from app.modules.wallet.service import add_transaction

    moment = now_utc()
    season = get_active_season(db, moment)
    rule = find_reward_rule(db, source_type, source_code, season, moment)
    if rule is None:
        return {"awarded": False, "amount": 0, "reason": "no_rule", "transaction_id": None}

    if rule.threshold is not None and (score is None or score < rule.threshold):
        return {"awarded": False, "amount": 0, "reason": "below_threshold", "transaction_id": None}

    key_parts = [source_type, source_code, "operator", str(operator.id)]
    if event_key:
        key_parts.append(str(event_key))
    idempotency_key = ":".join(key_parts)

    # Дубликат проверяется РАНЬШЕ лимита периода: повторное событие обязано
    # вернуть ранее созданный результат, а не абстрактный отказ (ТЗ §14 п.6).
    existing = db.scalar(
        select(CoinTransaction).where(CoinTransaction.idempotency_key == idempotency_key)
    )
    if existing is not None:
        return {
            "awarded": False,
            "amount": existing.amount,
            "reason": "duplicate",
            "transaction_id": existing.id,
        }

    # Лимит частоты выплат (ТЗ §4: одноразовые награды, «не допустить фарм»)
    if rule.period_limit > 0:
        since = _period_start(rule.period, moment)
        paid = _payout_count(db, operator.id, source_type, source_code, since)
        if paid >= rule.period_limit:
            return {"awarded": False, "amount": 0, "reason": "period_limit", "transaction_id": None}

    tx = add_transaction(
        db,
        operator,
        rule.amount,
        "reward",
        comment or (rule.name or f"Награда: {source_type}/{source_code}"),
        created_by=created_by,
        source_type=source_type,
        source_id=source_id,
        metadata={
            "source_code": source_code,
            "rule_id": rule.id,
            "rule_version": rule.version,
            "season_id": season.id if season else None,
            "score": score,
        },
        idempotency_key=idempotency_key,
    )
    db.flush()
    return {
        "awarded": True,
        "amount": tx.amount,
        "reason": "ok",
        "transaction_id": tx.id,
    }


# ---------------------------------------------------------------------------
# Ограничения ручных операций (ТЗ §6, §15)
# ---------------------------------------------------------------------------

def assert_manual_accrual_allowed(
    current_user: User,
    operator: Operator,
    amount: int,
    *,
    confirmed_over_limit: bool = False,
) -> None:
    """Правила ручного начисления:
    - Администратор (и любой сотрудник) не может начислить коины самому себе
      (ТЗ §6: «Администратор не может начислить коины самому себе»).
    - Начисление свыше MANUAL_ACCRUAL_CONFIRM_LIMIT требует явного
      подтверждения (ТЗ §15: «свыше 100 коинов — дополнительное подтверждение
      руководителя»). Подтверждение передаётся флагом confirm_over_limit —
      интерфейс обязан показать отдельный шаг подтверждения.
    Списаний (amount < 0) ограничения не касаются — их контролирует
    существующий запрет отрицательного баланса.
    """
    if amount <= 0:
        return
    if current_user.operator_id and current_user.operator_id == operator.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Нельзя начислить коины самому себе",
        )
    if amount > MANUAL_ACCRUAL_CONFIRM_LIMIT and not confirmed_over_limit:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Начисление свыше {MANUAL_ACCRUAL_CONFIRM_LIMIT} коинов требует "
                f"подтверждения (confirm_over_limit)"
            ),
        )


# ---------------------------------------------------------------------------
# /economy/me — сводка оператора (ТЗ §13)
# ---------------------------------------------------------------------------

def economy_me(db: Session, operator: Operator) -> dict:
    moment = now_utc()
    season = get_active_season(db, moment)
    week_start = _period_start("week", moment)
    earned_week = db.scalar(
        select(func.coalesce(func.sum(CoinTransaction.amount), 0)).where(
            CoinTransaction.operator_id == operator.id,
            CoinTransaction.amount > 0,
            CoinTransaction.created_at >= week_start,
        )
    ) or 0

    # Ближайшая достижимая цель: самый дешёвый активный товар дороже баланса;
    # если баланс покрывает всё — самый дорогой доступный.
    items = list(db.scalars(select(ShopItem).where(ShopItem.is_active.is_(True))))
    nearest_goal = None
    priced = sorted(
        (
            (effective_item_pricing(db, item, season, _season_resolved=True), item)
            for item in items
        ),
        key=lambda pair: pair[0]["price"],
    )
    for pricing, item in priced:
        if pricing["price"] > operator.current_balance:
            nearest_goal = {
                "shop_item_id": item.id,
                "title": item.title,
                "price": pricing["price"],
                "missing": pricing["price"] - operator.current_balance,
            }
            break

    return {
        "balance": operator.current_balance,
        "reserved_balance": operator.reserved_balance,
        "total_earned": operator.total_earned,
        "earned_this_week": int(earned_week),
        "season": (
            {
                "id": season.id,
                "code": season.code,
                "name": season.name,
                "starts_at": season.starts_at,
                "ends_at": season.ends_at,
            }
            if season
            else None
        ),
        "nearest_goal": nearest_goal,
    }
