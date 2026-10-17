"""Bound, decode and normalize uploads before saving a private avatar."""

import base64
import warnings
from io import BytesIO

from fastapi import UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.core.errors import DomainError
from app.models.avatar import UserAvatar
from app.models.enums import USER_VISIBILITY, Role
from app.models.user import User
from app.schemas.avatar import AvatarOut
from app.services.rules import write_audit

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_IMAGE_PIXELS = 16_000_000
MAX_IMAGE_SIDE = 8192
AVATAR_SIDE = 256
_FORMATS = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}
_INVALID = "Выберите обычное изображение JPG, PNG или WebP без анимации"


def _normalize(data: bytes, mime: str) -> bytes:
    """Validate the complete image, then re-encode pixels without source metadata."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data), formats=list(_FORMATS.values())) as source:
                if source.format != _FORMATS[mime] or getattr(source, "n_frames", 1) != 1:
                    raise DomainError(_INVALID, code="avatar_invalid")
                width, height = source.size
                if (
                    width * height > MAX_IMAGE_PIXELS
                    or max(width, height) > MAX_IMAGE_SIDE
                    or min(width, height) < 1
                ):
                    raise DomainError(
                        "Изображение слишком большое. Выберите фото до 16 мегапикселей",
                        code="avatar_dimensions",
                    )
                source.verify()
            with Image.open(BytesIO(data), formats=list(_FORMATS.values())) as source:
                oriented = ImageOps.exif_transpose(source)
                square = ImageOps.fit(
                    oriented.convert("RGBA"),
                    (AVATAR_SIDE, AVATAR_SIDE),
                    method=Image.Resampling.LANCZOS,
                )
                # New pixel buffer drops EXIF, GPS, ICC and comments from every source format.
                clean = Image.frombytes(square.mode, square.size, square.tobytes())
                output = BytesIO()
                clean.save(output, format="WEBP", quality=85, method=4)
                result = output.getvalue()
                if len(result) > 256 * 1024:
                    raise DomainError(_INVALID, code="avatar_invalid")
                return result
    except DomainError:
        raise
    except (
        UnidentifiedImageError,
        OSError,
        SyntaxError,
        ValueError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ) as exc:
        raise DomainError(_INVALID, code="avatar_invalid") from exc


async def read_upload(file: UploadFile) -> bytes:
    try:
        if file.content_type not in _FORMATS:
            raise DomainError(_INVALID, code="avatar_invalid")
        data = await file.read(MAX_UPLOAD_BYTES + 1)
        if len(data) > MAX_UPLOAD_BYTES:
            raise DomainError("Размер фото — не больше 5 МБ", code="avatar_too_large")
        if not data:
            raise DomainError(_INVALID, code="avatar_invalid")
        return await run_in_threadpool(_normalize, data, file.content_type)
    finally:
        await file.close()


def output(data: bytes | None) -> AvatarOut:
    if data is None:
        return AvatarOut()
    encoded = base64.b64encode(data).decode("ascii")
    return AvatarOut(image=f"data:image/webp;base64,{encoded}")


async def get_avatar(session: AsyncSession, actor: User, user_id: int) -> AvatarOut:
    # Own identity always works. Shared photos follow existing role visibility;
    # operators additionally see active operators who can appear in their rating.
    shared_roles = (
        (Role.OPERATOR,) if actor.role == Role.OPERATOR
        else USER_VISIBILITY[Role(actor.role)]
    )
    data = await session.scalar(
        select(UserAvatar.data)
        .join(User, User.id == UserAvatar.user_id)
        .where(
            UserAvatar.user_id == user_id,
            User.is_active.is_(True),
            (User.id == actor.id) | User.role.in_(shared_roles),
        )
    )
    return output(data)


async def set_avatar(
    session: AsyncSession, actor: User, target: User, data: bytes | None
) -> AvatarOut:
    # Serialize replace/delete even when there is no avatar row to lock yet.
    await session.refresh(target, with_for_update=True)
    existing = await session.get(UserAvatar, target.id)
    if data is None:
        if existing is not None:
            await session.delete(existing)
    elif existing is None:
        session.add(UserAvatar(user_id=target.id, data=data))
    else:
        existing.data = data
    await write_audit(
        session,
        actor_id=actor.id,
        action="user.avatar_delete" if data is None else "user.avatar_upload",
        entity_type="user",
        entity_id=target.id,
    )
    await session.commit()
    return output(data)
