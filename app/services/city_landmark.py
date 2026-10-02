"""The district's automatic complex: five levels earned by filling its personal land.

The complex uses the entire public square; existing public buildings and funded projects keep
their square instead. It has no owner, catalogue price, payment or project of its own.
"""

THRESHOLDS = (0, 10, 25, 50, 75)
NAMES = (
    "Павильон команды",
    "Дом команды",
    "Деловой центр",
    "Комплекс команды",
    "Городской комплекс",
)


def needed(plots, level):
    """Whole plots needed for a level, with the percentage rounded up using integers."""
    return (plots * THRESHOLDS[level - 1] + 99) // 100


def level_for(plots, taken):
    """The achieved level on non-empty district land, never counting public-square cells."""
    if plots <= 0:
        return 1
    return max(level for level in range(1, len(THRESHOLDS) + 1) if taken >= needed(plots, level))


def view(plots, taken, peak=0, *, legacy=False):
    """Visible progress: keep achieved levels, but show current land needed for the next one."""
    if plots <= 0:
        return None
    peak = max(peak or 0, taken)
    level = level_for(plots, peak)
    nxt = level + 1
    return {
        "status": "legacy_occupied" if legacy else "active",
        "level": level,
        "name": NAMES[level - 1],
        "module": 0,
        "u": 0,
        "v": 0,
        "w": 12,
        "h": 12,
        "rotation": 0,
        "taken": taken,
        "plots": plots,
        "peak": peak,
        "next": {
            "level": nxt,
            "name": NAMES[nxt - 1],
            "need": needed(plots, nxt),
            "remaining": max(0, needed(plots, nxt) - taken),
            "percent": THRESHOLDS[nxt - 1],
        }
        if level < len(THRESHOLDS)
        else None,
    }
