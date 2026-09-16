"""Identity visibility for secondary response fields, beyond user directories."""

from app.models.enums import USER_VISIBILITY, Role
from app.models.user import User


def identity_filter(viewer, entity=User):
    return (entity.id == viewer.id) | entity.role.in_(USER_VISIBILITY[Role(viewer.role)])


def can_identify(viewer, target):
    return target is not None and (
        target.id == viewer.id or target.role in USER_VISIBILITY[Role(viewer.role)]
    )


def shop_request_output(request, viewer):
    from app.schemas.shop import ShopRequestOut

    data = ShopRequestOut.model_validate(request)
    for field in ("user", "decided_by"):
        if not can_identify(viewer, getattr(request, field)):
            setattr(data, field, None)
    return data
