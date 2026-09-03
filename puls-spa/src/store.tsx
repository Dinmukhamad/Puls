import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react';
import {
  GRADES,
  LEDGER,
  MISSIONS,
  ME_ID,
  NOTIFICATIONS,
  OPERATORS,
  RAFFLES,
  SESSIONS,
  TESTS,
} from './mockData';
import type {
  AppNotification,
  DeviceSession,
  GradeId,
  KnowledgeTest,
  LedgerEntry,
  LedgerSource,
  Mission,
  Operator,
  PeriodStatus,
  Raffle,
  Role,
  ThemeMode,
  ViewId,
  WheelPrizeKind,
} from './types';
import { coinsFor } from './lib/calc';

/**
 * Состояние приложения целиком в одном reducer.
 *
 * Почему не отдельные хуки по модулям: почти каждое действие затрагивает
 * сразу несколько сущностей. Покупка в магазине меняет баланс, склад и
 * журнал; прокрутка колеса — билеты, баланс, историю и уведомления. Когда
 * это разнесено по трём хукам, рано или поздно одно из трёх забывают
 * обновить, и баланс перестаёт сходиться с журналом.
 */

export interface AppState {
  role: Role;
  theme: ThemeMode;
  view: ViewId;
  periodStatus: PeriodStatus;
  operators: Operator[];
  missions: Mission[];
  tests: KnowledgeTest[];
  raffles: Raffle[];
  ledger: LedgerEntry[];
  notifications: AppNotification[];
  sessions: DeviceSession[];
  /** Проданные позиции: id товара → сколько раз куплено. */
  purchases: Record<string, number>;
  spinHistory: SpinEntry[];
  /** Бесплатные прокрутки, выигранные на самом колесе. */
  freeSpins: number;
  celebration: string | null;
}

export interface SpinEntry {
  id: string;
  at: string;
  label: string;
  kind: WheelPrizeKind;
  amount: number;
}

export type Action =
  | { type: 'setRole'; role: Role }
  | { type: 'setTheme'; theme: ThemeMode }
  | { type: 'navigate'; view: ViewId }
  | { type: 'setPeriodStatus'; status: PeriodStatus }
  | { type: 'claimMission'; missionId: string }
  | { type: 'finishTest'; testId: string; scorePercent: number }
  | { type: 'spinWheel'; label: string; kind: WheelPrizeKind; amount: number; usedFreeSpin: boolean }
  | { type: 'enterRaffle'; raffleId: string; tickets: number }
  | { type: 'buyItem'; itemId: string; title: string; price: number }
  | { type: 'awardCoins'; operatorId: string; amount: number; source: LedgerSource; comment: string }
  | { type: 'changeGrade'; operatorId: string; gradeId: GradeId }
  | { type: 'applyPeriod' }
  | { type: 'revokeSession'; sessionId: string }
  | { type: 'readNotifications' }
  | { type: 'clearCelebration' };

const initialState: AppState = {
  role: 'operator',
  theme: 'dark',
  view: 'summary',
  periodStatus: 'draft',
  operators: OPERATORS,
  missions: MISSIONS,
  tests: TESTS,
  raffles: RAFFLES,
  ledger: LEDGER,
  notifications: NOTIFICATIONS,
  sessions: SESSIONS,
  purchases: {},
  spinHistory: [],
  freeSpins: 0,
  celebration: null,
};

let sequence = 0;
function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Изменение баланса и билетов одного оператора. */
function patchMe(
  operators: Operator[],
  deltaCoins: number,
  deltaTickets = 0,
): Operator[] {
  return operators.map((o) =>
    o.id === ME_ID
      ? { ...o, coins: o.coins + deltaCoins, tickets: Math.max(0, o.tickets + deltaTickets) }
      : o,
  );
}

function addLedger(
  state: AppState,
  amount: number,
  source: LedgerSource,
  comment: string,
  operatorId = ME_ID,
): LedgerEntry[] {
  const operator = state.operators.find((o) => o.id === operatorId);
  const entry: LedgerEntry = {
    id: nextId('tx'),
    at: nowIso(),
    operatorId,
    operatorName: operator ? operator.name : 'Неизвестный оператор',
    source,
    amount,
    comment,
  };
  return [entry, ...state.ledger];
}

function notify(state: AppState, title: string, detail: string): AppNotification[] {
  return [{ id: nextId('n'), at: nowIso(), title, detail, read: false }, ...state.notifications];
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'setRole': {
      // При смене роли текущий раздел может стать недоступным — возвращаем
      // на сводку, а не показываем пустой экран.
      const managerOnly: ViewId[] = ['staff', 'grades', 'teams', 'coins', 'analytics', 'period', 'sessions'];
      const view = action.role === 'operator' && managerOnly.includes(state.view) ? 'summary' : state.view;
      return { ...state, role: action.role, view };
    }

    case 'setTheme':
      return { ...state, theme: action.theme };

    case 'navigate':
      return { ...state, view: action.view };

    case 'setPeriodStatus':
      return { ...state, periodStatus: action.status };

    case 'claimMission': {
      const mission = state.missions.find((m) => m.id === action.missionId);
      if (!mission || mission.state !== 'ready') return state;
      const missions = state.missions.map((m) =>
        m.id === action.missionId ? { ...m, state: 'claimed' as const } : m,
      );
      const withReward: AppState = {
        ...state,
        missions,
        operators: patchMe(state.operators, mission.rewardCoins, mission.rewardTickets),
      };
      return {
        ...withReward,
        ledger: addLedger(withReward, mission.rewardCoins, 'mission', `Миссия «${mission.title}»`),
        notifications: notify(
          withReward,
          'Награда получена',
          `${mission.title} — ${mission.rewardCoins} коинов${mission.rewardTickets ? ` и ${mission.rewardTickets} билет WOW` : ''}.`,
        ),
        celebration: mission.title,
      };
    }

    case 'finishTest': {
      const test = state.tests.find((t) => t.id === action.testId);
      if (!test) return state;
      const passed = action.scorePercent >= test.passPercent;
      const tests = state.tests.map((t) =>
        t.id === action.testId ? { ...t, lastScore: action.scorePercent } : t,
      );
      if (!passed) {
        const failed: AppState = { ...state, tests };
        return {
          ...failed,
          notifications: notify(
            failed,
            'Тест не сдан',
            `«${test.title}» — ${action.scorePercent}% при проходных ${test.passPercent}%. Попытку можно повторить.`,
          ),
        };
      }
      const rewarded: AppState = {
        ...state,
        tests,
        operators: patchMe(state.operators, test.rewardCoins, test.rewardTickets),
      };
      return {
        ...rewarded,
        ledger: addLedger(rewarded, test.rewardCoins, 'test', `Тест «${test.title}», ${action.scorePercent}%`),
        notifications: notify(
          rewarded,
          'Тест сдан',
          `«${test.title}» — ${action.scorePercent}%. Начислено ${test.rewardCoins} коинов.`,
        ),
        celebration: test.title,
      };
    }

    case 'spinWheel': {
      const { kind, amount, label, usedFreeSpin } = action;
      const spinner = state.operators.find((o) => o.id === ME_ID);
      if (!spinner) return state;

      // Расход и зачисление — одно действие. Разнеси их на два, и однажды
      // прокрутка спишет билет, а приз не начислит.
      if (usedFreeSpin ? state.freeSpins <= 0 : spinner.tickets <= 0) return state;

      const coinsDelta = kind === 'coins' ? amount : 0;
      const ticketsWon = kind === 'ticket' ? amount : 0;
      const ticketsDelta = ticketsWon - (usedFreeSpin ? 0 : 1);
      const freeSpins =
        (usedFreeSpin ? state.freeSpins - 1 : state.freeSpins) + (kind === 'spin' ? amount : 0);

      const spun: AppState = {
        ...state,
        operators: patchMe(state.operators, coinsDelta, ticketsDelta),
        freeSpins,
        spinHistory: [
          { id: nextId('sp'), at: nowIso(), label, kind, amount },
          ...state.spinHistory,
        ].slice(0, 40),
      };
      return {
        ...spun,
        ledger: coinsDelta ? addLedger(spun, coinsDelta, 'wheel', `Колесо WOW — ${label}`) : spun.ledger,
      };
    }

    case 'enterRaffle': {
      const raffle = state.raffles.find((r) => r.id === action.raffleId);
      const me = state.operators.find((o) => o.id === ME_ID);
      if (!raffle || !me || action.tickets <= 0 || me.tickets < action.tickets) return state;
      const raffles = state.raffles.map((r) =>
        r.id === action.raffleId
          ? {
              ...r,
              myTickets: r.myTickets + action.tickets,
              totalTickets: r.totalTickets + action.tickets,
              participants: r.myTickets === 0 ? r.participants + 1 : r.participants,
            }
          : r,
      );
      const entered: AppState = {
        ...state,
        raffles,
        operators: patchMe(state.operators, 0, -action.tickets),
      };
      return {
        ...entered,
        notifications: notify(
          entered,
          'Билеты внесены',
          `«${raffle.title}» — ${action.tickets} билет(ов) в пуле.`,
        ),
      };
    }

    case 'buyItem': {
      const me = state.operators.find((o) => o.id === ME_ID);
      if (!me || me.coins < action.price) return state;
      const bought: AppState = {
        ...state,
        operators: patchMe(state.operators, -action.price),
        purchases: { ...state.purchases, [action.itemId]: (state.purchases[action.itemId] ?? 0) + 1 },
      };
      return {
        ...bought,
        ledger: addLedger(bought, -action.price, 'shop', action.title),
        notifications: notify(bought, 'Покупка оформлена', `${action.title} — списано ${action.price} коинов.`),
      };
    }

    case 'awardCoins': {
      if (action.amount === 0) return state;
      const operators = state.operators.map((o) =>
        o.id === action.operatorId ? { ...o, coins: Math.max(0, o.coins + action.amount) } : o,
      );
      const target = state.operators.find((o) => o.id === action.operatorId);
      const awarded: AppState = { ...state, operators };
      return {
        ...awarded,
        ledger: addLedger(awarded, action.amount, action.source, action.comment, action.operatorId),
        notifications:
          action.operatorId === ME_ID
            ? notify(awarded, 'Начисление', `${action.comment} — ${action.amount} коинов.`)
            : awarded.notifications,
        celebration: target && action.operatorId === ME_ID ? action.comment : awarded.celebration,
      };
    }

    case 'changeGrade':
      return {
        ...state,
        operators: state.operators.map((o) =>
          o.id === action.operatorId ? { ...o, gradeId: action.gradeId } : o,
        ),
      };

    case 'applyPeriod': {
      // Закрытие периода начисляет всем сразу и пишет по строке на каждого:
      // ведомость должна сходиться с журналом до коина.
      const entries: LedgerEntry[] = [];
      const operators = state.operators.map((operator) => {
        const coins = coinsFor(operator, GRADES[operator.gradeId]);
        if (coins > 0) {
          entries.push({
            id: nextId('tx'),
            at: nowIso(),
            operatorId: operator.id,
            operatorName: operator.name,
            source: 'period',
            amount: coins,
            comment: 'Расчёт периода W35',
          });
        }
        return { ...operator, coins: operator.coins + coins };
      });
      const applied: AppState = {
        ...state,
        operators,
        periodStatus: 'calculated',
        ledger: [...entries, ...state.ledger],
      };
      const total = entries.reduce((sum, e) => sum + e.amount, 0);
      return {
        ...applied,
        notifications: notify(
          applied,
          'Период W35 закрыт',
          `Начислено ${total} коинов на ${entries.length} сотрудников.`,
        ),
      };
    }

    case 'revokeSession':
      return { ...state, sessions: state.sessions.filter((s) => s.id !== action.sessionId) };

    case 'readNotifications':
      return { ...state, notifications: state.notifications.map((n) => ({ ...n, read: true })) };

    case 'clearCelebration':
      return { ...state, celebration: null };

    default:
      return state;
  }
}

interface StoreValue {
  state: AppState;
  dispatch: Dispatch<Action>;
  me: Operator;
  isManager: boolean;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, dispatch] = useReducer(reducer, initialState);

  const me = useMemo(() => {
    const found = state.operators.find((o) => o.id === ME_ID);
    if (!found) throw new Error(`Оператор ${ME_ID} отсутствует в наборе данных`);
    return found;
  }, [state.operators]);

  const value = useMemo<StoreValue>(
    () => ({ state, dispatch, me, isManager: state.role === 'manager' }),
    [state, dispatch, me],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore вызван вне StoreProvider');
  return ctx;
}

/** Удобный доступ к отправке действий без вытаскивания всего состояния. */
export function useAction(): Dispatch<Action> {
  return useStore().dispatch;
}

export function useNavigate(): (view: ViewId) => void {
  const dispatch = useAction();
  return useCallback((view: ViewId) => dispatch({ type: 'navigate', view }), [dispatch]);
}
