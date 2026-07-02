"""
АДМИНИСТРАТИВНАЯ УТИЛИТА — полная и безвозвратная очистка тестовых
операторов и ВСЕХ связанных с ними данных.

НЕ вызывается в рантайме приложения. Запускается вручную через Railway
Console (или локально с правильным DATABASE_URL) администратором.

Удаляет в правильном порядке (от зависимых таблиц к корневой):
  1. operator_daily_metrics  (посуточные метрики аналитики)
  2. period_reports          (сохранённые расчёты периодов)
  3. shop_purchases          (заявки из магазина)
  4. coin_transactions       (история начислений/списаний/резервов)
  5. weekly_results          (legacy еженедельные результаты)
  6. audit_logs.entity_id    (обнуляется, если entity_type='operator')
  7. users                   (учётные записи операторов — удаляются целиком)
  8. operators               (сами операторы)

ВНИМАНИЕ: это безвозвратное удаление, без возможности восстановления
(в отличие от "увольнения", которое просто помечает оператора скрытым).
Используйте только для очистки тестовых/демо-данных, не для реальных
уволенных операторов в production.

Запуск (dry-run по умолчанию — ничего не удаляет, только показывает план):

    python scripts/wipe_test_operators.py --all

    python scripts/wipe_test_operators.py --ids 1,2,3,7

Реальное удаление:

    python scripts/wipe_test_operators.py --all --apply
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Полная очистка тестовых операторов и их данных.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--all", action="store_true", help="Удалить ВСЕХ операторов в системе")
    group.add_argument("--ids", type=str, help="Список ID операторов через запятую, например: 1,2,3")
    parser.add_argument("--apply", action="store_true", help="Выполнить реальное удаление (по умолчанию — dry-run)")
    parser.add_argument("--allow-default-db", action="store_true", help="Разрешить запуск без переменной DATABASE_URL")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not os.getenv("DATABASE_URL") and not args.allow_default_db:
        print("DATABASE_URL не задан. Укажите Railway DATABASE_URL перед запуском.", file=sys.stderr)
        return 2

    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root))

    from sqlalchemy import text
    from app.database.db import SessionLocal
    from app.models.entities import (
        CoinTransaction, Operator, OperatorDailyMetric, PeriodReport,
        ShopPurchase, User, WeeklyResult,
    )

    db = SessionLocal()
    try:
        if args.all:
            operator_ids = [row[0] for row in db.execute(text("SELECT id FROM operators")).all()]
        else:
            operator_ids = [int(x.strip()) for x in args.ids.split(",") if x.strip()]

        if not operator_ids:
            print("Не найдено операторов для удаления.")
            return 0

        operators = list(db.query(Operator).filter(Operator.id.in_(operator_ids)).all())
        if not operators:
            print(f"Операторы с ID {operator_ids} не найдены в БД.")
            return 0

        print("=" * 70)
        print(f"{'РЕАЛЬНОЕ УДАЛЕНИЕ' if args.apply else 'DRY-RUN (план, без удаления)'}")
        print("=" * 70)
        print(f"\nБудут удалены {len(operators)} операторов:")
        for op in operators:
            print(f"  ID={op.id:>4}  {op.full_name:<30}  баланс={op.current_balance}₵  группа={op.group_name}")

        # Подсчёт связанных записей по каждой таблице — для информации
        counts = {}
        counts["operator_daily_metrics"] = db.query(OperatorDailyMetric).filter(OperatorDailyMetric.operator_id.in_(operator_ids)).count()
        counts["period_reports"] = db.query(PeriodReport).filter(PeriodReport.operator_id.in_(operator_ids)).count()
        counts["shop_purchases"] = db.query(ShopPurchase).filter(ShopPurchase.operator_id.in_(operator_ids)).count()
        counts["coin_transactions"] = db.query(CoinTransaction).filter(CoinTransaction.operator_id.in_(operator_ids)).count()
        counts["weekly_results"] = db.query(WeeklyResult).filter(WeeklyResult.operator_id.in_(operator_ids)).count()
        counts["users"] = db.query(User).filter(User.operator_id.in_(operator_ids)).count()
        counts["audit_logs (legacy operator_id, будут обезличены)"] = db.execute(
            text("SELECT COUNT(*) FROM audit_logs WHERE operator_id = ANY(:ids)"), {"ids": operator_ids}
        ).scalar() or 0

        print("\nСвязанные записи, которые также будут удалены:")
        for table, count in counts.items():
            print(f"  {table:<25} {count} записей")

        if not args.apply:
            print("\nЭто dry-run — ничего не удалено. Повторите с --apply для реального удаления.")
            return 0

        print("\nВыполняется удаление...")

        # Порядок важен — от зависимых таблиц к корневой operators.
        # coin_transactions.related_purchase_id ссылается на shop_purchases.id,
        # поэтому coin_transactions нужно удалить РАНЬШЕ shop_purchases —
        # иначе PostgreSQL не даёт удалить строку, на которую ещё ссылаются.
        db.query(OperatorDailyMetric).filter(OperatorDailyMetric.operator_id.in_(operator_ids)).delete(synchronize_session=False)
        db.query(PeriodReport).filter(PeriodReport.operator_id.in_(operator_ids)).delete(synchronize_session=False)
        db.query(CoinTransaction).filter(CoinTransaction.operator_id.in_(operator_ids)).delete(synchronize_session=False)
        db.query(ShopPurchase).filter(ShopPurchase.operator_id.in_(operator_ids)).delete(synchronize_session=False)
        db.query(WeeklyResult).filter(WeeklyResult.operator_id.in_(operator_ids)).delete(synchronize_session=False)

        # audit_logs — обнуляем ссылки (entity_id для нового контракта, operator_id для legacy),
        # саму запись лога не трогаем (история действий администраторов важна сама по себе)
        db.execute(
            text("UPDATE audit_logs SET entity_id = NULL WHERE entity_type = 'operator' AND entity_id = ANY(:ids)"),
            {"ids": operator_ids},
        )
        db.execute(
            text("UPDATE audit_logs SET operator_id = NULL WHERE operator_id = ANY(:ids)"),
            {"ids": operator_ids},
        )

        # legacy operator_audit_logs (если таблица существует на старой схеме)
        from sqlalchemy import inspect as sa_inspect
        if sa_inspect(db.connection()).has_table("operator_audit_logs"):
            db.execute(
                text("DELETE FROM operator_audit_logs WHERE operator_id = ANY(:ids)"),
                {"ids": operator_ids},
            )

        # operators.user_id и operators.created_by_user_id оба ссылаются на
        # users.id (отдельно от users.operator_id -> operators.id — связь
        # двусторонняя). Перед удалением users нужно обнулить оба поля,
        # иначе PostgreSQL не даст удалить строку users, на которую ещё
        # ссылается какое-либо из этих полей operators (включая операторов,
        # которые НЕ входят в список удаления, но были созданы тестовым
        # пользователем — поэтому обновляем без фильтра по id операторов,
        # только по совпадению user_id с удаляемыми пользователями).
        db.execute(
            text("UPDATE operators SET user_id = NULL WHERE id = ANY(:ids)"),
            {"ids": operator_ids},
        )
        user_ids_to_delete = [row[0] for row in db.execute(
            text("SELECT id FROM users WHERE operator_id = ANY(:ids)"), {"ids": operator_ids}
        ).all()]
        if user_ids_to_delete:
            db.execute(
                text("UPDATE operators SET created_by_user_id = NULL WHERE created_by_user_id = ANY(:uids)"),
                {"uids": user_ids_to_delete},
            )

        # Дополнительные таблицы, ссылающиеся на users.id, которые мы не
        # удаляем целиком (только обезличиваем ссылку — сама запись лога/файла
        # остаётся, важна для истории действий администраторов):
        if user_ids_to_delete:
            db.execute(
                text("UPDATE audit_logs SET performed_by_user_id = NULL WHERE performed_by_user_id = ANY(:uids)"),
                {"uids": user_ids_to_delete},
            )
            db.execute(
                text("UPDATE uploaded_report_files SET uploaded_by_user_id = NULL WHERE uploaded_by_user_id = ANY(:uids)"),
                {"uids": user_ids_to_delete},
            )

        # Учётные записи операторов — удаляются целиком (тестовые логины не нужны)
        db.query(User).filter(User.operator_id.in_(operator_ids)).delete(synchronize_session=False)

        # Сами операторы
        db.query(Operator).filter(Operator.id.in_(operator_ids)).delete(synchronize_session=False)

        db.commit()
        print(f"\nГотово. Удалено {len(operators)} операторов и вся связанная история.")
        return 0

    except Exception as e:
        db.rollback()
        print(f"\nОШИБКА, изменения отменены: {e}", file=sys.stderr)
        raise
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
"""
АДМИНИСТРАТИВНАЯ УТИЛИТА — полная и безвозвратная очистка тестовых
операторов и ВСЕХ связанных с ними данных.

НЕ вызывается в рантайме приложения. Запускается вручную через Railway
Console (или локально с правильным DATABASE_URL) администратором.

Удаляет в правильном порядке (от зависимых таблиц к корневой):
  1. operator_daily_metrics  (посуточные метрики аналитики)
  2. period_reports          (сохранённые расчёты периодов)
  3. shop_purchases          (заявки из магазина)
  4. coin_transactions       (история начислений/списаний/резервов)
  5. weekly_results          (legacy еженедельные результаты)
  6. audit_logs.entity_id    (обнуляется, если entity_type='operator')
  7. users                   (учётные записи операторов — удаляются целиком)
  8. operators               (сами операторы)

ВНИМАНИЕ: это безвозвратное удаление, без возможности восстановления
(в отличие от "увольнения", которое просто помечает оператора скрытым).
Используйте только для очистки тестовых/демо-данных, не для реальных
уволенных операторов в production.

Запуск (dry-run по умолчанию — ничего не удаляет, только показывает план):

    python scripts/wipe_test_operators.py --all

    python scripts/wipe_test_operators.py --ids 1,2,3,7

Реальное удаление:

    python scripts/wipe_test_operators.py --all --apply
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Полная очистка тестовых операторов и их данных.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--all", action="store_true", help="Удалить ВСЕХ операторов в системе")
    group.add_argument("--ids", type=str, help="Список ID операторов через запятую, например: 1,2,3")
    parser.add_argument("--apply", action="store_true", help="Выполнить реальное удаление (по умолчанию — dry-run)")
    parser.add_argument("--allow-default-db", action="store_true", help="Разрешить запуск без переменной DATABASE_URL")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not os.getenv("DATABASE_URL") and not args.allow_default_db:
        print("DATABASE_URL не задан. Укажите Railway DATABASE_URL перед запуском.", file=sys.stderr)
        return 2

    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root))

    from sqlalchemy import text
    from app.database.db import SessionLocal
    from app.models.entities import (
        CoinTransaction, Operator, OperatorDailyMetric, PeriodReport,
        ShopPurchase, User, WeeklyResult,
    )

    db = SessionLocal()
    try:
        if args.all:
            operator_ids = [row[0] for row in db.execute(text("SELECT id FROM operators")).all()]
        else:
            operator_ids = [int(x.strip()) for x in args.ids.split(",") if x.strip()]

        if not operator_ids:
            print("Не найдено операторов для удаления.")
            return 0

        operators = list(db.query(Operator).filter(Operator.id.in_(operator_ids)).all())
        if not operators:
            print(f"Операторы с ID {operator_ids} не найдены в БД.")
            return 0

        print("=" * 70)
        print(f"{'РЕАЛЬНОЕ УДАЛЕНИЕ' if args.apply else 'DRY-RUN (план, без удаления)'}")
        print("=" * 70)
        print(f"\nБудут удалены {len(operators)} операторов:")
        for op in operators:
            print(f"  ID={op.id:>4}  {op.full_name:<30}  баланс={op.current_balance}₵  группа={op.group_name}")

        # Подсчёт связанных записей по каждой таблице — для информации
        counts = {}
        counts["operator_daily_metrics"] = db.query(OperatorDailyMetric).filter(OperatorDailyMetric.operator_id.in_(operator_ids)).count()
        counts["period_reports"] = db.query(PeriodReport).filter(PeriodReport.operator_id.in_(operator_ids)).count()
        counts["shop_purchases"] = db.query(ShopPurchase).filter(ShopPurchase.operator_id.in_(operator_ids)).count()
        counts["coin_transactions"] = db.query(CoinTransaction).filter(CoinTransaction.operator_id.in_(operator_ids)).count()
        counts["weekly_results"] = db.query(WeeklyResult).filter(WeeklyResult.operator_id.in_(operator_ids)).count()
        counts["users"] = db.query(User).filter(User.operator_id.in_(operator_ids)).count()
        counts["audit_logs (legacy operator_id, будут обезличены)"] = db.execute(
            text("SELECT COUNT(*) FROM audit_logs WHERE operator_id = ANY(:ids)"), {"ids": operator_ids}
        ).scalar() or 0

        print("\nСвязанные записи, которые также будут удалены:")
        for table, count in counts.items():
            print(f"  {table:<25} {count} записей")

        if not args.apply:
            print("\nЭто dry-run — ничего не удалено. Повторите с --apply для реального удаления.")
            return 0

        print("\nВыполняется удаление...")

        # Порядок важен — от зависимых таблиц к корневой operators.
        # coin_transactions.related_purchase_id ссылается на shop_purchases.id,
        # поэтому coin_transactions нужно удалить РАНЬШЕ shop_purchases —
        # иначе PostgreSQL не даёт удалить строку, на которую ещё ссылаются.
        db.query(OperatorDailyMetric).filter(OperatorDailyMetric.operator_id.in_(operator_ids)).delete(synchronize_session=False)
        db.query(PeriodReport).filter(PeriodReport.operator_id.in_(operator_ids)).delete(synchronize_session=False)
        db.query(CoinTransaction).filter(CoinTransaction.operator_id.in_(operator_ids)).delete(synchronize_session=False)
        db.query(ShopPurchase).filter(ShopPurchase.operator_id.in_(operator_ids)).delete(synchronize_session=False)
        db.query(WeeklyResult).filter(WeeklyResult.operator_id.in_(operator_ids)).delete(synchronize_session=False)

        # audit_logs — обнуляем ссылки (entity_id для нового контракта, operator_id для legacy),
        # саму запись лога не трогаем (история действий администраторов важна сама по себе)
        db.execute(
            text("UPDATE audit_logs SET entity_id = NULL WHERE entity_type = 'operator' AND entity_id = ANY(:ids)"),
            {"ids": operator_ids},
        )
        db.execute(
            text("UPDATE audit_logs SET operator_id = NULL WHERE operator_id = ANY(:ids)"),
            {"ids": operator_ids},
        )

        # legacy operator_audit_logs (если таблица существует на старой схеме)
        from sqlalchemy import inspect as sa_inspect
        if sa_inspect(db.connection()).has_table("operator_audit_logs"):
            db.execute(
                text("DELETE FROM operator_audit_logs WHERE operator_id = ANY(:ids)"),
                {"ids": operator_ids},
            )

        # operators.user_id и operators.created_by_user_id оба ссылаются на
        # users.id (отдельно от users.operator_id -> operators.id — связь
        # двусторонняя). Перед удалением users нужно обнулить оба поля,
        # иначе PostgreSQL не даст удалить строку users, на которую ещё
        # ссылается какое-либо из этих полей operators (включая операторов,
        # которые НЕ входят в список удаления, но были созданы тестовым
        # пользователем — поэтому обновляем без фильтра по id операторов,
        # только по совпадению user_id с удаляемыми пользователями).
        db.execute(
            text("UPDATE operators SET user_id = NULL WHERE id = ANY(:ids)"),
            {"ids": operator_ids},
        )
        user_ids_to_delete = [row[0] for row in db.execute(
            text("SELECT id FROM users WHERE operator_id = ANY(:ids)"), {"ids": operator_ids}
        ).all()]
        if user_ids_to_delete:
            db.execute(
                text("UPDATE operators SET created_by_user_id = NULL WHERE created_by_user_id = ANY(:uids)"),
                {"uids": user_ids_to_delete},
            )

        # Дополнительные таблицы, ссылающиеся на users.id, которые мы не
        # удаляем целиком (только обезличиваем ссылку — сама запись лога/файла
        # остаётся, важна для истории действий администраторов):
        if user_ids_to_delete:
            db.execute(
                text("UPDATE audit_logs SET performed_by_user_id = NULL WHERE performed_by_user_id = ANY(:uids)"),
                {"uids": user_ids_to_delete},
            )
            db.execute(
                text("UPDATE uploaded_report_files SET uploaded_by_user_id = NULL WHERE uploaded_by_user_id = ANY(:uids)"),
                {"uids": user_ids_to_delete},
            )

        # Учётные записи операторов — удаляются целиком (тестовые логины не нужны)
        db.query(User).filter(User.operator_id.in_(operator_ids)).delete(synchronize_session=False)

        # Сами операторы
        db.query(Operator).filter(Operator.id.in_(operator_ids)).delete(synchronize_session=False)

        db.commit()
        print(f"\nГотово. Удалено {len(operators)} операторов и вся связанная история.")
        return 0

    except Exception as e:
        db.rollback()
        print(f"\nОШИБКА, изменения отменены: {e}", file=sys.stderr)
        raise
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
