"""Магазин бонусов для оператора (п. 4.3)."""
from __future__ import annotations

from fastapi import APIRouter, status

from app.core.deps import CurrentUser, SessionDep
from app.models.shop import ShopRequest
from app.schemas.shop import (
    ShopCatalogOut,
    ShopItemForOperator,
    ShopRequestCreate,
    ShopRequestOut,
)
from app.services import shop as shop_service

router = APIRouter(prefix="/shop", tags=["Магазин бонусов"])


@router.get("/items", response_model=ShopCatalogOut, summary="Каталог бонусов")
async def catalog(session: SessionDep, user: CurrentUser) -> ShopCatalogOut:
    """
    Каталог с ценами и расчётом доступности.

    Для каждой позиции возвращается либо ``can_buy=true``, либо причина отказа
    и сколько коинов не хватает (п. 4.3.2).
    """
    items, account, blocked = await shop_service.catalog_for_user(session, user.id)

    catalog_items: list[ShopItemForOperator] = []
    for item in items:
        missing = max(0, item.price - account.available)
        reason = blocked.get(item.id)
        if reason is None and missing > 0:
            reason = f"Нужно ещё {missing} коинов"
        catalog_items.append(
            ShopItemForOperator(
                **{
                    field: getattr(item, field)
                    for field in (
                        "id",
                        "code",
                        "title",
                        "description",
                        "price",
                        "is_active",
                        "stock_limit",
                        "per_user_monthly_limit",
                        "requires_approval",
                        "sort_order",
                    )
                },
                can_buy=reason is None,
                missing_coins=missing,
                blocked_reason=reason,
            )
        )

    return ShopCatalogOut(
        balance=account.balance, available=account.available, items=catalog_items
    )


@router.post(
    "/requests",
    response_model=ShopRequestOut,
    status_code=status.HTTP_201_CREATED,
    summary="Купить бонус (создать заявку)",
)
async def create_request(
    session: SessionDep, user: CurrentUser, payload: ShopRequestCreate
) -> ShopRequest:
    """Создаёт заявку и резервирует коины до решения супервайзера (шаг 9 п. 7)."""
    request = await shop_service.create_request(
        session, user=user, item_id=payload.item_id, comment=payload.comment
    )
    await session.commit()
    return await shop_service.get_request(session, request.id)


@router.post(
    "/requests/{request_id}/cancel",
    response_model=ShopRequestOut,
    summary="Отозвать свою заявку",
)
async def cancel_request(
    session: SessionDep, user: CurrentUser, request_id: int
) -> ShopRequest:
    request = await shop_service.get_request(session, request_id)
    await shop_service.cancel_request(session, request=request, actor=user)
    await session.commit()
    return await shop_service.get_request(session, request_id)
