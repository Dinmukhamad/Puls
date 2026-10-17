"""Profile images are fetched separately from user lists and authentication."""

from pydantic import BaseModel


class AvatarOut(BaseModel):
    image: str | None = None
