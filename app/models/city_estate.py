"""Team district land (docs/CITY_ESTATES.md): buildings on plots, shared projects and their history.

Coins are never stored here: every payment, contribution and refund is an entry of the coin journal
(`coin_transactions`), and these tables keep only references to it. Taken plots (and cells of the
public square) are rows with a composite primary key, so the database itself refuses two buildings
(or a project) on one plot.
"""

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, utcnow


class CityObject(Base):
    """A building on district land or in its owner's inventory; the district's own if no owner.

    Its place is (module, u, v): on plots the block, column and row of its first plot; module 0 is
    the public square, where the district's own buildings stand on cells.
    """

    __tablename__ = "city_objects"
    __table_args__ = (
        Index("ix_city_objects_district_state", "district_id", "state"),
        Index("ix_city_objects_owner_state", "owner_id", "state"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    district_id: Mapped[str] = mapped_column(String(32))
    owner_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    family: Mapped[str] = mapped_column(String(16))
    level: Mapped[int] = mapped_column(default=1)
    #: placed, stored (in the inventory), consumed (merged into a park), archived.
    state: Mapped[str] = mapped_column(String(10))
    module: Mapped[int | None] = mapped_column(nullable=True)
    u: Mapped[int | None] = mapped_column(nullable=True)
    v: Mapped[int | None] = mapped_column(nullable=True)
    #: Quarter turns, 0…3; on plots only a big park turns (1: two columns, three rows).
    rotation: Mapped[int] = mapped_column(default=0)
    #: purchase, merge, project, legacy.
    source: Mapped[str] = mapped_column(String(10))
    #: Coins the owner paid for it so far, land and upgrades included; a park keeps its squares'.
    paid: Mapped[int] = mapped_column(default=0)
    components: Mapped[list | None] = mapped_column(JSON, nullable=True)
    consumed_by: Mapped[int | None] = mapped_column(ForeignKey("city_objects.id"), nullable=True)
    #: The economy revision of the prices it was bought at.
    economy_revision: Mapped[int] = mapped_column(default=0)
    version: Mapped[int] = mapped_column(default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class CityProject(Base):
    """A district's shared goal on its public land, with an estimate fixed when it opens."""

    __tablename__ = "city_projects"
    id: Mapped[int] = mapped_column(primary_key=True)
    district_id: Mapped[str] = mapped_column(String(32), index=True)
    family: Mapped[str] = mapped_column(String(16))
    #: The level it builds: 1 for a new building, the next level when `target_id` is upgraded.
    level: Mapped[int] = mapped_column(default=1)
    target_id: Mapped[int | None] = mapped_column(ForeignKey("city_objects.id"), nullable=True)
    module: Mapped[int | None] = mapped_column(nullable=True)
    u: Mapped[int | None] = mapped_column(nullable=True)
    v: Mapped[int | None] = mapped_column(nullable=True)
    rotation: Mapped[int] = mapped_column(default=0)
    #: main or small: a district has at most one open project of each.
    size: Mapped[str] = mapped_column(String(8))
    cost: Mapped[int]
    funded: Mapped[int] = mapped_column(default=0)
    #: open, built, cancelled.
    status: Mapped[str] = mapped_column(String(10))
    economy_revision: Mapped[int] = mapped_column(default=0)
    object_id: Mapped[int | None] = mapped_column(ForeignKey("city_objects.id"), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    version: Mapped[int] = mapped_column(default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CityCell(Base):
    """A taken plot (module = block, u = column, v = row) or a cell of the public square (module 0).

    Taken by a building, or reserved on the square by an open project.
    """

    __tablename__ = "city_cells"
    district_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    module: Mapped[int] = mapped_column(primary_key=True)
    u: Mapped[int] = mapped_column(primary_key=True)
    v: Mapped[int] = mapped_column(primary_key=True)
    object_id: Mapped[int | None] = mapped_column(
        ForeignKey("city_objects.id", ondelete="CASCADE"), nullable=True, index=True
    )
    project_id: Mapped[int | None] = mapped_column(
        ForeignKey("city_projects.id", ondelete="CASCADE"), nullable=True, index=True
    )


class CityContribution(Base):
    """A voluntary contribution: coins left through the journal and come back the same way."""

    __tablename__ = "city_contributions"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("city_projects.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    amount: Mapped[int]
    transaction_id: Mapped[int | None] = mapped_column(
        ForeignKey("coin_transactions.id", ondelete="SET NULL"), nullable=True
    )
    refund_transaction_id: Mapped[int | None] = mapped_column(
        ForeignKey("coin_transactions.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CityDistrictState(Base):
    """What a district has achieved together; all its personal land is available from the start."""

    __tablename__ = "city_districts"
    district_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    hq_level: Mapped[int] = mapped_column(default=1)
    built_projects: Mapped[int] = mapped_column(default=0)
    #: Compatibility snapshot of all geographic price bands (normalised by the district lock).
    open_band: Mapped[int] = mapped_column(default=1, server_default="1")
    #: Highest number of occupied personal plots; the district's complex never loses a level.
    landmark_peak_plots: Mapped[int] = mapped_column(default=0, server_default="0")


class CityOperation(Base):
    """A change by its idempotency key: repeating the same request returns the stored result."""

    __tablename__ = "city_operations"
    __table_args__ = (UniqueConstraint("user_id", "key"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    key: Mapped[str] = mapped_column(String(64))
    kind: Mapped[str] = mapped_column(String(16))
    fingerprint: Mapped[str] = mapped_column(String(64))
    result: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CityEvent(Base):
    """Append-only history of district land; plain ids, so the UPDATE guard meets no foreign key."""

    __tablename__ = "city_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    district_id: Mapped[str] = mapped_column(String(32), index=True)
    object_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    project_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    actor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    kind: Mapped[str] = mapped_column(String(16))
    level: Mapped[int | None] = mapped_column(nullable=True)
    amount: Mapped[int] = mapped_column(default=0)
    transaction_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
