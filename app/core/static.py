from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parents[2]


class CachedStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            if path.endswith((".css", ".js")):
                response.headers["Cache-Control"] = "no-cache, must-revalidate"
            else:
                response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
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
