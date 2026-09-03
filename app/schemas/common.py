"""Общие схемы: постраничная обёртка и простые ответы."""
from __future__ import annotations

from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


class ORMModel(BaseModel):
    """Базовая схема для сериализации объектов SQLAlchemy."""

    model_config = ConfigDict(from_attributes=True)


class Page(BaseModel, Generic[T]):
    """Страница результатов с метаданными для пагинации."""

    items: list[T]
    total: int = Field(description="Общее количество записей по фильтру")
    page: int
    size: int

    @property
    def pages(self) -> int:
        return (self.total + self.size - 1) // self.size if self.size else 0

    @classmethod
    def build(cls, items: list[T], total: int, page: int, size: int) -> Page[T]:
        return cls(items=items, total=total, page=page, size=size)


class Message(BaseModel):
    """Короткий ответ на действие без содержательного тела."""

    detail: str
    ok: bool = True
