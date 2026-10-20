"""The week's points as decided for both channels (docs/CHANNELS.md).

- Chats: «Качество чатов» up to 75 (the KPI thresholds ×3) and «Норма часов в чатах» 25.
- The line: «Выполнение нормы часов» 25, «Качество звонков» 30, «Эффективность» 25,
  «Звонки в час» 20. «Выработка часов» (replaced by the norm from the SZoV reports) and
  «Благодарности от водителей» are switched off.
- Overtime in both channels is a bonus over the 100 points: up to 40 % of the hours' points (10),
  only once the norm is met, all of it from 8 hours over the norm.
- Nominations get a channel: the line's and the chats' own, «Без опозданий» and «Лучший прогресс» in
  each channel. «Звезда качества» counts the operator's own quality. A prize for a place needs an
  average of 50 points a week.
"""

import json

import sqlalchemy as sa

from alembic import op

revision = "20261020_scoring_rules"
down_revision = "20261020_tours_seen"
branch_labels = depends_on = None

CHAT_BANDS = [
    {"from": 80, "points": 15}, {"from": 86, "points": 30}, {"from": 90, "points": 45},
    {"from": 94, "points": 60}, {"from": 97, "points": 75},
]
OLD_CHAT_BANDS = [
    {"from": 80, "points": 20}, {"from": 86, "points": 40}, {"from": 90, "points": 60},
    {"from": 94, "points": 80}, {"from": 97, "points": 100},
]
OVERTIME_NOTE = (
    "Бонус сверх 100 баллов: когда норма часов выполнена, каждый час сверх нормы даёт 1,25 балла, "
    "с 8 ч — 10 баллов (40 % баллов за часы)."
)
#: Metrics created when missing: code → columns.
METRICS = {
    "hours_norm": {
        "title": "Выполнение нормы часов", "unit": "%", "direction": "higher_is_better",
        "target_value": 100.0, "max_points": 25.0, "allow_overachievement": False,
        "sort_order": 1, "channel": "line",
        "description": "Часы на линии, тренинги, тех. сбои и офлайн-активность против нормы часов "
        "оператора из отчёта СЗоВ",
    },
    "chat_hours_norm": {
        "title": "Норма часов в чатах", "unit": "%", "direction": "higher_is_better",
        "target_value": 100.0, "max_points": 25.0, "allow_overachievement": False,
        "sort_order": 16, "channel": "chat",
        "description": "Часы в чатах, тренинги, тех. сбои и офлайн-активность против нормы часов "
        "из отчёта СЗоВ",
    },
    "chat_overtime": {
        "title": "Переработки в чатах", "unit": "ч", "direction": "higher_is_better",
        "target_value": 8.0, "max_points": 10.0, "allow_overachievement": True,
        "sort_order": 17, "channel": "chat", "description": OVERTIME_NOTE,
    },
    "chat_response_time": {
        "title": "Среднее время ответа в чатах", "unit": "сек", "direction": "lower_is_better",
        "target_value": 120.0, "max_points": 0.0, "allow_overachievement": False,
        "sort_order": 18, "channel": "chat",
        "description": "Среднее по дням из отчёта СЗоВ, меньше — лучше. Без баллов, пока их не "
        "зададут в настройках.",
    },
    "chats_per_hour": {
        "title": "Чатов в час", "unit": "шт/ч", "direction": "higher_is_better",
        "target_value": 10.0, "max_points": 0.0, "allow_overachievement": True,
        "sort_order": 19, "channel": "chat",
        "description": "Чаты из отчёта СЗоВ на час в чатах (без тренингов, тех. сбоев и офлайна). "
        "Без баллов, пока их не зададут в настройках.",
    },
}
#: New nominations: code → columns.
NOMINATIONS = {
    "best_chat_quality": {
        "title": "Лучшее качество чатов", "metric_code": "chat_quality",
        "direction": "higher_is_better", "require_zero": False, "min_value": None,
        "channel": "chat", "sort_order": 21,
    },
    "fastest_chat_reply": {
        "title": "Самый быстрый ответ в чатах", "metric_code": "chat_response_time",
        "direction": "lower_is_better", "require_zero": False, "min_value": None,
        "channel": "chat", "sort_order": 22,
    },
    "best_progress_chat": {
        "title": "Лучший прогресс · чаты", "metric_code": "__progress__",
        "direction": "higher_is_better", "require_zero": False, "min_value": 0.01,
        "channel": "chat", "sort_order": 31,
        "description": "Наибольший прирост итогового балла к прошлому периоду",
    },
    "no_lateness_chat": {
        "title": "Без опозданий · чаты", "metric_code": "lateness",
        "direction": "higher_is_better", "require_zero": True, "min_value": None,
        "channel": "chat", "sort_order": 41,
    },
}


def _json(bind, name: str) -> str:
    return f"CAST(:{name} AS JSONB)" if bind.dialect.name == "postgresql" else f":{name}"


def upgrade():
    with op.batch_alter_table("metric_definitions") as batch:
        batch.add_column(sa.Column("bonus_for", sa.String(64), nullable=True))
        batch.add_column(sa.Column("bonus_share", sa.Float(), nullable=True))
    with op.batch_alter_table("nomination_definitions") as batch:
        batch.add_column(sa.Column("channel", sa.String(16), nullable=False, server_default="all"))
    with op.batch_alter_table("gamification_settings") as batch:
        batch.add_column(
            sa.Column("prize_min_points", sa.Float(), nullable=False, server_default="50")
        )

    bind = op.get_bind()
    run = lambda sql, **params: bind.execute(sa.text(sql), params)  # noqa: E731

    existing = {row[0] for row in run("SELECT code FROM metric_definitions")}
    for code, columns in METRICS.items():
        if code in existing:
            continue
        run(
            "INSERT INTO metric_definitions (code, title, unit, kind, direction, target_value, "
            "max_points, penalty_per_unit, allow_overachievement, is_active, sort_order, channel, "
            "description, created_at, updated_at) VALUES (:code, :title, :unit, 'positive', "
            ":direction, :target_value, :max_points, 0, :allow_overachievement, TRUE, "
            ":sort_order, :channel, :description, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
            code=code, **columns,
        )

    # The line: the norm of hours replaces «Выработка часов», gratitude is not counted.
    run("UPDATE metric_definitions SET is_active = FALSE "
        "WHERE code IN ('hours_worked', 'driver_gratitudes')")
    for code, points in (("hours_norm", 25), ("quality", 30), ("efficiency", 25),
                         ("calls_per_hour", 20), ("chat_hours_norm", 25)):
        run("UPDATE metric_definitions SET max_points = :points, is_active = TRUE "
            "WHERE code = :code", points=points, code=code)
    # Overtime in both channels: a bonus over the 100 points once the norm is met.
    for code, base in (("overtime", "hours_norm"), ("chat_overtime", "chat_hours_norm")):
        run("UPDATE metric_definitions SET bonus_for = :base, bonus_share = 0.4, "
            "max_points = 10, target_value = 8, bands = NULL, description = :note "
            "WHERE code = :code", base=base, code=code, note=OVERTIME_NOTE)
    # Chats: quality up to 75 by the KPI thresholds ×3.
    run(
        f"UPDATE metric_definitions SET bands = {_json(bind, 'bands')}, max_points = 75, "
        "description = :note WHERE code = 'chat_quality'",
        bands=json.dumps(CHAT_BANDS),
        note="Пороги из KPI чатов (80–85 % — 5, 86–89 % — 10, 90–93 % — 15, 94–96 % — 20, "
        "97–100 % — 25 баллов), приведены к 75 баллам недели: ×3. Ещё 25 — норма часов.",
    )
    # A violation is one too many: the discipline metrics aim at zero.
    run("UPDATE metric_definitions SET target_value = 0 WHERE kind = 'anti'")

    # Nominations: each one is played for among the operators it can describe.
    for code, channel, old, new in (
        ("best_calls", "line", None, None),
        ("top_efficiency", "line", None, None),
        ("best_quality", "line", "Лучшее качество", "Лучшее качество звонков"),
        ("no_lateness", "line", "Без опозданий", "Без опозданий · линия"),
        ("best_progress", "line", "Лучший прогресс", "Лучший прогресс · линия"),
    ):
        run("UPDATE nomination_definitions SET channel = :channel WHERE code = :code",
            channel=channel, code=code)
        if old:
            run("UPDATE nomination_definitions SET title = :new WHERE code = :code "
                "AND title = :old", new=new, old=old, code=code)
    run("UPDATE nomination_definitions SET is_active = FALSE WHERE code = 'top_gratitudes'")
    present = {row[0] for row in run("SELECT code FROM nomination_definitions")}
    for code, columns in NOMINATIONS.items():
        if code in present:
            continue
        run(
            "INSERT INTO nomination_definitions (code, title, description, metric_code, "
            "direction, require_zero, min_value, channel, coins_reward, is_active, sort_order, "
            "created_at, updated_at) VALUES (:code, :title, :description, :metric_code, "
            ":direction, :require_zero, :min_value, :channel, 100, TRUE, :sort_order, "
            "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
            code=code, description=columns.get("description"),
            **{k: v for k, v in columns.items() if k != "description"},
        )

    # «Звезда качества» counts the operator's own quality; gratitude is not counted any more.
    run(
        f"UPDATE badge_definitions SET rule_params = {_json(bind, 'params')}, "
        "description = :description WHERE code = 'quality_star'",
        params=json.dumps({"metric": "quality", "chat_metric": "chat_quality", "gte": 95,
                           "weeks": 2}),
        description="Две недели подряд с качеством не ниже 95 % — звонков или чатов",
    )
    run("UPDATE badge_definitions SET is_active = FALSE WHERE code = 'driver_favourite'")


def downgrade():
    bind = op.get_bind()
    run = lambda sql, **params: bind.execute(sa.text(sql), params)  # noqa: E731
    run(f"UPDATE metric_definitions SET bands = {_json(bind, 'bands')}, max_points = 100 "
        "WHERE code = 'chat_quality'", bands=json.dumps(OLD_CHAT_BANDS))
    for code, points in (("quality", 25), ("efficiency", 20), ("calls_per_hour", 15),
                         ("chat_hours_norm", 0)):
        run("UPDATE metric_definitions SET max_points = :points WHERE code = :code",
            points=points, code=code)
    run("UPDATE metric_definitions SET max_points = 0 WHERE code = 'chat_overtime'")
    run("UPDATE metric_definitions SET is_active = TRUE "
        "WHERE code IN ('hours_worked', 'driver_gratitudes')")
    run("UPDATE nomination_definitions SET is_active = TRUE WHERE code = 'top_gratitudes'")
    run("DELETE FROM nomination_definitions WHERE code IN ('best_chat_quality', "
        "'fastest_chat_reply', 'best_progress_chat', 'no_lateness_chat')")
    run("UPDATE badge_definitions SET is_active = TRUE WHERE code = 'driver_favourite'")
    with op.batch_alter_table("gamification_settings") as batch:
        batch.drop_column("prize_min_points")
    with op.batch_alter_table("nomination_definitions") as batch:
        batch.drop_column("channel")
    with op.batch_alter_table("metric_definitions") as batch:
        batch.drop_column("bonus_share")
        batch.drop_column("bonus_for")
