"""Requests that change district land: the client names the plot and building, never the price."""

from pydantic import BaseModel, ConfigDict, Field, model_validator

KEY = r"^[A-Za-z0-9_-]{8,64}$"


class Keyed(BaseModel):
    model_config = ConfigDict(extra="forbid")
    #: The idempotency key of one user action: a repeat returns the first result.
    key: str = Field(pattern=KEY)


class Plot(BaseModel):
    """A cell of the district's land: its block, column and row (app/data/city_land.json); a
    building's first cell."""

    block: int = Field(ge=1, le=99)
    col: int = Field(ge=0, le=999)
    row: int = Field(ge=0, le=999)


DISTRICT = r"^(support|sales)(-team-[1-3]|-2-team-[1-2]|-4-team-[1-4]|-5-team-[1-5])$"
#: A cell as [block, column, row].
Cell = tuple[int, int, int]


#: A small thing moving: [block, column, row] it stands on, then [block, column, row] it goes to.
Move = tuple[int, int, int, int, int, int]
#: A small thing turned: [block, column, row, turn], the turn a quarter turn 0–3.
Turned = tuple[int, int, int, int]


def check_cells(cells, limit):
    if not 1 <= len(cells) <= limit:
        raise ValueError(f"За раз можно выбрать от 1 до {limit} клеток")
    for block, col, row in cells:
        if not (1 <= block <= 99 and 0 <= col <= 999 and 0 <= row <= 999):
            raise ValueError("Таких клеток нет на земле района")
    return cells


def check_moves(moves, limit):
    """Each small thing from its cell to another, none of them twice, nor two onto one cell."""
    sources, targets = [m[:3] for m in moves], [m[3:] for m in moves]
    check_cells(sources, limit)
    check_cells(targets, limit)
    if len(set(sources)) != len(sources) or len(set(targets)) != len(targets):
        raise ValueError("Клетки повторяются")
    return moves


def check_turns(cells, limit):
    check_cells([c[:3] for c in cells], limit)
    if any(not 0 <= turn <= 3 for *_cell, turn in cells):
        raise ValueError("Поворот — от 0 до 3 четвертей")
    return cells


class PurchaseInput(Keyed, Plot):
    #: The district the operator selected; omitted only by clients predating this guard.
    district_id: str | None = Field(default=None, pattern=DISTRICT, max_length=32)
    #: A square, a house or a ready office tower; parks gather themselves from squares.
    family: str = Field(pattern=r"^[a-z]{2,16}$")
    economy_revision: int = Field(ge=0)
    #: Where its front looks with no road beside it: quarter turns from facing the city's middle.
    #: Omitted (0) by clients predating it, so their stored operations still replay.
    rotation: int | None = Field(default=None, ge=0, le=3)


class TurnInput(Keyed):
    """Where the front of one's own building looks with no road beside it."""

    version: int = Field(ge=1)
    rotation: int = Field(ge=0, le=3)


class DecorInput(Keyed):
    """Small things of one kind on free cells of the district, paid together."""

    district_id: str | None = Field(default=None, pattern=DISTRICT, max_length=32)
    family: str = Field(pattern=r"^[a-z]{2,16}$")
    cells: list[Cell]
    economy_revision: int = Field(ge=0)

    @model_validator(mode="after")
    def cells_in_range(self):
        from app.services.city_estate import DECOR_BATCH

        check_cells(self.cells, DECOR_BATCH)
        return self


class UndecorInput(Keyed):
    """One's own small things off the cells named, for their coins back."""

    district_id: str | None = Field(default=None, pattern=DISTRICT, max_length=32)
    cells: list[Cell]

    @model_validator(mode="after")
    def cells_in_range(self):
        from app.services.city_estate import DECOR_BATCH

        check_cells(self.cells, DECOR_BATCH)
        return self


class DecorMoveInput(Keyed):
    """One's own small things (and the district's) onto other free cells of the district, free."""

    district_id: str | None = Field(default=None, pattern=DISTRICT, max_length=32)
    moves: list[Move]

    @model_validator(mode="after")
    def moves_in_range(self):
        from app.services.city_estate import DECOR_BATCH

        check_moves(self.moves, DECOR_BATCH)
        return self


class DecorTurnInput(Keyed):
    """One's own lamps and benches (and the district's) turned to a side of their cells, free."""

    district_id: str | None = Field(default=None, pattern=DISTRICT, max_length=32)
    cells: list[Turned]

    @model_validator(mode="after")
    def turns_in_range(self):
        from app.services.city_estate import DECOR_BATCH

        check_turns(self.cells, DECOR_BATCH)
        return self


class UpgradeInput(Keyed):
    version: int = Field(ge=1)
    economy_revision: int = Field(ge=0)


class PlaceInput(Keyed, Plot):
    """A building from the inventory onto free cells; its front (a big park's shape) turns."""

    district_id: str | None = Field(default=None, pattern=DISTRICT, max_length=32)
    version: int = Field(ge=1)
    rotation: int = Field(default=0, ge=0, le=3)


class ProjectInput(Keyed):
    district_id: str = Field(pattern=DISTRICT, max_length=32)
    family: str = Field(pattern=r"^[a-z]{2,16}$")
    economy_revision: int = Field(ge=0)
    #: An upgrade of a public building, or a new one on the public square (module 0) at (u, v).
    target_id: int | None = Field(default=None, ge=1)
    module: int | None = Field(default=None, ge=0, le=19)
    u: int | None = Field(default=None, ge=0, le=11)
    v: int | None = Field(default=None, ge=0, le=11)
    rotation: int = Field(default=0, ge=0, le=3)

    @model_validator(mode="after")
    def place_or_target(self):
        place = (self.module, self.u, self.v)
        if self.target_id is None and None in place:
            raise ValueError("Укажите место проекта на общественной земле")
        if self.target_id is not None and place != (None, None, None):
            raise ValueError("Улучшение строится на месте постройки")
        return self


class ContributionInput(Keyed):
    amount: int = Field(ge=1, le=100_000)
    #: The operator agreed to give less if less is left to collect.
    up_to: bool = False


class CancelInput(Keyed):
    pass


# ---- the administrators' test city (app/services/city_sandbox.py) --------------------------------

#: A district of the test city by the id of the real one it copies.
SANDBOX_DISTRICT = DISTRICT


class SandboxPlotInput(Plot):
    """A square, a house or an office tower on free cells of a test district, for free."""

    model_config = ConfigDict(extra="forbid")
    district_id: str = Field(pattern=SANDBOX_DISTRICT, max_length=32)
    family: str = Field(pattern=r"^[a-z]{2,16}$")
    rotation: int = Field(default=0, ge=0, le=3)


class SandboxDecorInput(BaseModel):
    """Small things of one kind on free cells of a test district, for free."""

    model_config = ConfigDict(extra="forbid")
    district_id: str = Field(pattern=SANDBOX_DISTRICT, max_length=32)
    family: str = Field(pattern=r"^[a-z]{2,16}$")
    cells: list[Cell]

    @model_validator(mode="after")
    def cells_in_range(self):
        from app.services.city_estate import DECOR_BATCH

        check_cells(self.cells, DECOR_BATCH)
        return self


class SandboxUndecorInput(BaseModel):
    """Small things off cells of a test district, whoever laid them."""

    model_config = ConfigDict(extra="forbid")
    district_id: str = Field(pattern=SANDBOX_DISTRICT, max_length=32)
    cells: list[Cell]

    @model_validator(mode="after")
    def cells_in_range(self):
        from app.services.city_estate import DECOR_BATCH

        check_cells(self.cells, DECOR_BATCH)
        return self


class SandboxDecorMoveInput(BaseModel):
    """Small things of a test district onto other free cells, whoever laid them."""

    model_config = ConfigDict(extra="forbid")
    district_id: str = Field(pattern=SANDBOX_DISTRICT, max_length=32)
    moves: list[Move]

    @model_validator(mode="after")
    def moves_in_range(self):
        from app.services.city_estate import DECOR_BATCH

        check_moves(self.moves, DECOR_BATCH)
        return self


class SandboxDecorTurnInput(BaseModel):
    """Lamps and benches of a test district turned, whoever laid them."""

    model_config = ConfigDict(extra="forbid")
    district_id: str = Field(pattern=SANDBOX_DISTRICT, max_length=32)
    cells: list[Turned]

    @model_validator(mode="after")
    def turns_in_range(self):
        from app.services.city_estate import DECOR_BATCH

        check_turns(self.cells, DECOR_BATCH)
        return self


class LevelInput(BaseModel):
    """Any stage of a test building, up or down."""

    model_config = ConfigDict(extra="forbid")
    level: int = Field(ge=1, le=9)


class SandboxDistrictInput(BaseModel):
    """The stages of a test district; its personal land is always fully available."""

    model_config = ConfigDict(extra="forbid")
    #: Compatibility with old clients: only the district's full band count is accepted.
    open_band: int | None = Field(default=None, ge=1, le=9)
    hq_level: int | None = Field(default=None, ge=1, le=9)
    landmark_level: int | None = Field(default=None, ge=1, le=5)


class SandboxProjectInput(BaseModel):
    """A shared project of a test district: the next stage of `target_id`, or new at (u, v)."""

    model_config = ConfigDict(extra="forbid")
    district_id: str = Field(pattern=SANDBOX_DISTRICT, max_length=32)
    family: str = Field(pattern=r"^[a-z]{2,16}$")
    target_id: int | None = Field(default=None, ge=1)
    u: int | None = Field(default=None, ge=0, le=11)
    v: int | None = Field(default=None, ge=0, le=11)
    rotation: int = Field(default=0, ge=0, le=3)

    @model_validator(mode="after")
    def place_or_target(self):
        if self.target_id is None and None in (self.u, self.v):
            raise ValueError("Укажите место проекта на общественной площади")
        if self.target_id is not None and (self.u, self.v) != (None, None):
            raise ValueError("Улучшение строится на месте постройки")
        return self
