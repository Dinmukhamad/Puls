import type { CityQuest } from "../../api/city";
import type { LearningContent } from "../../api/learning";
import { dateOnly } from "../../utils/format";

const GIVER_ICONS: Record<CityQuest["giver"], string> = { driver: "🚕", client: "📞", guide: "💡" };
/** The icon follows who speaks; a question without a speaker takes its place on the map. */
export const speakerIcon = (quest: CityQuest) => /водител/i.test(quest.speaker) ? "🚕" : /клиент|звонящ/i.test(quest.speaker) ? "📞" : GIVER_ICONS[quest.giver];
const ASSIGNMENT_STATES: Record<NonNullable<LearningContent["state"]>, string> = { new: "Новое", in_progress: "В процессе", passed: "Пройдено", failed: "Не пройдено" };
/**
 * Today's situations and the simulator scenarios a trainer assigned: what is left comes first.
 * A situation is never dealt twice, so an operator who answered them all sees that instead (`allPassed`).
 */
export function CityTasks({ quests, coins, assigned, onQuest, onStart, starting, error, allPassed = false }: { quests: CityQuest[]; coins: number; assigned: LearningContent[]; onQuest: (quest: CityQuest) => void; onStart: (item: LearningContent) => void; starting: number | null; error: string | null; allPassed?: boolean }) {
  const answered = quests.filter(q => q.answered).length;
  const scenarios = [...assigned].sort((a, b) => Number(!!a.completed) - Number(!!b.completed) || (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"));
  return <aside className="city-tasks glass glass--regular" aria-label="Задания">
    {quests.length > 0 && <section aria-labelledby="city-tasks-day">
      <div className="city-tasks__head"><h2 id="city-tasks-day">Задания дня</h2><span>{answered} из {quests.length}</span></div>
      <ul className="city-tasks__list">{quests.map(q => <li key={q.slot}>
        <button type="button" className="city-task" data-done={q.answered || undefined} onClick={() => onQuest(q)} aria-label={`${q.speaker || "Ситуация"}: ${q.text}. ${q.answered ? q.correct ? "Отвечено верно" : "Отвечено" : "Ответить"}`}>
          <span className="city-task__icon" aria-hidden="true">{speakerIcon(q)}</span>
          <span className="city-task__text"><strong>{q.speaker || "Ситуация"}</strong><small>{q.text}</small></span>
          <span className="city-task__state">{q.answered ? q.correct ? `✓ +${q.coins}` : "Разбор" : "Ответить"}</span>
        </button>
      </li>)}</ul>
      <p className="city-fine">{answered < quests.length ? `Верный ответ — +${coins} коинов.` : "На сегодня всё. Новые задания появятся завтра."}</p>
    </section>}
    {quests.length === 0 && allPassed && <section aria-labelledby="city-tasks-day">
      <div className="city-tasks__head"><h2 id="city-tasks-day">Задания дня</h2></div>
      <p className="city-tasks__empty">Все ситуации дня пройдены: они не повторяются. Новые появятся, когда тренер их добавит.</p>
    </section>}
    {scenarios.length > 0 && <section aria-labelledby="city-tasks-trainer">
      <div className="city-tasks__head"><h2 id="city-tasks-trainer">От тренера</h2><span>{scenarios.filter(item => item.completed).length} из {scenarios.length}</span></div>
      <ul className="city-tasks__list">{scenarios.map(item => <li key={item.id}>
        <div className="city-task" data-done={item.completed || undefined}>
          <span className="city-task__icon" aria-hidden="true">🚕</span>
          <span className="city-task__text"><strong>{item.title}</strong><small>{item.completed ? "✓ Пройдено" : ASSIGNMENT_STATES[item.state ?? "new"]}{item.deadline ? ` · до ${dateOnly(item.deadline)}` : ""}</small></span>
          <button type="button" className="city-secondary city-task__start" disabled={starting !== null} onClick={() => onStart(item)}>{starting === item.id ? "Запускаем…" : item.state === "in_progress" ? "Продолжить" : item.completed ? "Повторить" : "Начать"}</button>
        </div>
      </li>)}</ul>
      {error && <p className="city-error" role="alert">{error}</p>}
      <p className="city-fine">Сценарии Driver Simulator, которые назначил тренер. Результат увидит тренер.</p>
    </section>}
  </aside>;
}
