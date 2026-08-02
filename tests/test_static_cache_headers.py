"""Кеширование бандлов: версионированный URL — навсегда, голый — с проверкой.

index.html ссылается на бандлы с ?v=<хеш содержимого> (scripts/stamp-assets.mjs).
Такой адрес меняется ровно тогда, когда меняется файл, поэтому его можно отдать
как immutable. Раньше все .css/.js шли с no-cache: версионирование в query
существовало, но не работало, и каждый повторный визит тратил round-trip на
ревалидацию каждого бандла при нулевом объёме переданных данных.

Голый URL без версии обязан остаться перепроверяемым: иначе отладочное
обращение к js/app.js закешировалось бы навсегда.
"""
from __future__ import annotations

IMMUTABLE = "public, max-age=31536000, immutable"


def test_versioned_bundle_is_cached_forever(client):
    response = client.get("/css/tokens.css?v=deadbeef1234")
    assert response.status_code == 200
    assert response.headers["cache-control"] == IMMUTABLE


def test_bare_bundle_is_revalidated(client):
    response = client.get("/css/tokens.css")
    assert response.status_code == 200
    assert "no-cache" in response.headers["cache-control"]


def test_index_html_is_never_cached(client):
    """index.html держит ссылки на хеши, поэтому сам кешироваться не должен —
    иначе новый деплой не подхватится."""
    response = client.get("/some/spa/route")
    assert response.status_code == 200
    assert "no-store" in response.headers["cache-control"]


def test_index_html_points_at_versioned_minified_bundles(client):
    html = client.get("/").text
    for asset in ("css/styles.min.css", "js/api.min.js", "js/app.min.js"):
        assert f'{asset}?v=' in html, f"index.html не ссылается на {asset} с версией"
    # Неминифицированные бандлы остаются в репозитории для отладки, но в
    # браузер грузиться не должны.
    assert 'src="js/app.js?' not in html
    assert 'href="css/styles.css?' not in html


def test_every_asset_from_index_html_is_actually_served(client):
    """Ловит ситуацию, когда index.html ссылается на файл, которого нет в
    образе. Деплой (python:3.13-slim, без Node) фронтенд не собирает — он
    копирует js/ и css/ как есть, поэтому .min-артефакты обязаны лежать в
    репозитории. Один неверный .gitignore — и продакшн отдаёт 404 на весь
    JS и CSS, а тесты при этом зелёные, потому что в CI файлы создаёт сборка.
    """
    import re
    import subprocess

    html = client.get("/").text
    assets = re.findall(r'(?:href|src)="((?:css|js)/[^"?]+)', html)
    assert assets, "в index.html не нашлось ни одного локального ассета"

    for asset in assets:
        response = client.get(f"/{asset}")
        assert response.status_code == 200, f"{asset} не отдаётся сервером"

    # Файл может существовать локально, но быть исключён из git — в образ он
    # тогда не попадёт. git check-ignore возвращает 0, если путь игнорируется.
    ignored = subprocess.run(
        ["git", "check-ignore", *assets],
        capture_output=True, text=True, cwd=str(_repo_root()),
    )
    assert ignored.returncode != 0, (
        f"эти ассеты исключены из git и не попадут в образ: {ignored.stdout.strip()}"
    )


def _repo_root():
    from pathlib import Path
    return Path(__file__).resolve().parents[1]
