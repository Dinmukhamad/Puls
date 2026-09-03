import type {
  AppNotification,
  Chapter,
  DeviceSession,
  Grade,
  GradeId,
  HourlyLoad,
  KnowledgeTest,
  LedgerEntry,
  Mission,
  NavGroup,
  Operator,
  Raffle,
  ShopItem,
  Team,
  TeamId,
  WeeklyPoint,
  WheelSector,
} from './types';

export const PERIOD_LABEL = 'W35';
export const PERIOD_RANGE = '25 — 31 августа';

/* ── Квалификации ────────────────────────────────────────── */

export const GRADES: Record<GradeId, Grade> = {
  trainee: {
    id: 'trainee',
    name: 'Стажёр',
    multiplier: 0.8,
    minQuality: 0,
    minDensity: 0,
    description: 'Первые недели на линии. Начисление понижено, пока идёт обучение.',
  },
  junior: {
    id: 'junior',
    name: 'Новичок',
    multiplier: 1.0,
    minQuality: 85,
    minDensity: 6,
    description: 'Базовая ступень: работает самостоятельно, начисление без коэффициента.',
  },
  operator: {
    id: 'operator',
    name: 'Оператор',
    multiplier: 1.2,
    minQuality: 90,
    minDensity: 8,
    description: 'Устойчивое качество и плотность. Основная масса линии.',
  },
  pro: {
    id: 'pro',
    name: 'Профи',
    multiplier: 1.5,
    minQuality: 94,
    minDensity: 10,
    description: 'Наставники и разбор сложных обращений. Максимальный множитель.',
  },
};

export const GRADE_ORDER: GradeId[] = ['trainee', 'junior', 'operator', 'pro'];

/* ── Команды ─────────────────────────────────────────────── */

export const TEAMS: Record<TeamId, Team> = {
  alpha: { id: 'alpha', name: 'Альфа', lead: 'Ирина Соколова' },
  beta: { id: 'beta', name: 'Бета', lead: 'Марат Жунусов' },
  gamma: { id: 'gamma', name: 'Гамма', lead: 'Ольга Крылова' },
  delta: { id: 'delta', name: 'Дельта', lead: 'Тимур Ахметов' },
};

export const TEAM_ORDER: TeamId[] = ['alpha', 'beta', 'gamma', 'delta'];

/* ── Операторы ───────────────────────────────────────────── */

/**
 * Имена разложены по роду и склеиваются только внутри своей группы.
 * Смешивать списки нельзя: получаются «Комарова Дмитрий» и «Жуков Елена»,
 * и весь экран сразу читается как сгенерированный на скорую руку.
 */
const NAMES = {
  male: {
    first: ['Алексей', 'Дмитрий', 'Сергей', 'Игорь', 'Никита', 'Артём', 'Роман', 'Максим', 'Павел', 'Виктор', 'Данил', 'Тимур'],
    last: ['Иванов', 'Сидоров', 'Новиков', 'Волков', 'Соловьёв', 'Орлов', 'Жуков', 'Ершов', 'Фомин', 'Тихонов', 'Сафин', 'Кузнецов'],
  },
  female: {
    first: ['Мария', 'Анна', 'Елена', 'Ольга', 'Дарья', 'Ксения', 'Полина', 'Юлия', 'Алина', 'София', 'Вера', 'Камила'],
    last: ['Петрова', 'Козлова', 'Морозова', 'Зайцева', 'Лебедева', 'Титова', 'Белова', 'Комарова', 'Гусева', 'Дроздова', 'Юсупова', 'Абдуллаева'],
  },
} as const;

/**
 * Генератор с фиксированным зерном. Данные должны быть одинаковыми при
 * каждой загрузке: иначе рейтинг перетасовывается на глазах, и невозможно
 * ни обсудить конкретную строку, ни поймать ошибку в расчёте.
 */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function buildOperators(): Operator[] {
  const rnd = seeded(20260835);
  const list: Operator[] = [];

  for (let i = 0; i < 48; i += 1) {
    // Чередуем род, а внутри рода берём пару так, чтобы все 48 имён были
    // разными: смещение фамилии на втором круге даёт новые сочетания.
    const set = i % 2 === 0 ? NAMES.male : NAMES.female;
    const slot = Math.floor(i / 2);
    const size = set.first.length;
    const first = set.first[slot % size];
    const last = set.last[(slot + Math.floor(slot / size) * 5) % size];
    const teamId = TEAM_ORDER[i % TEAM_ORDER.length];
    const hiredWeeksAgo = 1 + Math.floor(rnd() * 90);

    // Качество тянется к 91 с разбросом: реальная линия не бывает ровной,
    // но и не бывает равномерно случайной.
    const quality = clamp(round1(84 + rnd() * 14 - (hiredWeeksAgo < 6 ? 3 : 0)), 72, 99);
    const density = clamp(round1(5.5 + rnd() * 7), 4, 14);
    const hours = clamp(round1(28 + rnd() * 14), 12, 44);
    const penaltyMinutes = Math.round(rnd() * 26);
    const auditedCalls = 8 + Math.floor(rnd() * 120);

    const gradeId = pickGrade(quality, density, hiredWeeksAgo);

    list.push({
      id: `op-${String(i + 1).padStart(2, '0')}`,
      name: `${last} ${first}`,
      teamId,
      gradeId,
      metrics: { quality, density, hours, penaltyMinutes, auditedCalls },
      coins: 120 + Math.floor(rnd() * 900),
      tickets: Math.floor(rnd() * 4),
      hiredWeeksAgo,
    });
  }
  return list;
}

function pickGrade(quality: number, density: number, weeks: number): GradeId {
  if (weeks < 6) return 'trainee';
  if (quality >= GRADES.pro.minQuality && density >= GRADES.pro.minDensity) return 'pro';
  if (quality >= GRADES.operator.minQuality && density >= GRADES.operator.minDensity) return 'operator';
  return 'junior';
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

export const OPERATORS: Operator[] = buildOperators();

/** Оператор, под которым работает демонстрация роли «Оператор». */
export const ME_ID = 'op-07';

/* ── Миссии ──────────────────────────────────────────────── */

export const CHAPTERS: Chapter[] = [
  { id: 'ch-1', title: 'Испытательный горизонт', subtitle: 'Первые недели на линии' },
  { id: 'ch-2', title: 'Стандарты безупречности', subtitle: 'Качество речи и скрипты' },
  { id: 'ch-3', title: 'Турбо-смены', subtitle: 'Плотность и нагрузка' },
];

export const MISSIONS: Mission[] = [
  {
    id: 'ms-1',
    chapterId: 'ch-1',
    title: 'Первая сотня',
    summary: 'Принять сто обращений и не уйти ниже порога качества.',
    category: 'Адаптация',
    deadlineHours: null,
    steps: [
      { id: 's1', label: 'Обработано обращений', kind: 'shift', current: 100, target: 100, unit: 'шт' },
      { id: 's2', label: 'Качество речи', kind: 'quality', current: 91.4, target: 88, unit: '%' },
    ],
    rewardCoins: 150,
    rewardTickets: 1,
    state: 'ready',
  },
  {
    id: 'ms-2',
    chapterId: 'ch-1',
    title: 'Знаток регламента',
    summary: 'Сдать вводный тест по скриптам с результатом выше проходного.',
    category: 'Обучение',
    deadlineHours: 72,
    steps: [
      { id: 's1', label: 'Тест «Скрипт приветствия»', kind: 'test', current: 0, target: 1, unit: 'сдан' },
    ],
    rewardCoins: 90,
    rewardTickets: 0,
    state: 'active',
  },
  {
    id: 'ms-3',
    chapterId: 'ch-2',
    title: 'Пять девяток',
    summary: 'Держать качество не ниже 95% пять смен подряд.',
    category: 'Качество',
    deadlineHours: null,
    steps: [
      { id: 's1', label: 'Смен подряд с качеством ≥ 95%', kind: 'quality', current: 3, target: 5, unit: 'смен' },
    ],
    rewardCoins: 320,
    rewardTickets: 2,
    state: 'active',
  },
  {
    id: 'ms-4',
    chapterId: 'ch-2',
    title: 'Ноль замечаний',
    summary: 'Неделя без единой штрафной минуты.',
    category: 'Дисциплина',
    deadlineHours: 48,
    steps: [
      { id: 's1', label: 'Штрафные минуты', kind: 'manual', current: 0, target: 0, unit: 'мин' },
      { id: 's2', label: 'Отработано смен', kind: 'shift', current: 5, target: 5, unit: 'смен' },
    ],
    rewardCoins: 200,
    rewardTickets: 1,
    state: 'ready',
  },
  {
    id: 'ms-5',
    chapterId: 'ch-3',
    title: 'Плотный поток',
    summary: 'Выйти на КВЗ выше десяти при сохранении качества.',
    category: 'Плотность',
    deadlineHours: null,
    steps: [
      { id: 's1', label: 'КВЗ за период', kind: 'density', current: 8.6, target: 10, unit: 'зв/ч' },
      { id: 's2', label: 'Качество не ниже', kind: 'quality', current: 91.4, target: 90, unit: '%' },
    ],
    rewardCoins: 280,
    rewardTickets: 1,
    state: 'active',
  },
  {
    id: 'ms-6',
    chapterId: 'ch-3',
    title: 'Ночной рубеж',
    summary: 'Закрыть две ночные смены в пиковую неделю.',
    category: 'График',
    deadlineHours: null,
    steps: [{ id: 's1', label: 'Ночных смен', kind: 'shift', current: 0, target: 2, unit: 'смен' }],
    rewardCoins: 240,
    rewardTickets: 2,
    state: 'locked',
  },
];

/* ── Тесты ───────────────────────────────────────────────── */

export const TESTS: KnowledgeTest[] = [
  {
    id: 't-1',
    title: 'Скрипт приветствия',
    topic: 'Регламент разговора',
    minutes: 5,
    passPercent: 80,
    rewardCoins: 90,
    rewardTickets: 1,
    lastScore: null,
    questions: [
      {
        id: 'q1',
        text: 'С чего начинается разговор с клиентом по стандарту?',
        options: [
          { id: 'a', text: 'С названия компании, имени оператора и предложения помощи' },
          { id: 'b', text: 'С уточнения номера договора' },
          { id: 'c', text: 'С вопроса, откуда клиент узнал о компании' },
        ],
        correctOptionId: 'a',
      },
      {
        id: 'q2',
        text: 'Клиент перебивает и повышает голос. Что делает оператор первым?',
        options: [
          { id: 'a', text: 'Повышает голос в ответ, чтобы вернуть управление' },
          { id: 'b', text: 'Даёт договорить, затем проговаривает суть претензии своими словами' },
          { id: 'c', text: 'Переводит на руководителя без объяснения' },
        ],
        correctOptionId: 'b',
      },
      {
        id: 'q3',
        text: 'Когда допустимо ставить клиента на удержание?',
        options: [
          { id: 'a', text: 'В любой момент, если нужно подумать' },
          { id: 'b', text: 'Предупредив и назвав причину, не дольше двух минут' },
          { id: 'c', text: 'Только по требованию клиента' },
        ],
        correctOptionId: 'b',
      },
    ],
  },
  {
    id: 't-2',
    title: 'Работа с возражениями',
    topic: 'Продажи и удержание',
    minutes: 7,
    passPercent: 80,
    rewardCoins: 140,
    rewardTickets: 1,
    lastScore: 67,
    questions: [
      {
        id: 'q1',
        text: 'Клиент говорит «мне это не нужно». Что это по классификации?',
        options: [
          { id: 'a', text: 'Отказ — разговор пора завершать' },
          { id: 'b', text: 'Возражение — нужно выяснить, что стоит за словами' },
          { id: 'c', text: 'Жалоба — переводим в отдел качества' },
        ],
        correctOptionId: 'b',
      },
      {
        id: 'q2',
        text: 'Что нельзя делать при отработке возражения?',
        options: [
          { id: 'a', text: 'Задавать уточняющие вопросы' },
          { id: 'b', text: 'Спорить с клиентом и доказывать его неправоту' },
          { id: 'c', text: 'Приводить пример похожей ситуации' },
        ],
        correctOptionId: 'b',
      },
      {
        id: 'q3',
        text: 'Сколько раз допустимо возвращаться к одному возражению?',
        options: [
          { id: 'a', text: 'Столько, сколько нужно до согласия' },
          { id: 'b', text: 'Не больше двух, дальше это давление' },
          { id: 'c', text: 'Ни одного, возражение принимается как отказ' },
        ],
        correctOptionId: 'b',
      },
    ],
  },
  {
    id: 't-3',
    title: 'Персональные данные',
    topic: 'Безопасность',
    minutes: 6,
    passPercent: 90,
    rewardCoins: 160,
    rewardTickets: 1,
    lastScore: 100,
    questions: [
      {
        id: 'q1',
        text: 'Клиент просит продиктовать его паспортные данные из карточки. Что делает оператор?',
        options: [
          { id: 'a', text: 'Диктует — данные принадлежат клиенту' },
          { id: 'b', text: 'Отказывает и предлагает подтвердить личность по регламенту' },
          { id: 'c', text: 'Диктует последние четыре цифры' },
        ],
        correctOptionId: 'b',
      },
      {
        id: 'q2',
        text: 'Где допустимо хранить выписку с данными клиента?',
        options: [
          { id: 'a', text: 'В личном мессенджере, чтобы не потерять' },
          { id: 'b', text: 'Нигде за пределами рабочей системы' },
          { id: 'c', text: 'В блокноте на рабочем столе' },
        ],
        correctOptionId: 'b',
      },
    ],
  },
];

/* ── Колесо ──────────────────────────────────────────────── */

export const WHEEL_SECTORS: WheelSector[] = [
  { id: 'w1', label: '50 коинов', kind: 'coins', amount: 50, weight: 24 },
  { id: 'w2', label: 'Билет WOW', kind: 'ticket', amount: 1, weight: 16 },
  { id: 'w3', label: '120 коинов', kind: 'coins', amount: 120, weight: 14 },
  { id: 'w4', label: 'Пустой сектор', kind: 'nothing', amount: 0, weight: 18 },
  { id: 'w5', label: '300 коинов', kind: 'coins', amount: 300, weight: 8 },
  { id: 'w6', label: 'Ещё прокрутка', kind: 'spin', amount: 1, weight: 12 },
  { id: 'w7', label: '800 коинов', kind: 'coins', amount: 800, weight: 3 },
  { id: 'w8', label: '2 билета WOW', kind: 'ticket', amount: 2, weight: 5 },
];

/* ── Розыгрыши ───────────────────────────────────────────── */

export const RAFFLES: Raffle[] = [
  {
    id: 'r-1',
    title: 'Осенний сезон',
    prize: 'Смартфон флагманской линейки',
    season: 'Сезон 3',
    endsIn: 'через 9 дней',
    totalTickets: 486,
    myTickets: 0,
    participants: 41,
  },
  {
    id: 'r-2',
    title: 'Тёплый сентябрь',
    prize: 'Сертификат в маркетплейс, 50 000 ₸',
    season: 'Сезон 3',
    endsIn: 'через 4 дня',
    totalTickets: 212,
    myTickets: 0,
    participants: 33,
  },
  {
    id: 'r-3',
    title: 'Рабочее место',
    prize: 'Игровая гарнитура и кресло',
    season: 'Сезон 3',
    endsIn: 'через 16 дней',
    totalTickets: 128,
    myTickets: 0,
    participants: 24,
  },
];

/* ── Магазин ─────────────────────────────────────────────── */

export const SHOP_ITEMS: ShopItem[] = [
  { id: 'sh-1', title: 'Выбор смены на неделю', description: 'Первым выбираете график на следующую неделю.', category: 'schedule', price: 400, stock: 6 },
  { id: 'sh-2', title: 'Отгул за свой счёт', description: 'Один день отсутствия без согласования очереди.', category: 'schedule', price: 900, stock: 3 },
  { id: 'sh-3', title: 'Поздний старт', description: 'Начало смены на два часа позже, один раз.', category: 'schedule', price: 250, stock: null },
  { id: 'sh-4', title: 'Худи с логотипом', description: 'Тёплое худи, размеры S—XXL.', category: 'merch', price: 1200, stock: 8 },
  { id: 'sh-5', title: 'Гарнитура с шумоподавлением', description: 'Профессиональная модель для линии.', category: 'merch', price: 2400, stock: 2 },
  { id: 'sh-6', title: 'Термокружка', description: 'Держит температуру шесть часов.', category: 'merch', price: 450, stock: 14 },
  { id: 'sh-7', title: 'Сертификат в кофейню', description: 'Номинал 5 000 ₸.', category: 'certificate', price: 500, stock: null },
  { id: 'sh-8', title: 'Сертификат в маркетплейс', description: 'Номинал 20 000 ₸.', category: 'certificate', price: 1900, stock: 5 },
  { id: 'sh-9', title: 'Обед за счёт компании', description: 'На неделю вперёд.', category: 'certificate', price: 700, stock: null },
];

/* ── Журнал ──────────────────────────────────────────────── */

function iso(daysAgo: number, hour: number, minute: number): string {
  const d = new Date(2026, 7, 31 - daysAgo, hour, minute, 0);
  return d.toISOString();
}

export const LEDGER: LedgerEntry[] = [
  { id: 'tx-1', at: iso(0, 9, 12), operatorId: 'op-07', operatorName: 'Волков Игорь', source: 'mission', amount: 200, comment: 'Миссия «Ноль замечаний»' },
  { id: 'tx-2', at: iso(0, 8, 40), operatorId: 'op-12', operatorName: 'Лебедева Ксения', source: 'wheel', amount: 120, comment: 'Колесо WOW' },
  { id: 'tx-3', at: iso(1, 18, 5), operatorId: 'op-07', operatorName: 'Волков Игорь', source: 'shop', amount: -400, comment: 'Выбор смены на неделю' },
  { id: 'tx-4', at: iso(1, 14, 22), operatorId: 'op-03', operatorName: 'Сидоров Дмитрий', source: 'bonus', amount: 500, comment: 'Разбор сложного обращения, премия руководителя' },
  { id: 'tx-5', at: iso(2, 11, 3), operatorId: 'op-21', operatorName: 'Титова Данил', source: 'test', amount: 160, comment: 'Тест «Персональные данные», 100%' },
  { id: 'tx-6', at: iso(3, 10, 0), operatorId: 'op-07', operatorName: 'Волков Игорь', source: 'period', amount: 318, comment: 'Расчёт периода W34' },
  { id: 'tx-7', at: iso(3, 10, 0), operatorId: 'op-15', operatorName: 'Белова Максим', source: 'period', amount: 402, comment: 'Расчёт периода W34' },
  { id: 'tx-8', at: iso(4, 16, 45), operatorId: 'op-30', operatorName: 'Гусева София', source: 'raffle', amount: -0, comment: 'Внесено 2 билета в «Осенний сезон»' },
  { id: 'tx-9', at: iso(5, 12, 30), operatorId: 'op-09', operatorName: 'Соловьёв Никита', source: 'shop', amount: -1200, comment: 'Худи с логотипом' },
  { id: 'tx-10', at: iso(6, 9, 15), operatorId: 'op-02', operatorName: 'Петрова Мария', source: 'bonus', amount: 300, comment: 'Наставничество новичка' },
];

/* ── Уведомления ─────────────────────────────────────────── */

export const NOTIFICATIONS: AppNotification[] = [
  { id: 'n-1', at: iso(0, 9, 12), title: 'Награда получена', detail: 'Миссия «Ноль замечаний» — 200 коинов и билет WOW.', read: false },
  { id: 'n-2', at: iso(0, 8, 5), title: 'Период W35 открыт для ввода', detail: 'Загрузите логи АТС и чек-листы ОКК до пятницы.', read: false },
  { id: 'n-3', at: iso(1, 17, 40), title: 'Новый тест', detail: '«Работа с возражениями» доступен для прохождения.', read: true },
  { id: 'n-4', at: iso(2, 10, 20), title: 'Розыгрыш скоро закроется', detail: '«Тёплый сентябрь» — осталось четыре дня.', read: true },
];

/* ── Аналитика ───────────────────────────────────────────── */

export const WEEKLY_TREND: WeeklyPoint[] = [
  { week: 'W31', quality: 89.2, density: 7.8, penalties: 214 },
  { week: 'W32', quality: 90.1, density: 8.1, penalties: 188 },
  { week: 'W33', quality: 88.4, density: 8.6, penalties: 246 },
  { week: 'W34', quality: 91.3, density: 8.9, penalties: 162 },
  { week: 'W35', quality: 92.0, density: 9.2, penalties: 141 },
];

export const HOURLY_LOAD: HourlyLoad[] = [
  { hour: '08', calls: 62 }, { hour: '09', calls: 148 }, { hour: '10', calls: 236 },
  { hour: '11', calls: 281 }, { hour: '12', calls: 224 }, { hour: '13', calls: 196 },
  { hour: '14', calls: 258 }, { hour: '15', calls: 292 }, { hour: '16', calls: 274 },
  { hour: '17', calls: 218 }, { hour: '18', calls: 156 }, { hour: '19', calls: 88 },
];

/* ── Сессии ──────────────────────────────────────────────── */

export const SESSIONS: DeviceSession[] = [
  { id: 'se-1', operatorName: 'Волков Игорь', device: 'Chrome · Windows 11', ip: '10.14.2.87', location: 'Офис, 3 этаж', lastSeen: iso(0, 9, 30), current: true },
  { id: 'se-2', operatorName: 'Волков Игорь', device: 'Safari · iPhone', ip: '92.47.118.5', location: 'Мобильная сеть', lastSeen: iso(1, 21, 12), current: false },
  { id: 'se-3', operatorName: 'Петрова Мария', device: 'Chrome · Windows 11', ip: '10.14.2.41', location: 'Офис, 2 этаж', lastSeen: iso(0, 9, 18), current: false },
  { id: 'se-4', operatorName: 'Сидоров Дмитрий', device: 'Firefox · Ubuntu', ip: '10.14.5.9', location: 'Офис, 4 этаж', lastSeen: iso(0, 8, 52), current: false },
  { id: 'se-5', operatorName: 'Лебедева Ксения', device: 'Chrome · macOS', ip: '178.89.44.201', location: 'Вне сети офиса', lastSeen: iso(2, 23, 4), current: false },
];

/* ── Навигация ───────────────────────────────────────────── */

export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Операционный контур',
    items: [
      { id: 'summary', label: 'Сводка', hint: 'Обзор смены и статус периода', managerOnly: false },
      { id: 'cabinet', label: 'Мой кабинет', hint: 'Формула начисления и ачивки', managerOnly: false },
      { id: 'rating', label: 'Рейтинг', hint: 'Таблица лидеров', managerOnly: false },
    ],
  },
  {
    title: 'Мотивация и развитие',
    items: [
      { id: 'missions', label: 'Миссии', hint: 'Кампании и квесты по главам', managerOnly: false },
      { id: 'tests', label: 'Тесты знаний', hint: 'Скрипты и регламенты', managerOnly: false },
    ],
  },
  {
    title: 'Игровой контур',
    items: [
      { id: 'wheel', label: 'Колесо WOW', hint: 'Прокрутка за билет', managerOnly: false },
      { id: 'raffles', label: 'Розыгрыши', hint: 'Сезонные пулы призов', managerOnly: false },
      { id: 'shop', label: 'Магазин бонусов', hint: 'Трата коинов', managerOnly: false },
    ],
  },
  {
    title: 'Управление',
    items: [
      { id: 'staff', label: 'Штат операторов', hint: 'Список и смена грейдов', managerOnly: true },
      { id: 'grades', label: 'Квалификации', hint: 'Лестница и симулятор', managerOnly: true },
      { id: 'teams', label: 'Команды', hint: 'Сравнение четырёх групп', managerOnly: true },
      { id: 'coins', label: 'Бухгалтерия коинов', hint: 'Журнал и премирование', managerOnly: true },
      { id: 'analytics', label: 'Аналитика', hint: 'Тренды и нагрузка', managerOnly: true },
      { id: 'period', label: 'Расчёт периода', hint: 'Биллинг за неделю', managerOnly: true },
      { id: 'sessions', label: 'Сессии', hint: 'Устройства и адреса', managerOnly: true },
    ],
  },
];
