"""Заказ управляется географией. Виртуальное движение рассчитывает сервер отдельно."""

import json
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from uuid import uuid4

from sqlalchemy import delete

from app.core.errors import ConflictError, PermissionDeniedError
from app.db.base import utcnow
from app.models.driver import DriverOrder
from app.models.driver_navigation import DriverNavigation, DriverRouteDraft
from app.models.user import User
from app.schemas.driver_shift import DriverScenario
from app.services import driver_location, driver_maps, driver_shifts
from app.services import driver_route_math as geo


def aware(value):
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


def rules(shift):
    return DriverScenario.model_validate(shift.config if shift else {}).model_dump()


def reachable(route, a, b, radius):
    for point, end in ((a, route["coordinates"][0]), (b, route["coordinates"][-1])):
        if geo.distance(point, {"latitude": end[1], "longitude": end[0]}) > radius:
            raise driver_maps.MapUnavailable(
                "Точка слишком далеко от доступной дороги. Выберите место ближе к дороге "
                "или попробуйте пешеходный маршрут."
            )


async def check_mode(session, user_id, shift, mode):
    user = await session.get(User, user_id)
    if mode == "demo" and user.role != "admin":
        raise PermissionDeniedError("Demo Mode доступен только администратору")
    if (
        mode == "virtual"
        and shift
        and shift.mode == "assessment"
        and rules(shift)["real_location_required"]
    ):
        raise PermissionDeniedError("В этой учебной смене требуется реальная геолокация")


async def prepare(session, user_id, payload, device):
    from app.services.driver_orders import require_profile

    await require_profile(session, user_id, device)
    shift = await driver_shifts.active(session, user_id, lock=True)
    await check_mode(session, user_id, shift, payload.mode)
    config = rules(shift)
    a, b = payload.pickup.model_dump(), payload.destination.model_dump()
    if geo.distance(a, b) <= config["arrival_radius"] * 2:
        raise ConflictError("Выберите разные точки: зоны прибытия А и Б не должны пересекаться")
    if payload.mode == "real":
        driver_location.validate_pickup(payload.location, payload.pickup, utcnow())
    route = await driver_maps.route(session, a, b, payload.transport)
    reachable(route, a, b, config["arrival_radius"])
    # Черновик один на аккаунт. Предыдущая подготовка заменяется, не создавая GPS-журнал.
    await session.execute(delete(DriverRouteDraft).where(DriverRouteDraft.expires_at < utcnow()))
    draft = await session.get(DriverRouteDraft, user_id)
    if not draft:
        draft = DriverRouteDraft(user_id=user_id)
        session.add(draft)
    draft.id = str(uuid4())
    draft.expires_at = utcnow() + timedelta(minutes=20)
    draft.data = {
        "pickup": a,
        "destination": b,
        "route": route,
        "transport": payload.transport,
        "mode": payload.mode,
    }
    await session.flush()
    return {
        "id": draft.id,
        **draft.data,
        "expires_at": draft.expires_at,
        "fare": config["fare"] + round(route["distance"] / 1000 * config["fare_per_km"]),
        "arrival_radius": config["arrival_radius"],
        "status": "ROUTE_READY",
    }


async def create(session, user_id, payload, profile, device):
    from app.services import driver_orders

    if not payload.route_id:
        raise ConflictError("Обновите Puls и постройте маршрут А → Б перед началом заказа")
    draft = await session.get(DriverRouteDraft, user_id, with_for_update=True)
    if not draft or draft.id != str(payload.route_id) or aware(draft.expires_at) <= utcnow():
        raise ConflictError("Маршрут устарел или изменился. Постройте его заново")
    shift = await driver_shifts.active(session, user_id, lock=True)
    config, planned = rules(shift), deepcopy(draft.data)
    await check_mode(session, user_id, shift, planned["mode"])
    a, b, route = planned["pickup"], planned["destination"], planned["route"]
    if payload.origin != a["label"] or payload.destination != b["label"]:
        raise ConflictError("Адреса изменились после построения маршрута")
    if shift:
        driver_shifts.check_online(shift, shift.data)
        if not shift.data["online"]:
            raise ConflictError("Сначала выйдите на линию")
    if planned["mode"] == "real":
        from app.schemas.driver import DriverGeoPoint

        driver_location.validate_pickup(
            payload.location,
            DriverGeoPoint(**{k: a[k] for k in ("latitude", "longitude")}),
            utcnow(),
        )
    current = (
        payload.location.model_dump(mode="json")
        if planned["mode"] == "real"
        else {
            **{k: a[k] for k in ("latitude", "longitude")},
            "accuracy": 0,
            "captured_at": utcnow().isoformat(),
        }
    )
    fare = config["fare"] + round(route["distance"] / 1000 * config["fare_per_km"])
    fee = driver_shifts.amount(fare, config["service_percent"]) if shift else 0
    details = {
        "pickup": {k: a[k] for k in ("latitude", "longitude")},
        "base_fare": fare,
        "service_fee": fee,
        "service_tax": driver_shifts.amount(fee, config["service_tax_percent"]),
        "waiting_fee": 0,
        "tariff": shift.data["tariffs"][0] if shift else "economy",
        "route_event": bool(shift and config["route_event"] and shift.data["completed"] == 0),
        "route_changed": False,
        "navigation": {
            "version": 1,
            "route_id": str(payload.route_id),
            "mode": planned["mode"],
            "transport": planned["transport"],
            "pickup": a,
            "destination": b,
            "planned_distance": route["distance"],
            "planned_duration": route["duration"],
            "rules": {
                k: config[k]
                for k in (
                    "arrival_radius",
                    "free_wait_seconds",
                    "boarding_seconds",
                    "virtual_speed",
                )
            },
        },
    }
    preference = shift.data["payment"] if shift else "any"
    order = DriverOrder(
        id=str(payload.id),
        user_id=user_id,
        shift_id=shift.id if shift else None,
        active_slot=1,
        stage="pickup",
        origin=a["label"],
        destination=b["label"],
        payment=preference
        if preference != "any"
        else driver_orders.secrets.choice(("cash", "card")),
        fare=fare,
        commission=driver_shifts.amount(fare, profile.park["commission"]),
        park=dict(profile.park),
        details=details,
        version=0,
        events=[],
    )
    session.add(order)
    await session.flush()
    nav = DriverNavigation(
        order_id=order.id,
        route=route,
        current=current,
        data={
            "gps_available": True,
            "actual_distance": 0,
            "reroutes": 0,
            "phase": "pickup",
            "projection": geo.project(current, route),
            "paused": False,
            "pause_seconds": 0,
            "demo_advance": 0,
        },
    )
    session.add(nav)
    await session.delete(draft)
    if shift:
        data = deepcopy(shift.data)
        data["correct_park"] = profile.park["id"] == config["required_park"]
        data["demo_used"] = data.get("demo_used", False) or planned["mode"] == "demo"
        await driver_shifts.save(
            session, shift, data, "order_created", payload.id, {"mode": planned["mode"]}
        )
    await session.flush()
    return order


def signature(payload):
    value = payload.model_dump(mode="json", exclude={"location", "request_id"})
    return sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def add_event(order, action, request_id=None, *, target=None, fingerprint=None):
    order.version += 1
    if len(order.events) >= 200:
        raise ConflictError("Достигнут лимит событий заказа. Завершите или отмените заказ")
    order.events = [
        *order.events,
        {
            "request_id": str(request_id or uuid4()),
            "action": action,
            "from": order.stage,
            "to": target or order.stage,
            "at": utcnow().isoformat(),
            "fingerprint": fingerprint,
        },
    ]


def sample(order, nav, location):
    spec = order.details["navigation"]
    config, data, now = spec["rules"], deepcopy(nav.data), utcnow()
    if spec["mode"] == "real":
        if not location:
            data.update(gps_available=False, message="Нет сигнала GPS")
            nav.data = data
            return False
        age = (now - location.captured_at).total_seconds()
        if age > 30 or age < -5 or location.accuracy > config["arrival_radius"]:
            data.update(
                gps_available=False,
                message=f"Нужен свежий GPS с точностью не хуже ±{config['arrival_radius']} м",
            )
            nav.data = data
            return False
        current = location.model_dump(mode="json")
        old = nav.current
        if old:
            delta = (
                location.captured_at - datetime.fromisoformat(old["captured_at"])
            ).total_seconds()
            moved = geo.distance(old, current)
            if (
                delta < 0
                or (delta == 0 and moved > 1)
                or moved > max(0, delta) * 65 + old["accuracy"] + location.accuracy + 15
            ):
                data.update(
                    gps_available=False,
                    message="GPS резко изменился. Дождитесь следующего определения позиции",
                )
                nav.data = data
                return False
            if (
                order.stage == "trip"
                and 0 < delta <= 120
                and moved > max(5, min(old["accuracy"], location.accuracy) / 2)
            ):
                data["actual_distance"] += moved
    else:
        started = (
            datetime.fromisoformat(data["virtual_started_at"])
            if data.get("virtual_started_at")
            else aware(order.stage_started_at)
        )
        elapsed = max(0, (now - started).total_seconds() - data.get("pause_seconds", 0))
        if data.get("paused"):
            elapsed = data.get("paused_elapsed", 0)
        meters = elapsed * config["virtual_speed"] + data.get("demo_advance", 0)
        p = geo.along(nav.route, meters) if order.stage == "trip" else spec["pickup"]
        current = {
            "latitude": p["latitude"],
            "longitude": p["longitude"],
            "accuracy": 0,
            "captured_at": now.isoformat(),
        }
        if order.stage == "trip":
            data["actual_distance"] = data.get("virtual_offset", 0) + min(
                nav.route["distance"], meters
            )
    data.update(gps_available=True, message="", projection=geo.project(current, nav.route))
    nav.current, nav.data = current, data
    target = spec["pickup"] if order.stage in ("pickup", "waiting") else spec["destination"]
    if (
        order.stage in ("pickup", "trip")
        and geo.distance(current, target) <= config["arrival_radius"]
    ):
        event = "reached_pickup" if order.stage == "pickup" else "reached_destination"
        if not any(x["action"] == event for x in order.events):
            add_event(order, event)
    return True


def public(order, nav):
    if not nav:
        return None
    spec, now = order.details["navigation"], utcnow()
    age = (
        (now - datetime.fromisoformat(nav.current["captured_at"])).total_seconds()
        if nav.current
        else 999
    )
    available = nav.data.get("gps_available", False) and (
        spec["mode"] != "real"
        or (-5 <= age <= 30 and nav.current["accuracy"] <= spec["rules"]["arrival_radius"])
    )
    target = spec["pickup"] if order.stage in ("pickup", "waiting") else spec["destination"]
    distance = geo.distance(nav.current, target) if nav.current else None
    reached = available and distance is not None and distance <= spec["rules"]["arrival_radius"]
    elapsed = max(0, (now - aware(order.stage_started_at)).total_seconds())
    can_start = (
        order.stage == "waiting" and reached and elapsed >= spec["rules"]["boarding_seconds"]
    )
    status = "TO_PICKUP" if order.stage == "pickup" else "IN_RIDE"
    if reached:
        status = "ARRIVED_AT_PICKUP" if order.stage == "pickup" else "ARRIVED_AT_DESTINATION"
    if order.stage == "waiting":
        status = "WAITING_FREE" if elapsed < spec["rules"]["free_wait_seconds"] else "WAITING_PAID"
    if not available:
        status = "GPS_LOST"
    if nav.data.get("paused"):
        status = "PAUSED"
    return {
        "order_id": order.id,
        "status": status,
        "mode": spec["mode"],
        "route": nav.route,
        "current": nav.current,
        "gps_available": available,
        "message": nav.data.get("message", ""),
        "distance_to_target": distance,
        "can_arrive": reached and order.stage == "pickup",
        "can_start": can_start,
        "can_finish": reached and order.stage == "trip" and not nav.data.get("paused"),
        "wait_seconds": elapsed if order.stage == "waiting" else 0,
        "free_wait_seconds": spec["rules"]["free_wait_seconds"],
        "boarding_seconds": spec["rules"]["boarding_seconds"],
        "arrival_radius": spec["rules"]["arrival_radius"],
        **{k: nav.data.get(k) for k in ("projection", "actual_distance", "reroutes")},
    }


async def position(session, order, location, *, recalculate=True):
    nav = await session.get(DriverNavigation, order.id, with_for_update=True)
    if not nav or order.stage not in ("pickup", "waiting", "trip"):
        return
    valid = sample(order, nav, location)
    spec = order.details["navigation"]
    if valid and recalculate and spec["mode"] == "real" and order.stage in ("pickup", "trip"):
        target = spec["pickup"] if order.stage == "pickup" else spec["destination"]
        off_route = nav.data["projection"]["off_route"] > max(100, nav.current["accuracy"] * 2)
        needs_pickup = order.stage == "pickup" and nav.data["phase"] != "approach"
        last = datetime.fromisoformat(nav.data.get("rerouted_at", "2000-01-01T00:00:00+00:00"))
        if (
            (off_route or needs_pickup)
            and geo.distance(nav.current, target) > spec["rules"]["arrival_radius"]
            and (utcnow() - last).total_seconds() >= 30
        ):
            data = deepcopy(nav.data)
            data["rerouted_at"] = utcnow().isoformat()
            try:
                route = await driver_maps.route(session, nav.current, target, spec["transport"])
                reachable(route, nav.current, target, spec["rules"]["arrival_radius"])
                nav.route = route
                data.update(
                    phase="approach" if order.stage == "pickup" else "trip",
                    reroutes=data["reroutes"] + 1,
                    projection=geo.project(nav.current, route),
                    message="Маршрут перестроен",
                )
                if len(order.events) < 180:
                    add_event(order, "route_recalculated")
            except driver_maps.MapUnavailable:
                data["message"] = (
                    "Не удалось перестроить маршрут. Повторим после восстановления сервиса."
                )
            nav.data = data
    order.version += 1
    await session.flush()


async def action(session, order, payload):
    nav = await session.get(DriverNavigation, order.id, with_for_update=True)
    if not nav:
        raise ConflictError("Этот заказ уже завершён")
    if payload.action == "cancel":
        if order.stage not in ("pickup", "waiting", "trip"):
            raise ConflictError("Этот заказ нельзя отменить")
        add_event(order, "cancel", payload.request_id, target="cancelled")
        order.stage, order.active_slot, order.finished_at = "cancelled", None, utcnow()
        order.version += 1
        await session.delete(nav)
        await driver_shifts.record_order(session, order, "cancel")
        return
    transitions = {
        "arrive": ("pickup", "waiting", "can_arrive"),
        "start_trip": ("waiting", "trip", "can_start"),
        "finish": ("trip", "complete", "can_finish"),
    }
    if payload.action not in transitions or order.stage != transitions[payload.action][0]:
        raise ConflictError("Действие недоступно на текущем этапе заказа")
    if not sample(order, nav, payload.location):
        raise ConflictError(nav.data["message"])
    info = public(order, nav)
    _, target, allowed = transitions[payload.action]
    if not info[allowed]:
        raise ConflictError(
            "Дождитесь пассажира и оставайтесь в зоне подачи"
            if payload.action == "start_trip"
            else "Подойдите к нужной точке маршрута. Прибытие проверяется по GPS"
        )
    details = deepcopy(order.details)
    if payload.action == "start_trip":
        spec = details["navigation"]
        # После подачи основным снова становится построенный маршрут А → Б.
        if nav.data["phase"] == "approach":
            nav.route = await driver_maps.route(
                session, spec["pickup"], spec["destination"], spec["transport"]
            )
        wait = int((utcnow() - aware(order.stage_started_at)).total_seconds())
        shift = await driver_shifts.active(session, order.user_id, lock=True)
        config = rules(shift)
        details["waiting_fee"] = (
            max(0, wait - spec["rules"]["free_wait_seconds"]) // 60 * config["wait_per_minute"]
        )
        spec["wait_seconds"] = wait
        order.fare = details["base_fare"] + details["waiting_fee"]
        details["service_fee"] = (
            driver_shifts.amount(order.fare, config["service_percent"]) if shift else 0
        )
        details["service_tax"] = driver_shifts.amount(
            details["service_fee"], config["service_tax_percent"]
        )
        order.commission = driver_shifts.amount(order.fare, order.park["commission"])
        nav.data = {
            **nav.data,
            "phase": "trip",
            "actual_distance": 0,
            "pause_seconds": 0,
            "demo_advance": 0,
        }
    if payload.action == "finish":
        spec = details["navigation"]
        spec.update(
            actual_distance=round(nav.data["actual_distance"]),
            trip_seconds=int((utcnow() - aware(order.stage_started_at)).total_seconds()),
            reroutes=nav.data["reroutes"],
        )
        order.active_slot, order.finished_at = None, utcnow()
        await session.delete(nav)
    add_event(order, payload.action, payload.request_id, target=target)
    order.stage, order.stage_started_at, order.details = target, utcnow(), details
    order.version += 1
    if target == "complete":
        spec = details["navigation"]
        checks = [
            ("route", "Маршрут построен", 10),
            ("pickup", "Точка А определена", 5),
            ("created", "Заказ начат", 5),
            ("reached_pickup", "Прибытие в А", 10),
            ("arrive", "Ожидание пассажира", 10),
            ("start_trip", "Поездка начата", 20),
            ("reached_destination", "Достижение Б", 15),
            ("finish", "Завершение заказа", 10),
            ("situations", "Учебные ситуации", 15),
        ]
        events = {x["action"] for x in order.events}
        spec["result"] = [
            {
                "key": key,
                "title": title,
                "weight": weight,
                "done": key in events
                or key in ("route", "pickup", "created")
                or (
                    key == "situations" and (not details["route_event"] or details["route_changed"])
                ),
            }
            for key, title, weight in checks
        ]
        spec["score"] = (
            sum(x["weight"] for x in spec["result"] if x["done"])
            if spec["mode"] == "real"
            else None
        )
        order.details = deepcopy(details)
        await driver_shifts.record_order(session, order, "pay")


async def destination(session, order, payload):
    if not (order.details or {}).get("navigation") or order.stage != "trip":
        raise ConflictError("Изменение точки Б доступно во время поездки")
    previous = next((x for x in order.events if x["request_id"] == str(payload.request_id)), None)
    if previous:
        if previous["action"] != "route_changed" or previous.get("fingerprint") != signature(
            payload
        ):
            raise ConflictError("Этот запрос уже использован")
        return
    nav = await session.get(DriverNavigation, order.id, with_for_update=True)
    if not sample(order, nav, payload.location):
        raise ConflictError(nav.data["message"])
    details, target = deepcopy(order.details), payload.destination.model_dump()
    spec = details["navigation"]
    if geo.distance(spec["pickup"], target) <= spec["rules"]["arrival_radius"] * 2:
        raise ConflictError("Точка Б слишком близка к подаче")
    route = await driver_maps.route(session, nav.current, target, spec["transport"])
    reachable(route, nav.current, target, spec["rules"]["arrival_radius"])
    nav.route = route
    nav.data = {
        **nav.data,
        "phase": "trip",
        "projection": geo.project(nav.current, route),
        "reroutes": nav.data["reroutes"] + 1,
        "rerouted_at": utcnow().isoformat(),
    }
    # Виртуальная машина продолжает с новой точки, а не переносится вперёд
    # на всё время, которое уже прошло до изменения маршрута.
    if spec["mode"] != "real":
        nav.data.update(
            virtual_offset=nav.data["actual_distance"],
            virtual_started_at=utcnow().isoformat(),
            pause_seconds=0,
            demo_advance=0,
            paused=False,
        )
    details["route_changed"], spec["destination"] = True, target
    spec["planned_distance"] = round(nav.data["actual_distance"] + route["distance"], 1)
    spec["planned_duration"] = round(
        (utcnow() - aware(order.stage_started_at)).total_seconds() + route["duration"], 1
    )
    # Новый адрес требует нового события фактического достижения.
    order.events = [x for x in order.events if x["action"] != "reached_destination"]
    order.destination, order.details = target["label"], details
    add_event(order, "route_changed", payload.request_id, fingerprint=signature(payload))
    order.version += 1
    if order.shift_id:
        shift = await driver_shifts.active(session, order.user_id, lock=True)
        await driver_shifts.save(
            session,
            shift,
            {**shift.data, "route_changed": True},
            "route_change",
            payload.request_id,
            {"destination": target["label"]},
        )


async def demo(session, order, user, payload):
    spec = (order.details or {}).get("navigation")
    if not spec or spec["mode"] == "real" or order.stage != "trip":
        raise PermissionDeniedError("Реальное движение нельзя заменить симуляцией")
    if payload.action == "advance" and (spec["mode"] != "demo" or user.role != "admin"):
        raise PermissionDeniedError(
            "Перемещение вручную доступно только администратору в Demo Mode"
        )
    previous = next((x for x in order.events if x["request_id"] == str(payload.request_id)), None)
    name = "demo_" + payload.action
    if previous:
        if previous["action"] != name or previous.get("fingerprint") != signature(payload):
            raise ConflictError("Этот запрос уже использован")
        return
    nav = await session.get(DriverNavigation, order.id, with_for_update=True)
    data, now = deepcopy(nav.data), utcnow()
    started = (
        datetime.fromisoformat(data["virtual_started_at"])
        if data.get("virtual_started_at")
        else aware(order.stage_started_at)
    )
    elapsed = max(0, (now - started).total_seconds() - data.get("pause_seconds", 0))
    if payload.action == "pause" and not data.get("paused"):
        data.update(paused=True, paused_at=now.isoformat(), paused_elapsed=elapsed)
    elif payload.action == "resume" and data.get("paused"):
        data.update(
            paused=False,
            pause_seconds=data.get("pause_seconds", 0)
            + (now - datetime.fromisoformat(data["paused_at"])).total_seconds(),
        )
    elif payload.action == "advance":
        data["demo_advance"] = data.get("demo_advance", 0) + payload.meters
    nav.data = data
    sample(order, nav, None)
    add_event(order, name, payload.request_id, fingerprint=signature(payload))
    order.version += 1
