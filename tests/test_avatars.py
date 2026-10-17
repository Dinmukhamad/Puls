"""Private, persistent images and avatar-specific management permissions."""

import base64
from io import BytesIO

import pytest
from PIL import Image
from sqlalchemy import func, select

from app.db.session import SessionLocal, engine
from app.models.avatar import UserAvatar
from app.models.enums import Role
from app.models.settings import AuditLog
from app.services import avatars
from tests.conftest import auth, login, make_user

API = "/api/v1"


def image_file(color="red", format="PNG", size=(400, 200), **options):
    buffer = BytesIO()
    Image.new("RGB", size, color).save(buffer, format, **options)
    mime = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}[format]
    return (f"photo.{format.lower()}", buffer.getvalue(), mime)


def decoded_image(response):
    value = response.json()["image"]
    assert value.startswith("data:image/webp;base64,")
    return Image.open(BytesIO(base64.b64decode(value.split(",", 1)[1])))


async def test_upload_is_normalized_durable_replaced_and_deleted(client, session, operator):
    headers = auth(await login(client, operator.login))
    missing = await client.get(f"{API}/auth/avatars/{operator.id}", headers=headers)
    assert missing.json() == {"image": None}
    exif = Image.Exif()
    exif[0x010E] = "private source description"
    uploaded = await client.put(
        f"{API}/auth/avatar", headers=headers, files={"file": image_file(format="JPEG", exif=exif)}
    )
    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.headers["cache-control"] == "private, no-store"
    image = decoded_image(uploaded)
    assert image.format == "WEBP" and image.size == (256, 256)
    assert not image.getexif() and "icc_profile" not in image.info
    image.load()
    assert image.getpixel((128, 128))[0] > 200
    assert (await client.get(f"{API}/auth/me", headers=headers)).json().get("image") is None

    # Dispose pooled connections and read in a fresh session: no temporary file or process cache.
    await engine.dispose()
    async with SessionLocal() as fresh:
        row = await fresh.get(UserAvatar, operator.id)
        assert row is not None
        assert len(row.data) < 256 * 1024
        assert b"private source description" not in row.data
        logs = (await fresh.scalars(select(AuditLog))).all()
        avatar_logs = [log for log in logs if log.action == "user.avatar_upload"]
        assert len(avatar_logs) == 1
        assert avatar_logs[0].payload is None
    assert (
        await client.get(f"{API}/auth/avatars/{operator.id}", headers=headers)
    ).json() == uploaded.json()
    replaced = await client.put(
        f"{API}/auth/avatar", headers=headers, files={"file": image_file("blue", format="WEBP")}
    )
    assert replaced.status_code == 200
    assert decoded_image(replaced).getpixel((128, 128))[2] > 200
    async with SessionLocal() as fresh:
        assert await fresh.scalar(select(func.count()).select_from(UserAvatar)) == 1
    deleted = await client.delete(f"{API}/auth/avatar", headers=headers)
    assert deleted.status_code == 200 and deleted.json() == {"image": None}
    assert (
        await client.get(f"{API}/auth/avatars/{operator.id}", headers=headers)
    ).json() == {"image": None}
    # Removing an absent image remains safe and repeatable.
    assert (await client.delete(f"{API}/auth/avatar", headers=headers)).status_code == 200


async def test_rotated_phone_photo_uses_exif_orientation(client, operator):
    source = Image.new("RGB", (400, 200), "red")
    source.paste("blue", (200, 0, 400, 200))
    exif = Image.Exif()
    exif[0x0112] = 6
    buffer = BytesIO()
    source.save(buffer, "JPEG", exif=exif)
    response = await client.put(
        f"{API}/auth/avatar", headers=auth(await login(client, operator.login)),
        files={"file": ("phone.jpg", buffer.getvalue(), "image/jpeg")},
    )
    assert response.status_code == 200, response.text
    image = decoded_image(response)
    assert image.getpixel((128, 20))[0] > 200
    assert image.getpixel((128, 235))[2] > 200


@pytest.mark.parametrize(
    "file",
    [
        ("empty.png", b"", "image/png"),
        ("broken.png", b"not an image", "image/png"),
        ("script.svg", b'<svg xmlns="http://www.w3.org/2000/svg"/>', "image/svg+xml"),
        ("spoof.png", b"<script>alert(1)</script>", "image/png"),
        ("mismatch.jpg", image_file()[1], "image/jpeg"),
        ("cut.png", image_file()[1][:50], "image/png"),
    ],
)
async def test_invalid_images_leave_existing_avatar_intact(client, operator, file):
    headers = auth(await login(client, operator.login))
    original = await client.put(
        f"{API}/auth/avatar", headers=headers, files={"file": image_file()}
    )
    response = await client.put(f"{API}/auth/avatar", headers=headers, files={"file": file})
    assert response.status_code == 400, response.text
    assert response.json()["code"] == "avatar_invalid"
    assert (
        await client.get(f"{API}/auth/avatars/{operator.id}", headers=headers)
    ).json() == original.json()


async def test_large_animated_and_excessive_dimensions_are_rejected(client, operator, monkeypatch):
    headers = auth(await login(client, operator.login))
    oversized = await client.put(
        f"{API}/auth/avatar", headers=headers,
        files={"file": ("huge.png", b"x" * (avatars.MAX_UPLOAD_BYTES + 1), "image/png")},
    )
    assert oversized.status_code == 400
    assert oversized.json()["code"] == "avatar_too_large"
    buffer = BytesIO()
    Image.new("RGB", (32, 32), "red").save(
        buffer, "PNG", save_all=True, append_images=[Image.new("RGB", (32, 32), "blue")]
    )
    animated = await client.put(
        f"{API}/auth/avatar", headers=headers,
        files={"file": ("animated.png", buffer.getvalue(), "image/png")},
    )
    assert animated.status_code == 400 and animated.json()["code"] == "avatar_invalid"
    monkeypatch.setattr(avatars, "MAX_IMAGE_PIXELS", 100)
    dimensions = await client.put(
        f"{API}/auth/avatar", headers=headers, files={"file": image_file()}
    )
    assert dimensions.status_code == 400 and dimensions.json()["code"] == "avatar_dimensions"


async def test_authenticated_identity_reads_hide_missing_and_disabled_accounts(client, session):
    target = await make_user(session, login="avatar-subject")
    token = auth(await login(client, target.login))
    await client.put(f"{API}/auth/avatar", headers=token, files={"file": image_file()})
    for role in (Role.OPERATOR, Role.TRAINEE, Role.TRAINER):
        viewer = await make_user(session, login=f"viewer-{role}", role=role)
        headers = auth(await login(client, viewer.login))
        fetched = await client.get(f"{API}/auth/avatars/{target.id}", headers=headers)
        assert fetched.status_code == 200, fetched.text
        assert (fetched.json()["image"] is None) == (role == Role.TRAINEE)
        assert fetched.headers["cache-control"] == "private, no-store"
        assert (await client.get(f"{API}/auth/avatars/999999", headers=headers)).json() == {
            "image": None
        }
    target.is_active = False
    await session.commit()
    assert (await client.get(f"{API}/auth/avatars/{target.id}", headers=headers)).json() == {
        "image": None
    }
    assert (await client.get(f"{API}/auth/avatars/{target.id}")).status_code == 401


async def test_shared_images_respect_role_visibility(client, session, operator, head):
    trainee = await make_user(session, login="private-trainee", role=Role.TRAINEE)
    admin = await make_user(session, login="private-admin", role=Role.ADMIN)
    trainer = await make_user(session, login="viewer-trainer", role=Role.TRAINER)
    for target in (trainee, admin, head):
        headers = auth(await login(client, target.login))
        assert (
            await client.put(f"{API}/auth/avatar", headers=headers, files={"file": image_file()})
        ).status_code == 200
    operator_headers = auth(await login(client, operator.login))
    for hidden in (trainee, admin, head):
        response = await client.get(f"{API}/auth/avatars/{hidden.id}", headers=operator_headers)
        assert response.status_code == 200 and response.json() == {"image": None}
    trainer_headers = auth(await login(client, trainer.login))
    assert (
        await client.get(f"{API}/auth/avatars/{trainee.id}", headers=trainer_headers)
    ).json()["image"] is not None
    assert (
        await client.get(f"{API}/auth/avatars/{head.id}", headers=trainer_headers)
    ).json() == {"image": None}
    head_headers = auth(await login(client, head.login))
    assert (
        await client.get(f"{API}/auth/avatars/{admin.id}", headers=head_headers)
    ).json() == {"image": None}


async def test_self_service_includes_trainee_and_trainer(client, session):
    for role in (Role.TRAINEE, Role.TRAINER):
        user = await make_user(session, login=f"own-{role}", role=role)
        headers = auth(await login(client, user.login))
        result = await client.put(
            f"{API}/auth/avatar", headers=headers, files={"file": image_file()}
        )
        assert result.status_code == 200, result.text
        assert (
            await client.get(f"{API}/auth/avatars/{user.id}", headers=headers)
        ).json() == result.json()
        assert (await client.delete(f"{API}/auth/avatar", headers=headers)).json() == {
            "image": None
        }


async def test_staff_can_manage_learners_only_and_operator_cannot_change_other_users(
    client, session, head, operator, developer
):
    trainee = await make_user(session, login="staff-avatar-trainee", role=Role.TRAINEE)
    admin = await make_user(session, login="avatar-admin", role=Role.ADMIN)
    for actor in (head, admin):
        headers = auth(await login(client, actor.login))
        for target in (operator, trainee):
            path = f"{API}/admin/users/{target.id}/avatar"
            created = await client.put(path, headers=headers, files={"file": image_file()})
            assert created.status_code == 200, created.text
            assert created.headers["cache-control"] == "private, no-store"
            assert (await client.delete(path, headers=headers)).json() == {"image": None}
    operator_headers = auth(await login(client, operator.login))
    target_path = f"{API}/admin/users/{trainee.id}/avatar"
    assert (
        await client.put(target_path, headers=operator_headers, files={"file": image_file()})
    ).status_code == 403
    assert (await client.delete(target_path, headers=operator_headers)).status_code == 403
    admin_headers = auth(await login(client, admin.login))
    protected = await client.put(
        f"{API}/admin/users/{developer.id}/avatar", headers=admin_headers,
        files={"file": image_file()},
    )
    assert protected.status_code == 403 and protected.json()["code"] == "developer_required"
    staff_target = await client.put(
        f"{API}/admin/users/{head.id}/avatar", headers=admin_headers,
        files={"file": image_file()},
    )
    assert staff_target.status_code == 403


async def test_trainer_and_supervisor_cannot_mutate_user_profiles(
    client, session, supervisor, operator
):
    trainer = await make_user(session, login="avatar-trainer", role=Role.TRAINER)
    for actor in (trainer, supervisor):
        headers = auth(await login(client, actor.login))
        path = f"{API}/admin/users/{operator.id}/avatar"
        assert (
            await client.put(path, headers=headers, files={"file": image_file()})
        ).status_code == 403
        assert (await client.delete(path, headers=headers)).status_code == 403
