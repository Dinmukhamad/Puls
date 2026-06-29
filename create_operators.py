#!/usr/bin/env python3
"""
Скрипт создания операторов из файла операторы.xlsx
Запустить в Railway Console:
  python3 create_operators.py
"""
import sys, os
sys.path.insert(0, '/app')
os.environ.setdefault('DATABASE_URL', os.getenv('DATABASE_URL', ''))

from app.database.db import SessionLocal
from app.models.entities import Operator, User, Group
from app.core.security import hash_password
from sqlalchemy import select

OPERATORS = [
    {
        "full_name": "Азаматов Шохрух Акмалулы",
        "email": "azamatov_shokhrukh_co@yandextaxi.kz",
        "participation_status": "participating",
        "username": "user_azamatov_shokhrukh",
        "password": "d02lB99vy8",
    },
    {
        "full_name": "Алибек Аружан Мухтаркызы",
        "email": "alibek_aruzhan_co@yandextaxi.kz",
        "participation_status": "participating",
        "username": "user_alibek_aruzhan",
        "password": "UfRoH9A9sr",
    },
    {
        "full_name": "Динислам Аян Токтарбекулы",
        "email": "dinislam_ayan_co@yandextaxi.kz",
        "participation_status": "participating",
        "username": "user_dinislam_ayan",
        "password": "QvZwb3WtFy",
    },
    {
        "full_name": "Зинелгабиден Алнур",
        "email": "zinelgabiden_alnur_co@yandextaxi.kz",
        "participation_status": "participating",
        "username": "user_zinelgabiden_alnur",
        "password": "9y6iVsQO1h",
    },
    {
        "full_name": "Нурахмет Актилек Кайраткызы",
        "email": "nurakhmet_aqtilek_co@yandextaxi.kz",
        "participation_status": "participating",
        "username": "user_nurakhmet_aktilek",
        "password": "lH065TzMbC",
    },
    {
        "full_name": "Нурганат Нурдана Айдынкызы",
        "email": "nurganat_nurdana_co@yandextaxi.kz",
        "participation_status": "participating",
        "username": "user_nurganat_nurdana",
        "password": "43r1IFdYI7",
    },
    {
        "full_name": "Окенова Балнур Сериккызы",
        "email": "okenova_balnur_co@yandextaxi.kz",
        "participation_status": "participating",
        "username": "user_okenova_balnur",
        "password": "S4S6lqJ69o",
    },
    {
        "full_name": "Садык Аяжан Аканкызы",
        "email": "sadyk_ayazhan_co@yandextaxi.kz",
        "participation_status": "participating",
        "username": "user_sadyk_ayazhan",
        "password": "W3LbG0hZiH",
    },
    {
        "full_name": "Сайнов Санжар Еркинович",
        "email": "sainov_sanzhar_co@yandextaxi.kz",
        "participation_status": "not_participating",
        "username": "user_saynov_sanzhar",
        "password": "3UUiXi4yiU",
    },
    {
        "full_name": "Сергей Алихан Жарасханулы",
        "email": "sergey_alihan@yandextaxi.kz",
        "participation_status": "participating",
        "username": "user_sergey_alikhan",
        "password": "JqE0oY9A8Y",
    },
    {
        "full_name": "Толегенов Анет Серикұлы",
        "email": "tolegenov_anet_co@yandextaxi.kz",
        "participation_status": "participating",
        "username": "user_tolegenov_anet",
        "password": "XPt1hMYfnd",
    },
    {
        "full_name": "Атагельдиева Акнур Галымжанкызы",
        "email": "atageldieva_aknur_co@yandextaxi.kz",
        "participation_status": "participating",
        "username": "user_atageldieva_aknur",
        "password": "JuHQJCBNw3",
    },
    {
        "full_name": "Комекбай Мариям Азаматкызы",
        "email": "komekbai_mariyam_co@yandextaxi.kz",
        "participation_status": "participating",
        "username": "user_komekbay_mariyam",
        "password": "VhajO4Hhfk",
    },
    {
        "full_name": "Келесбай Гүлназ Нұрланқызы",
        "email": "",
        "participation_status": "participating",
        "username": "user_kelesbay_gulnaz",
        "password": "PkSK3qo58W",
    },
    {
        "full_name": "Абдеш Мирас Ерболулы",
        "email": "",
        "participation_status": "participating",
        "username": "user_abdesh_miras",
        "password": "NuesU4iLDG",
    },
    {
        "full_name": "Касым Мирас Азаматулы",
        "email": "",
        "participation_status": "participating",
        "username": "user_kasym_miras",
        "password": "1UuuRTApHv",
    },
    {
        "full_name": "Абдуганиев Бекзат Бахрамулы",
        "email": "abduganiev_bekzat_co@yandextaxi.kz",
        "participation_status": "not_participating",
        "username": "user_abduganiev_bekzat",
        "password": "9s1mAFwLRc",
    },
    {
        "full_name": "Ахауова Нурсая",
        "email": "ahauova_nursaya_co@yandextaxi.kz",
        "participation_status": "participating",
        "username": "user_akhauova_nursaya",
        "password": "TWrbK50gG8",
    },
    {
        "full_name": "Онгарова Жанерке Бердихановна",
        "email": "ongarova_zhanerke_co@yandextaxi.kz",
        "participation_status": "not_participating",
        "username": "user_ongarova_zhanerke",
        "password": "1EOzKgwuUx",
    },
    {
        "full_name": "Мухитова Асылай Мухитовна",
        "email": "mukhitova_asylay_co@yandextaxi.kz",
        "participation_status": "not_participating",
        "username": "user_mukhitova_asylay",
        "password": "nhR5CXVzS7",
    },
]

def main():
    db = SessionLocal()
    try:
        # Get or create default group
        group = db.scalar(select(Group).where(Group.status == 'active').limit(1))
        if not group:
            group = Group(name="Основная группа", status="active")
            db.add(group)
            db.flush()
            print(f"Created group: {group.name}")

        created = 0
        skipped = 0
        
        for op_data in OPERATORS:
            # Check if user already exists
            existing_user = db.scalar(select(User).where(User.username == op_data['username']))
            if existing_user:
                print(f"SKIP (exists): {op_data['username']}")
                skipped += 1
                continue

            # Check if operator with same name exists
            existing_op = db.scalar(select(Operator).where(Operator.full_name == op_data['full_name']))
            if existing_op:
                # Just create user account
                user = User(
                    full_name=op_data['full_name'],
                    username=op_data['username'],
                    password_hash=hash_password(op_data['password']),
                    role='operator',
                    operator_id=existing_op.id,
                    is_active=True,
                )
                db.add(user)
                db.flush()
                existing_op.user_id = user.id
                print(f"LINKED: {op_data['full_name']} → {op_data['username']}")
                created += 1
                continue

            # Create operator
            is_active = op_data['participation_status'] == 'participating'
            operator = Operator(
                full_name=op_data['full_name'],
                group_id=group.id,
                group_name=group.name,
                email=op_data['email'] if op_data['email'] else None,
                participation_status=op_data['participation_status'],
                position='operator',
                status='active' if is_active else 'inactive',
                is_active=is_active,
            )
            db.add(operator)
            db.flush()

            # Create user account
            user = User(
                full_name=op_data['full_name'],
                username=op_data['username'],
                password_hash=hash_password(op_data['password']),
                role='operator',
                operator_id=operator.id,
                is_active=is_active,
            )
            db.add(user)
            db.flush()
            operator.user_id = user.id

            print(f"CREATED: {op_data['full_name']} → {op_data['username']}")
            created += 1

        db.commit()
        print(f"\nDone! Created: {created}, Skipped: {skipped}")
        
    except Exception as e:
        db.rollback()
        print(f"ERROR: {e}")
        raise
    finally:
        db.close()

if __name__ == '__main__':
    main()
