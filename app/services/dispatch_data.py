"""Training copy of the fleet cabinet «Диспетчерская» (Яндекс Про для бизнеса).

Every person, phone, licence, car and order here is invented. Times are offsets from «now»,
so the cabinet always looks current. The operator's changes are kept as events
(app/services/dispatch.py) on top of these seeds.
"""

from hashlib import md5
from random import Random


def contractor_id(key: str) -> str:
    return md5(f"puls-dispatch:{key}".encode()).hexdigest()


PARKS = [
    {"id": "itaxi-krg", "name": "iTaxi", "city": "Караганда", "color": "#c9ec8f"},
    {"id": "itaxi-ala", "name": "iTaxi", "city": "Алматы", "color": "#f6c0e0"},
    {"id": "itaxi-ast", "name": "iTaxi", "city": "Астана", "color": "#b9e4f5"},
    {"id": "itaxi-courier-ala", "name": "iTaxi курьер", "city": "Алматы", "color": "#c7cdf7"},
    {"id": "dostoyny-shym", "name": "Достойный", "city": "Шымкент", "color": "#aee3ef"},
    {"id": "amanat-krg", "name": "Аманат", "city": "Караганда", "color": "#bfeccb"},
    {"id": "amanat-akt", "name": "Аманат", "city": "Актобе", "color": "#fbd2b4"},
    {"id": "jana-taraz", "name": "Jana Taxi", "city": "Тараз", "color": "#f6e0a6"},
    {"id": "global-ast", "name": "Global", "city": "Астана", "color": "#d6ccf5"},
    # Parks of the CRM training accounts: one fleet serves both work sites.
    {"id": "qazaq-ala", "name": "QAZAQ", "city": "Алматы", "color": "#f3c7c7"},
    {"id": "itaxi-trk", "name": "iTaxi", "city": "Туркестан", "color": "#d9efb8"},
    {"id": "chestny-ala", "name": "Честный", "city": "Алматы", "color": "#e8d3f3"},
    {"id": "amanat-ura", "name": "Аманат", "city": "Уральск", "color": "#c6e8e1"},
    {"id": "nol-ala", "name": "Ноль Такси", "city": "Алматы", "color": "#f7dcb9"},
    {"id": "tenge-ast", "name": "Tenge Taxi", "city": "Астана", "color": "#cfe0f8"},
    {"id": "eki-ala", "name": "EKI DONGELEK", "city": "Алматы", "color": "#e3e6b0"},
]
PARK_IDS = {p["id"] for p in PARKS}
for _park in PARKS:
    _park["park_id"] = md5(f"puls-park:{_park['id']}".encode()).hexdigest()

TARIFFS = [
    "Эконом", "Комфорт", "Комфорт+", "Business", "Минивэн", "Электро",
    "Межгород", "Курьер", "Доставка", "Грузовой", "Premier", "VIP",
]  # fmt: skip
PROVIDERS = ["Sapar", "Бумажный документооборот"]
INVENTORY = {"eda": "Яндекс Еда", "delivery": "Яндекс Доставка"}
STOCK = {"eda": 32, "delivery": 49}
THEMES = {
    "Вопросы об исполнителе": [
        "Платный найм", "Не поступают заказы", "Рейтинг и показатели", "Проблемы с Яндекс ID",
        "Обновить информацию об исполнителе", "Добавление признака «Слабослышащий»",
        "Вопрос про тестирование", "Работа приложения исполнителя",
        "Регистрация самозанятого исполнителя", "Ограничение доступа к сервису", "Покупка смены",
    ],
    "Вопросы о ТС": ["Брендинг и оклейка", "Фотоконтроль автомобиля", "Классы и тарифы автомобиля"],
    "Вопрос по заказам и бонусам": [
        "Бонус водителю за период", "Вопрос по оплате заказа", "Жалоба на пользователя",
        "Помощь с завершением заказа по тарифам Доставка/Курьер",
    ],
    "Профиль таксопарка": ["Изменить данные парка", "Доступы сотрудников"],
    "Финансы и документация": ["Закрывающие документы", "Выплаты парку"],
    "Моментальные выплаты в Яндекс Про": ["Не приходят выплаты", "Настройка выплат"],
}  # fmt: skip
WORK_RULES = [
    ("«Престиж» — автопарк", 227, False), ("Kaspi Gold", 429, False),
    ("Акция парк 0%", 1174, False),
    ("Брендинг (4%)", 38, False), ("Для всех 2%", 353, True), ("Новые водители", 37, False),
    ("Отток (не для новых регистраций)", 2823, False), ("Платный найм", 0, False),
    ("После акции — 4%", 534, False), ("Промо (4%)", 1495, False),
    ("Свободный (Яндекс 4%, Таксопарк 4%)", 20750, False), ("Курьеры 1%", 612, False),
]  # fmt: skip

ADDRESSES = {
    "Караганда": [
        "проспект Бухар-Жырау, 47", "улица Ерубаева, 35", "проспект Нуркена Абдирова, 12",
        "улица Гоголя, 51", "микрорайон Степной-2, 7", "улица Алиханова, 13",
        "ТРЦ Сити Молл, улица Бухар-Жырау, 59/2",
        "Железнодорожный вокзал, Привокзальная площадь, 1",
        "улица Язева, 9", "микрорайон Восток-5, 14",
    ],
    "Алматы": [
        "проспект Абая, 164/8", "улица Толе би, 286", "микрорайон Самал-3, 25",
        "проспект Достык, 220",
        "улица Жандосова, 58", "Mega Alma-Ata, улица Розыбакиева, 247А", "микрорайон Аксай-4, 17",
        "улица Сатпаева, 90/20", "Аэропорт Алматы, улица Майлина, 2", "улица Кабанбай батыра, 115",
    ],
    "Астана": [
        "проспект Мангилик Ел, 55", "улица Кенесары, 40", "проспект Кабанбай батыра, 62",
        "Хан Шатыр, проспект Туран, 37", "улица Сыганак, 18", "проспект Республики, 34",
        "вокзал Нурлы Жол, улица Кенесары, 1", "улица Бейбитшилик, 25", "улица Сарайшык, 5",
        "проспект Абылай хана, 21",
    ],
    "Шымкент": [
        "проспект Тауке хана, 12", "улица Байтурсынова, 45", "микрорайон Нурсат, 102",
        "улица Жибек жолы, 7", "проспект Республики, 16",
        "ТРЦ Mega Planet, проспект Тауке хана, 80",
        "улица Толе би, 26", "микрорайон Самал-1, 15", "Аэропорт Шымкент, улица Кунаева, 2",
        "улица Мадели кожа, 4",
    ],
    "Актобе": [
        "проспект Абилкайыр хана, 44", "улица Маресьева, 95", "проспект Санкибай батыра, 22",
    ],
    "Тараз": ["улица Толе би, 7", "проспект Жамбыла, 110", "улица Сулейманова, 5"],
    "Туркестан": ["улица Тауке хана, 15", "проспект Тауке хана, 2", "улица Байдибек би, 30"],
    "Уральск": ["проспект Абая, 42", "улица Курмангазы, 180", "улица Сырыма Датова, 9"],
}  # fmt: skip


def car(brand, model, year, color, plate, tariffs, **extra):
    return {
        "brand": brand, "model": model, "year": year, "color": color, "plate": plate,
        "callsign": plate, "vin": extra.pop("vin", ""), "tariffs": tariffs, "wrap": False,
        "wrap_checked": False, "lightbox": False, "transmission": "Автоматическая",
        "fuel": "Бензин", **extra,
    }  # fmt: skip


def driver(key, park, last, first, middle, phone, license_no, **extra):
    base = {
        "key": key, "id": contractor_id(key), "park": park,
        "last_name": last, "first_name": first, "middle_name": middle, "phone": phone,
        "license": license_no, "license_country": "Казахстан",
        "segment": "active", "works": True, "status": "free", "gps": True,
        "employment": "Парковый самозанятый", "profession": "Водитель такси",
        "rule": "Свободный (Яндекс 4%, Таксопарк 4%)", "provider": "Sapar",
        "balance": 0.0, "account_limit": -50, "rating": 4.9, "car": None, "thermobox": None,
        "diagnostics": [], "acceptance": 30, "refuel": False, "bonus": None, "comment": "",
        "source": "Канал не указан", "device": "Redmi Note 12", "app_version": "13.69 (31712)",
        "created_days": 400, "photo_days": [6, 18], "iin": "", "address": "", "orders": 6,
        # CRM side of the same account: its number, trip counts and CRM-only switches.
        "crm_id": None, "driver_no": None, "stats": None, "cash_limit": False,
    }  # fmt: skip
    base.update(extra)
    seed = Random(key)
    base.setdefault("license_issued_days", 900 + seed.randrange(2500))
    base.setdefault("experience_days", base["license_issued_days"] + seed.randrange(300, 2000))
    return base


GPS = "Восстановите сигнал GPS"
BLOCKED = (
    "Сервис ограничил доступ к заказам. Причину и решение может проверить только поддержка Яндекса"
)

DRIVERS = [
    # iTaxi · Караганда — the park the cabinet opens with.
    driver(
        "zhumabayev", "itaxi-krg", "Жумабаев", "Ерлан", "Серикович", "+77014829154", "KA482915",
        provider="Бумажный документооборот", balance=3450.2, rating=4.93, status="free",
        iin="900214300517", address="Караганда", created_days=520, refuel=True,
        car=car(
            "Toyota", "Camry", 2019, "Белый", "512AKZ09",
            ["Эконом", "Комфорт", "Курьер", "Доставка"], vin="JTNB11HK103456781",
        ),
    ),
    driver(
        "zhumabayev-old", "itaxi-krg", "Жумабаев", "Ерлан", "Серикович", "+77014829154", "KA482915",
        provider="Бумажный документооборот", segment="archive", works=False, status="offline",
        rule="Для всех 2%", rating=None, iin="900214300517", created_days=2080, orders=0,
        photo_days=[1460], car=car("Daewoo", "Nexia", 2012, "Серебристый", "731BCA09", ["Эконом"]),
    ),
    driver(
        "kim", "itaxi-krg", "Ким", "Виктор", "Андреевич", "+77057314482", "MV305117",
        status="offline", gps=False, diagnostics=[GPS], balance=1210.0, rating=4.81,
        iin="870903300218", created_days=310,
        car=car("Chevrolet", "Cobalt", 2021, "Белый", "318KVA09", ["Эконом", "Курьер"]),
    ),
    driver(
        "seitkaziyev", "itaxi-krg", "Сейтказиев", "Нурлан", "Болатович", "+77022450913", "NB771402",
        status="busy", balance=8755.4, rating=4.97, iin="920517300644", created_days=760,
        car=car(
            "Toyota", "Camry", 2020, "Чёрный", "095NBS09", ["Эконом", "Курьер", "Доставка"],
            vin="JTNB11HK705512390",
        ),
    ),
    driver(
        "akhmetov", "itaxi-krg", "Ахметов", "Данияр", "Маратович", "+77756102284", "KZ118456",
        status="order", balance=15420.0, rating=4.98, refuel=True, created_days=1210,
        car=car(
            "Kia", "K5", 2022, "Серый", "777DAK09", ["Эконом", "Комфорт", "Комфорт+"],
            wrap=True, wrap_checked=True,
        ),
        bonus={"done": 90, "target": 90, "amount": 16000},
    ),
    driver(
        "baimukhanova", "itaxi-krg", "Баймуханова", "Салтанат", "Ериковна", "+77473390516",
        "AA630294", status="free", balance=640.5, rating=4.89, created_days=95,
        car=car("Hyundai", "Accent", 2020, "Белый", "406SBE09", ["Эконом", "Курьер"], wrap=True),
        bonus={"done": 41, "target": 70, "amount": 9000},
    ),
    driver(
        "lee", "itaxi-krg", "Ли", "Максим", "Олегович", "+77089157730", "MR904562", segment="new",
        status="offline", balance=0.0, rating=None, created_days=6, orders=2, photo_days=[5],
        car=car("Kia", "Rio", 2023, "Синий", "220LMO09", ["Эконом"]),
    ),
    driver(
        "sarsenbayev", "itaxi-krg", "Сарсенбаев", "Ильяс", "Нурланович", "+77712048861", "HM225871",
        segment="churn", works=False, status="offline", balance=-35.0, rating=4.62,
        created_days=980, orders=0, photo_days=[190],
        car=car("Nissan", "Almera", 2016, "Серебристый", "583IAS09", ["Эконом"]),
    ),
    # iTaxi · Алматы.
    driver(
        "zhaksylykov", "itaxi-ala", "Жаксылыков", "Арман", "Тимурович", "+77019004417", "AF447120",
        status="order", balance=5320.0, rating=4.95,
        car=car("Hyundai", "Sonata", 2021, "Серый", "144ARZ02", ["Эконом", "Комфорт"]),
    ),
    driver(
        "yessenova", "itaxi-ala", "Есенова", "Мадина", "Кайратовна", "+77776630942", "KZ730815",
        status="free", balance=870.0, rating=4.9,
        car=car("Chevrolet", "Onix", 2023, "Красный", "418MKE02", ["Эконом", "Курьер"]),
    ),
    # iTaxi курьер · Алматы: couriers without a car.
    driver(
        "ospanova", "itaxi-courier-ala", "Оспанова", "Дана", "Ерлановна", "+77771093346", "",
        profession="Курьер", employment="Самозанятый", rule="Курьеры 1%", status="offline",
        balance=2140.0, rating=4.96, created_days=40, orders=5, photo_days=[3],
    ),
    driver(
        "tokhtarov", "itaxi-courier-ala", "Тохтаров", "Алихан", "Нурланович", "+77055218803", "",
        profession="Курьер", employment="Самозанятый", rule="Курьеры 1%", status="order",
        balance=6480.0, rating=4.92, thermobox={"type": "delivery", "number": "DL0412"},
    ),
    # Достойный · Шымкент.
    driver(
        "mamyrov", "dostoyny-shym", "Мамыров", "Асхат", "Кайратович", "+77084417320", "RS558210",
        status="offline", diagnostics=[BLOCKED], balance=4390.0, rating=4.86,
        iin="890412300733", created_days=640,
        car=car("Hyundai", "Sonata", 2019, "Серый", "544HFO17", ["Эконом", "Комфорт"]),
    ),
    driver(
        "tulegenov", "dostoyny-shym", "Тулегенов", "Бауыржан", "Маратович", "+77019362815",
        "AT604921", status="busy", balance=20691.85, rating=4.96, iin="910728300415",
        created_days=870, acceptance=30, bonus={"done": 90, "target": 90, "amount": 16000},
        car=car("Kia", "K5", 2021, "Белый", "310BTK17", ["Эконом", "Комфорт"]),
    ),
    # iTaxi · Астана.
    driver(
        "abenov", "itaxi-ast", "Абенов", "Руслан", "Даулетович", "+77078150244", "AF918350",
        status="free", balance=5230.0, rating=4.91, iin="930301300172", created_days=450,
        car=car("Toyota", "Corolla", 2020, "Белый", "816AMO01", ["Эконом", "Курьер"]),
    ),
    driver(
        "nurzhanova", "itaxi-ast", "Нуржанова", "Айгерим", "Сапаровна", "+77761420587", "KZ402733",
        status="free", balance=61200.0, rating=4.99, iin="950611400286", created_days=1300,
        car=car(
            "Toyota", "Camry", 2022, "Чёрный", "007ANS01",
            ["Эконом", "Комфорт", "Комфорт+", "Межгород"],
        ),
    ),
    # Other parks, so the park list is not empty.
    driver(
        "kaliyev", "amanat-krg", "Калиев", "Айдос", "Серикович", "+77027741190", "HM530447",
        status="free", balance=1900.0,
        car=car("Lada", "Vesta", 2021, "Серый", "271AKS09", ["Эконом"]),
    ),
    driver(
        "utepova", "amanat-akt", "Утепова", "Жанна", "Бекболатовна", "+77762285013", "MR118930",
        status="offline", balance=300.0, rating=4.84,
        car=car("Chevrolet", "Nexia", 2021, "Белый", "630UZH04", ["Эконом"]),
    ),
    driver(
        "iskakov", "jana-taraz", "Искаков", "Бекзат", "Ерланович", "+77781504472", "KZ661205",
        status="order", balance=2750.0,
        car=car("Hyundai", "Elantra", 2020, "Чёрный", "777BIE08", ["Эконом", "Комфорт"]),
    ),
    driver(
        "omarova", "global-ast", "Омарова", "Алия", "Нуржановна", "+77016603258", "AA905518",
        status="free", balance=4410.0, rating=4.97,
        car=car("Kia", "Cerato", 2022, "Серый", "512AOM01", ["Эконом", "Комфорт"]),
    ),
]  # fmt: skip
# The training accounts of CRM «Учётные записи водителей»; their account IDs stay as they were.
CRM_DRIVERS = [
    driver(
        "baibosynov", "qazaq-ala", "Байбосынов", "Самат", "Ерланович", "+77055607794", "MR993753",
        id="ddcd8d21379f4694aa01eff73e5aadc1", crm_id=11046706, driver_no=823544,
        employment="Физическое лицо", rule="Для всех 2%", status="busy", rating=None,
        created_days=8, orders=0, photo_days=[], stats=[0, 0, 0, 0],
        car=car("Nissan", "Cefiro", 1995, "Чёрный", "803ASD02", ["Эконом", "Курьер", "Доставка"],
                callsign="altynbek_op"),
    ),
    driver(
        "zhumabekov", "itaxi-trk", "Жумабеков", "Нурлан", "Кайратович", "+77012345601", "HM945636",
        id="19550946448b4b21a86008657bcae625", crm_id=11046705, driver_no=1006074,
        status="offline", balance=1250.0, rating=4.7, created_days=9, stats=[3, 21, 88, 412],
        address="г. Туркестан, ул. Тауке хана, 15", iin="880314300512",
        car=car("Hyundai", "Accent", 2019, "Белый", "512KLM13", ["Эконом", "Курьер", "Доставка"]),
    ),
    driver(
        "saparova", "itaxi-ala", "Сапарова", "Айгерим", "Маратовна", "+77471112233", "KZ897519",
        id="2a06d17a5b00451db3b7bf91b76423da", crm_id=11046704, driver_no=1548803,
        employment="Физическое лицо", rule="Для всех 2%", works=False, status="offline",
        balance=-50.0, rating=4.8, segment="new", created_days=10, orders=0, stats=[0, 0, 0, 0],
        car=car("Kia", "Rio", 2021, "Серый", "771ABE02", ["Эконом", "Курьер", "Доставка"]),
    ),
    driver(
        "omarov", "itaxi-ala", "Омаров", "Ерлан", "Сериккалиевич", "+77089876543", "AA849402",
        id="830572280daf44c89f40c56e9409b373", crm_id=11046703, driver_no=1548802,
        employment="Физическое лицо", rule="Для всех 2%", status="free", balance=3400.0,
        rating=4.9, created_days=11, photo_days=[], stats=[5, 34, 140, 960],
        car=car("Toyota", "Camry", 2018, "Белый", "120BCD02", ["Эконом", "Комфорт", "Комфорт+"]),
    ),
    driver(
        "kasymov", "itaxi-ala", "Касымов", "Данияр", "Болатович", "+77773334455", "MR801285",
        id="57673c362b6041f0a9c1bb6a4629f613", crm_id=11046702, driver_no=603011,
        employment="Физическое лицо", rule="Для всех 2%", status="offline", rating=None,
        created_days=12, stats=[0, 12, 57, 301],
        car=car("Chevrolet", "Cobalt", 2022, "Серебристый", "305CAT02", ["Эконом", "Курьер"]),
    ),
    driver(
        "akhmetova", "chestny-ala", "Ахметова", "Динара", "Асылбековна", "+77025556677", "HM753168",
        id="390d464b21d847f2a0b26a7143b7aa5f", crm_id=11046701, driver_no=1548801,
        employment="Физическое лицо", rule="Для всех 2%", status="offline", balance=870.0,
        rating=4.7, created_days=13, stats=[1, 9, 33, 75],
        car=car("Chevrolet", "Onix", 2023, "Красный", "418DKZ02", ["Эконом", "Курьер"]),
    ),
    driver(
        "tleubaev", "amanat-ura", "Тлеубаев", "Арман", "Сейтжанович", "+77057778899", "KZ705051",
        id="ce6fef80007049aea677a3b7dda0f8db", crm_id=11046700, driver_no=1528022,
        status="offline", balance=15.0, rating=4.8, created_days=14, photo_days=[],
        stats=[2, 17, 61, 544], address="г. Уральск, пр. Абая, 42", iin="910705300118",
        car=car("Lada", "Vesta", 2020, "Синий", "221ARM07", ["Эконом", "Курьер"]),
    ),
    driver(
        "mukhamedzhanov", "nol-ala", "Мухамеджанов", "Руслан", "Айдарович", "+77019990011",
        "AA656934", id="18a831202ec44b9f97ae6ee49e6068aa", crm_id=11046699, driver_no=1548800,
        employment="Физическое лицо", rule="Для всех 2%", status="busy", balance=-30.0,
        rating=4.9, created_days=15, stats=[7, 40, 152, 1203],
        car=car("Hyundai", "Elantra", 2020, "Чёрный", "909RUS02", ["Эконом", "Комфорт"]),
    ),
    driver(
        "ismailova", "jana-taraz", "Исмаилова", "Гульнара", "Ержановна", "+77478880022", "MR608817",
        id="4b790a4be2bb47e2b4c7f11b9e054473", crm_id=11046698, driver_no=1548799,
        status="busy", balance=2200.0, rating=None, created_days=16, stats=[4, 26, 97, 388],
        address="г. Тараз, ул. Толе би, 7", iin="930211400327",
        car=car("Kia", "K5", 2022, "Белый", "777JTZ08", ["Эконом", "Комфорт", "Комфорт+"]),
    ),
    driver(
        "nurpeisov", "tenge-ast", "Нурпеисов", "Бауыржан", "Талгатович", "+77086661133", "HM560700",
        id="f569ca4a25b84d00ae1324d34f49b48e", crm_id=11046697, driver_no=1532275,
        employment="Физическое лицо", rule="Для всех 2%", status="busy", balance=540.0,
        rating=4.9, created_days=17, photo_days=[], stats=[6, 31, 118, 877],
        car=car("Skoda", "Rapid", 2019, "Серый", "045TNG01", ["Эконом", "Курьер"]),
    ),
    driver(
        "abdrakhmanov", "eki-ala", "Абдрахманов", "Ильяс", "Муратович", "+77752224466", "KZ512583",
        id="bfcb98ee71d54682be284538b31985fd", crm_id=11046696, driver_no=1548798,
        employment="Физическое лицо", rule="Для всех 2%", status="offline", rating=4.8,
        created_days=18, stats=[0, 3, 20, 44], cash_limit=True,
        car=car("Volkswagen", "Polo", 2021, "Белый", "632EKI02", ["Эконом", "Курьер"]),
    ),
    driver(
        "serikbaeva", "itaxi-courier-ala", "Серикбаева", "Жанар", "Кенжебековна", "+77013337799",
        "AA464466", id="06eb1317b88c437bb52896390123f621", crm_id=11046695, driver_no=1547402,
        employment="Физическое лицо", profession="Курьер", rule="Курьеры 1%", status="offline",
        balance=90.0, rating=None, created_days=19, photo_days=[], stats=[0, 5, 22, 130],
        car=car("Chevrolet", "Spark", 2020, "Жёлтый", "150DLV02", ["Курьер", "Доставка"]),
    ),
]  # fmt: skip
DRIVERS += CRM_DRIVERS
# Every fleet account has a CRM number too.
for _index, _driver in enumerate(DRIVERS):
    _driver["crm_id"] = _driver["crm_id"] or 11046000 + _index
    _driver["driver_no"] = _driver["driver_no"] or 1_540_000 + _index * 37
DRIVER_KEYS = {d["key"]: d for d in DRIVERS}

# Orders that the withdrawal-limit calls are about. Their tariff decides the answer.
SCENARIO_ORDERS = {
    "abenov": [
        {"id": "65804916", "minutes_ago": 95, "tariff": "Эконом", "duration": 53, "distance": 0.0,
         "price": 700.0, "payment": "card", "from": "проспект Мангилик Ел, 55",
         "to": "улица Сыганак, 18"},
    ],
    "nurzhanova": [
        {"id": "65812440", "minutes_ago": 1450, "tariff": "Межгород", "duration": 10090,
         "distance": 213.4, "price": 48500.0, "payment": "card",
         "from": "Астана, проспект Кабанбай батыра, 62", "to": "Караганда, улица Ерубаева, 35"},
    ],
    "tulegenov": [
        {"id": "65755156", "minutes_ago": 60 * 24 * 62, "tariff": "Эконом", "duration": 940,
         "distance": 6.8, "price": 536.0, "payment": "card", "from": "улица Байтурсынова, 45",
         "to": "ТРЦ Mega Planet, проспект Тауке хана, 80"},
    ],
}  # fmt: skip
# Rows of «Антифрод»; the grey amount on a balance is the sum of the driver's rows.
ANTIFRAUD = [
    {"driver": "tulegenov", "amount": 16000.0, "rule": "Не сданы закрывающие документы",
     "value": "16 000,00 ₸", "limit": "0,00 ₸", "minutes_ago": 540, "order": None},
    {"driver": "tulegenov", "amount": 536.0, "rule": "Не сданы закрывающие документы",
     "value": "536,00 ₸", "limit": "0,00 ₸", "minutes_ago": 60 * 24 * 62, "order": "65755156"},
    {"driver": "tulegenov", "amount": -61.06, "rule": "Не сданы закрывающие документы",
     "value": "-61,06 ₸", "limit": "0,00 ₸", "minutes_ago": 60 * 24 * 62, "order": "65755156"},
    {"driver": "abenov", "amount": 700.0, "rule": "Продолжительность поездки", "value": "53 с",
     "limit": "2 мин", "minutes_ago": 95, "order": "65804916"},
    {"driver": "nurzhanova", "amount": 48500.0, "rule": "Стоимость поездки",
     "value": "48 500,00 ₸", "limit": "30 000,00 ₸", "minutes_ago": 1450, "order": "65812440"},
]  # fmt: skip
ANTIFRAUD_RULES = [
    "Стоимость поездки", "Продолжительность поездки", "Стоимость минуты", "Сумма чаевых",
    "Размер бонуса", "Не сданы закрывающие документы", "Финансовая ведомость", "На паузе",
]  # fmt: skip

TICKETS = [
    ("ДД! Просим дать заказы водителю, после смены авто не поступают", "Вопросы об исполнителе",
     "Не поступают заказы", "Закрыт", "zhanibek_a_co", 40, 1500),
    ("ДД! Прошу проверить, водитель прошёл фотоконтроль термокороба, но баллы не начислены",
     "Вопросы об исполнителе", "Рейтинг и показатели", "Выполнен", "kenzhebek_d_co", 75, 1560),
    ("ДД! Водитель выполнил 10 заказов, но 1 не вошёл в цель. Прошу проверить",
     "Вопрос по заказам и бонусам", "Бонус водителю за период", "Выполнен", "kassym_m_co", 130,
     1580),
    ("ДД! Прошу проверить ограничение доступа, водитель не согласен с решением",
     "Вопросы об исполнителе", "Ограничение доступа к сервису", "Выполнен", "orumbay_g_co", 200,
     1800),
    ("ДД! Почему заказ не вышел по межгороду? Водитель просит пересчитать",
     "Вопрос по заказам и бонусам", "Вопрос по оплате заказа", "Выполнен", "muratuly_m_co", 250,
     2900),
    ("ДД! Прошу уточнить, по какой причине снизили 15 баллов приоритета", "Вопросы об исполнителе",
     "Рейтинг и показатели", "Закрыт", "rakhim_b_co", 330, 4100),
]  # fmt: skip
INVENTORY_LOG = [
    ("tolegen_a_co", "Айтмагамбет Медет Болатулы", "issue", "eda", 3),
    ("irismet_z_co", "Цой Ян Александрович", "issue", "delivery", 33),
    ("kenzhebek_d_co", "Смагулов Алибек Куандыкович", "issue", "eda", 52),
    ("nurganat_n_co", "Гицу Дмитрий Дмитриевич", "issue", "eda", 85),
    ("erlan_t_co", "Гицу Дмитрий Дмитриевич", "return", "eda", 85),
    ("kelis_s_co", "Турабеков Тимур Дамирович", "issue", "eda", 86),
    ("zharylkasyn_z_co", "Айдарбеков Руслан Аскарович", "issue", "eda", 285),
    ("faustova_d", "Исполнитель из другого парка", "issue", "eda", 378),
]  # fmt: skip
TRAINING_DOMAIN = "training.kz"

# One set of answers for every withdrawal-limit call: the rule and the order decide which is right.
LIMIT_OPTIONS = [
    ["auto", "Снять нельзя: лимит снимется сам, когда Яндекс проверит закрывающие документы"],
    ["ooz", "Отправлю запрос в CRM — отдел ООЗ снимет лимит"],
    ["intercity", "Снять нельзя: заказ выполнен по тарифу «Межгород»"],
]
# Calls the mascot brings, grouped by city mission. `answer` calls are solved by the right
# answer, the other calls by the operator's own change in the cabinet, checked on the server.
CALLS = [
    {
        "id": "provider", "mission": "dispatch_driver", "driver": "zhumabayev", "kind": "action",
        "title": "Проверить провайдера",
        "speech": (
            "Здравствуйте! Мне сказали, что у меня не тот провайдер документов. Проверьте, "
            "пожалуйста. Мой ВУ — KA482915."
        ),
        "goal": (
            "Найди водителя по номеру ВУ, открой активный аккаунт и поставь провайдера ЭДО "
            "«Sapar»."
        ),
        "steps": [
            "Проверь парк в правом верхнем углу: водитель из iTaxi, Караганда.",
            "Нажми поиск и введи номер ВУ. У водителя два аккаунта — открой тот, что «Работает».",
            "Во вкладке «Детали» выбери провайдера ЭДО «Sapar» и нажми «Сохранить».",
        ],
        "done": (
            "Провайдер Sapar стоит на активном аккаунте. Архивный аккаунт водитель не использует — "
            "его не трогаем."
        ),
    },
    {
        "id": "gps", "mission": "dispatch_driver", "driver": "kim", "kind": "answer",
        "title": "Не выходит на линию",
        "speech": (
            "Не могу выйти на линию, приложение не пускает. Что случилось? Мой номер +7 705 731 44 "
            "82."
        ),
        "goal": (
            "Открой водителя и посмотри «Диагностику» в шапке карточки: там написано, что мешает "
            "выйти на линию."
        ),
        "steps": [
            "Найди водителя по номеру телефона.",
            "В шапке карточки нажми «Диагностика».",
            "Выбери ответ водителю.",
        ],
        "question": "Что ответишь водителю?",
        "options": [
            ["gps", "Включите геолокацию: приложению не хватает сигнала GPS"],
            ["balance", "Пополните баланс — он ниже лимита"],
            ["photo", "Пройдите фотоконтроль автомобиля"],
            ["provider", "Смените провайдера на Sapar"],
        ],
        "correct": "gps",
        "hint": (
            "Открой «Диагностику» в шапке карточки водителя: там перечислено всё, что мешает выйти "
            "на линию."
        ),
        "done": (
            "Верно: в «Диагностике» написано «Восстановите сигнал GPS». Водителю нужно включить "
            "геолокацию для Яндекс Про."
        ),
    },
    {
        "id": "car", "mission": "dispatch_car", "driver": "seitkaziyev", "kind": "action",
        "title": "Тариф и оклейка",
        "speech": (
            "Добрый день! Подключите мне тариф «Комфорт» — у меня Camry 2020 года. И я оклеил "
            "машину брендингом Яндекса."
        ),
        "goal": (
            "Во вкладке «Автомобиль» добавь тариф «Комфорт», включи «Оклейку» и нажми «Сохранить»."
        ),
        "steps": [
            "Найди водителя и открой вкладку «Автомобиль».",
            "В «Тарифах» добавь «Комфорт», остальные тарифы оставь.",
            "В «Комплектации и брендинге» отметь «Оклейка» и нажми «Сохранить».",
        ],
        "done": (
            "Комфорт подключён, оклейка включена. Крестик рядом с «Оклейкой» — фотоконтроль "
            "брендинга ещё не пройден: скажи водителю пройти его в Яндекс Про, тогда появится "
            "галочка."
        ),
    },
    {
        "id": "thermobox", "mission": "dispatch_inventory", "driver": "ospanova", "kind": "action",
        "title": "Выдать термокороб",
        "speech": (
            "Здравствуйте! Я курьер iTaxi курьер, Алматы — Оспанова Дана. Мне нужен жёлтый "
            "термокороб Яндекс Еды."
        ),
        "goal": (
            "В «Инвентаре» выбери парк курьера, нажми «+», выбери «Яндекс Еда», впиши мой код и "
            "номер с термокороба."
        ),
        "code": True,
        "steps": [
            "Открой «Инвентарь» и выбери в правом верхнем углу парк курьера и его город.",
            "Нажми «+» и выбери тип: Яндекс Еда — жёлтый короб, Яндекс Доставка — чёрный.",
            (
                "Попроси у меня код: он в Яндекс Про → Профиль → Инвентарь → Получить код и живёт "
                "2 минуты."
            ),
            "Напиши номер на термокоробе, впиши его в третье поле и нажми «Сохранить».",
        ],
        "done": (
            "Термокороб выдан и появился в списке. Теперь курьеру нужно пройти фотоконтроль "
            "термокороба в приложении — за это начислят баллы приоритета."
        ),
    },
    {
        "id": "support", "mission": "dispatch_support", "driver": "mamyrov", "kind": "action",
        "title": "Ограничили доступ",
        "speech": (
            "Мне ограничили доступ к заказам, а я ничего не нарушал. Разберитесь, пожалуйста. Мой "
            "ВУ RS558210."
        ),
        "goal": (
            "Посмотри «Диагностику» водителя. Снять ограничение может только поддержка Яндекса — "
            "создай обращение в «Техподдержке»."
        ),
        "steps": [
            "Выбери парк водителя: Достойный, Шымкент. Найди его по ВУ и открой «Диагностику».",
            "Открой «Техподдержку», нажми «+». «Доступ: мне и моей роли» оставь выключенным.",
            "Тема «Вопросы об исполнителе», подтема «Ограничение доступа к сервису».",
            (
                "Впиши номер ВУ водителя и текст, который начинается с «ДД! Прошу проверить…». "
                "Нажми «Отправить»."
            ),
        ],
        "done": (
            "Обращение ушло в поддержку Яндекса. Ответ придёт в «Мои обращения» — статус сменится "
            "на «Выполнен»."
        ),
    },
    {
        "id": "limit_docs", "mission": "dispatch_limit", "driver": "tulegenov", "kind": "answer",
        "title": "Серая сумма на балансе",
        "speech": "Не могу вывести деньги: часть суммы серая, с замочком. Можно её снять?",
        "goal": (
            "Нажми на серую сумму в «Состоянии счёта» водителя и посмотри правило в «Антифроде»."
        ),
        "steps": [
            "Выбери парк водителя: Достойный, Шымкент. Найди и открой водителя.",
            "В шапке нажми на серую сумму с замком — это лимит на вывод.",
            "Посмотри, по какому правилу удержаны деньги, и ответь водителю.",
        ],
        "question": "Что ответишь водителю?",
        "options": LIMIT_OPTIONS,
        "correct": "auto",
        "hint": (
            "Посмотри столбец «Правило» в «Антифроде»: какое правило там стоит у этого водителя?"
        ),
        "done": (
            "Верно: «Не сданы закрывающие документы». Этот лимит мы не снимаем — он снимется "
            "автоматически после проверки документов Яндексом."
        ),
    },
    {
        "id": "limit_duration", "mission": "dispatch_limit", "driver": "abenov", "kind": "answer",
        "title": "Короткая поездка",
        "speech": "После короткой поездки мне заморозили 700 ₸. Снимите, пожалуйста.",
        "goal": (
            "Найди правило в «Антифроде», открой заказ и проверь тариф. Не «Межгород» — лимит "
            "снимает ООЗ по запросу из CRM."
        ),
        "steps": [
            "Выбери парк: iTaxi, Астана. Открой водителя и нажми на серую сумму.",
            "Правило «Продолжительность поездки»: нажми на номер заказа и посмотри тариф.",
            (
                "Ответь водителю. Если лимит снимает ООЗ — создай в CRM обращение «Снятие лимита» "
                "со ссылкой на аккаунт."
            ),
        ],
        "question": "Что ответишь водителю?",
        "options": LIMIT_OPTIONS,
        "correct": "ooz",
        "crm": True,
        "hint": "Открой заказ из строки «Антифрода» и посмотри «Тариф» в описании заказа.",
        "done": (
            "Верно: заказ по тарифу «Эконом», не «Межгород». Лимит снимает отдел ООЗ — теперь "
            "создай в CRM обращение «Снятие лимита» со ссылкой на аккаунт водителя."
        ),
    },
    {
        "id": "limit_intercity", "mission": "dispatch_limit", "driver": "nurzhanova",
        "kind": "answer", "title": "Дорогая поездка",
        "speech": (
            "За вчерашнюю поездку в Караганду мне заблокировали 48 500 ₸. Разблокируйте, "
            "пожалуйста."
        ),
        "goal": "Найди правило в «Антифроде», открой заказ и проверь его тариф.",
        "steps": [
            "Выбери парк: iTaxi, Астана. Открой водителя и нажми на серую сумму.",
            "Правило «Стоимость поездки»: нажми на номер заказа и посмотри тариф.",
            "Ответь водителю.",
        ],
        "question": "Что ответишь водителю?",
        "options": LIMIT_OPTIONS,
        "correct": "intercity",
        "hint": (
            "Открой заказ из «Антифрода»: в «Описании» указан тариф. Для какого тарифа ООЗ лимит "
            "не снимает?"
        ),
        "done": "Верно: заказ выполнен по тарифу «Межгород» — такой лимит ООЗ не снимает.",
    },
]  # fmt: skip
CALL_IDS = {c["id"]: c for c in CALLS}
# How many calls each city mission can count: the most a trainer may ask for.
MISSION_CALLS = {}
for _call in CALLS:
    MISSION_CALLS.setdefault(_call["mission"], []).append(_call["id"])
