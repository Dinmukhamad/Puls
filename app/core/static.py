from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parents[2]


IMMUTABLE = "public, max-age=31536000, immutable"
REVALIDATE = "no-cache, must-revalidate"


class CachedStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        if response.status_code != 200:
            return response

        if not path.endswith((".css", ".js")):
            response.headers["Cache-Control"] = IMMUTABLE
            return response

        # index.html ссылается на бандлы с ?v=<хеш содержимого>, который
        # проставляет scripts/stamp-assets.mjs. Такой URL меняется ровно при
        # изменении файла, поэтому его можно кешировать навсегда: раньше без
        # этого каждый повторный визит тратил round-trip на ревалидацию
        # каждого бандла, передавая ноль байт.
        #
        # Запрос без версии (прямое обращение, отладка) по-прежнему
        # перепроверяется — иначе можно навсегда закешировать неверный файл.
        query = scope.get("query_string") or b""
        versioned = b"v=" in query
        response.headers["Cache-Control"] = IMMUTABLE if versioned else REVALIDATE
        return response


def setup_static(app: FastAPI, settings) -> None:
    for folder in ("css", "js", "assets", "img"):
        path = ROOT / folder
        if path.exists():
            app.mount(
                f"/{folder}",
                CachedStaticFiles(directory=str(path)),
                name=folder,
            )

    index_path = ROOT / "index.html"
    api_root = settings.api_prefix.strip("/")

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        if api_root and (full_path == api_root or full_path.startswith(api_root + "/")):
            raise HTTPException(status_code=404, detail="API endpoint not found")
        return FileResponse(
            str(index_path),
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0",
            },
        )
