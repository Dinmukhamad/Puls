"""Проверка точки подачи относительно свежей геопозиции браузера."""

from math import asin, cos, radians, sin, sqrt

from app.core.errors import ConflictError

PICKUP_RADIUS_METERS = 500
MAX_ACCURACY_METERS = 200
MAX_AGE_SECONDS = 30


def distance_meters(a, b):
    latitude = radians(b.latitude - a.latitude)
    longitude = radians(b.longitude - a.longitude)
    h = (
        sin(latitude / 2) ** 2
        + cos(radians(a.latitude)) * cos(radians(b.latitude)) * sin(longitude / 2) ** 2
    )
    return 6371000 * 2 * asin(sqrt(min(1, max(0, h))))


def validate_pickup(location, pickup, now):
    if location is None or pickup is None:
        raise ConflictError(
            "Для нового заказа обновите Puls, разрешите геолокацию и выберите подачу рядом с вами"
        )
    age = (now - location.captured_at).total_seconds()
    if age > MAX_AGE_SECONDS or age < -5:
        raise ConflictError("Геопозиция устарела. Обновите местоположение перед началом заказа")
    if location.accuracy > MAX_ACCURACY_METERS:
        raise ConflictError("Недостаточная точность геопозиции. Включите точное местоположение")
    distance = distance_meters(location, pickup)
    if distance + location.accuracy > PICKUP_RADIUS_METERS:
        raise ConflictError(
            "Точка подачи должна быть в пределах 500 м от вас с учётом точности GPS"
        )
    # Сохраняем точку заказа, но не поток местоположений оператора.
    return pickup.model_dump()
