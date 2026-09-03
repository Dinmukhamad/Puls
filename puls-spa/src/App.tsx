import { useEffect } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { Topbar } from './components/layout/Topbar';
import { Confetti } from './components/ui/Confetti';
import { AnalyticsView } from './components/views/AnalyticsView';
import { CabinetView } from './components/views/CabinetView';
import { CoinsView } from './components/views/CoinsView';
import { GradesView } from './components/views/GradesView';
import { MissionsView } from './components/views/MissionsView';
import { PeriodView } from './components/views/PeriodView';
import { RafflesView } from './components/views/RafflesView';
import { RatingView } from './components/views/RatingView';
import { SessionsView } from './components/views/SessionsView';
import { ShopView } from './components/views/ShopView';
import { StaffView } from './components/views/StaffView';
import { SummaryView } from './components/views/SummaryView';
import { TeamsView } from './components/views/TeamsView';
import { TestsView } from './components/views/TestsView';
import { WheelView } from './components/views/WheelView';
import { StoreProvider, useStore } from './store';
import type { ViewId } from './types';

const VIEWS: Record<ViewId, () => JSX.Element> = {
  summary: SummaryView,
  cabinet: CabinetView,
  rating: RatingView,
  missions: MissionsView,
  tests: TestsView,
  wheel: WheelView,
  raffles: RafflesView,
  shop: ShopView,
  staff: StaffView,
  grades: GradesView,
  teams: TeamsView,
  coins: CoinsView,
  analytics: AnalyticsView,
  period: PeriodView,
  sessions: SessionsView,
};

/** Разделы, закрытые для оператора. Проверка здесь, а не только в меню:
 *  скрытый пункт — не защита, если до раздела можно дойти иначе. */
const MANAGER_ONLY: ViewId[] = ['staff', 'grades', 'teams', 'coins', 'analytics', 'period', 'sessions'];

function Shell(): JSX.Element {
  const { state, dispatch, isManager } = useStore();

  // Тема переключается классом на корне, а не пересборкой стилей.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', state.theme === 'dark');
  }, [state.theme]);

  const allowed = !MANAGER_ONLY.includes(state.view) || isManager;
  const View = allowed ? VIEWS[state.view] : VIEWS.summary;

  return (
    <div className="flex min-h-screen bg-canvas-light text-zinc-900 dark:bg-canvas dark:text-zinc-100">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <View />
        </main>
      </div>
      <Confetti trigger={state.celebration} onDone={() => dispatch({ type: 'clearCelebration' })} />
    </div>
  );
}

export default function App(): JSX.Element {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
