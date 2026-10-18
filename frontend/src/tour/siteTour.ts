/**
 * «Как устроен Puls» (docs/CITY_MISSIONS.md): Pulsar's tour of the real site for operators, the Academy's mission.
 * Pulsar flies over the site itself — no copy of it: the operator presses the menu where he points, every section opens
 * as it always does, and Pulsar explains what is on it and what it is for. The tour ends in the city with the first
 * steps of building and the mission's reward.
 *
 * The steps find the site's elements by `data-tour` markers (and the city's own panels by `data-city-panel`). On a phone
 * «Награды» and «Профиль» sit in the menu «Ещё»: a step opens it first, and is skipped where the menu is not needed.
 */
import type { CoachStep } from "../pages/crm/coachTours";

const tour = (id: string) => `[data-tour=${id}]`;
/** A section of the menu: the sidebar on a computer, the tab bar or the menu «Ещё» on a phone. */
const nav = (section: string) => tour(`nav-${section}`);
/**
 * Pressing a section of the menu waits until its page is open. A section the operator has no access to is passed by: the
 * page's shell lists the sections there are (the menu item itself goes out of sight when the menu «Ещё» closes on a tap).
 */
const go = (section: string, opened: string, title: string, text: string): CoachStep =>
  ({ target: nav(section), when: `.shell[data-sections~=${section}]`, advanceWhen: opened, action: "Нажми", title, text });
/** A section's own steps apply on its page only: where it was passed by, they are too. */
const on = (opened: string, steps: CoachStep[]) => steps.map(step => ({ ...step, when: step.when ?? opened }));
/** On a phone the section waits in «Ещё»: open it first. Where the section is already in view this step is skipped. */
const more = (section: string, inMenu: string): CoachStep => ({
  target: tour("nav-more"), when: `${tour("nav-more")}[data-sections~=${section}]`, skipWhen: nav(section), advanceWhen: `${inMenu} ${nav(section)}`, action: "Нажми",
  title: "Ещё разделы", text: "На телефоне «Награды» и «Профиль» живут в меню «Ещё». Открой его.",
});
const CITY = ".city-toolbar", PANEL = (slot: string) => `${CITY} [data-city-panel=${slot}] .city-peek__trigger`;
const DOCK = ".estate-dock";
/** The step on which the tour counts as passed: the server makes the mission ready to claim from here. */
export const FINISH = "finish";

export const SITE_TOUR: CoachStep[] = [
  { target: tour("nav"), title: "Привет! Я Пульсар", text: "Покажу, как устроен Puls — прямо на сайте. Это меню: шесть разделов. Нажимай туда, куда я показываю, а «Дальше» — когда прочитаешь." },

  go("home", tour("home"), "Главная — гонка недели", "Здесь видно, как идёт твоя неделя. Нажми «Главная»."),
  { target: tour("home-race"), when: tour("home-race"), title: "Твоё место", text: "Все операторы недели по баллам: ты — тёмная точка, рядом те, кого догоняешь и кто догоняет тебя. Места меняются по мере загрузки показателей." },
  { target: tour("home-moves"), when: tour("home-moves"), title: "Ходы", text: "Сколько баллов нужно до места выше и какого показателя на это хватит. Ниже — где баллы теряются." },
  { target: tour("home-month"), when: tour("home-month"), title: "Конкурс месяца", text: "Призы за места платят раз в месяц, и каждый балл недели идёт в его сумму." },
  { target: tour("home-today"), when: tour("home-today"), title: "Сегодня ещё", text: "Ситуации дня и сундук, следующая миссия и коины на счету — то, что можно сделать прямо сейчас." },

  go("results", tour("rating-views"), "Результаты", "Рейтинг и твой прогресс. Нажми «Результаты»."),
  ...on(tour("rating-views"), [{ target: tour("rating-views"), title: "Рейтинг", text: "Места среди всех операторов: конкурс месяца и отдельные недели. Призы месяца начисляются, когда месяц закрыт." },
  { target: tour("tab-progress"), advanceWhen: tour("progress-earn"), action: "Нажми", title: "Мой прогресс", text: "Соседняя вкладка — уровни и достижения. Нажми «Мой прогресс»." },
  { target: tour("progress-earn"), when: tour("progress-earn"), title: "Как заработать коины", text: "Три источника: работа, обучение и достижения. Здесь же все уровни и условия достижений." }]),

  go("wheel", tour("chest"), "Удача", "Каждый день тебя ждёт сундук. Нажми «Удача»."),
  ...on(tour("chest"), [{ target: tour("chest"), title: "Сундук дня", text: "Ответь на задания дня в городе — и сундук откроется с призом. Каждый день новый." }]),

  more("rewards", ".mobile-menu"),
  go("rewards", tour("shop-wallet"), "Награды", "Здесь коины превращаются в бонусы. Нажми «Награды»."),
  ...on(tour("shop-wallet"), [{ target: tour("shop-wallet"), title: "Магазин бонусов", text: "Перерыв, сертификаты, мерч — всё за коины. Коины не сгорают: можно тратить сразу или копить на крупное." },
  { target: tour("shop-item"), title: "Покупка с одобрением", text: "У таких бонусов коины сначала резервируются, пока руководитель решает. Откажет — коины вернутся." }]),

  more("profile", ".mobile-account"),
  go("profile", tour("profile"), "Профиль", "Твои данные и настройки. Нажми «Профиль»."),
  ...on(tour("profile"), [{ target: tour("profile-settings"), title: "Связь и настройки", text: "Подключи Telegram — туда придут уведомления о наградах. Здесь же тема оформления и приложение Puls на телефон." }]),

  go("training", `${CITY} .city-peek__trigger`, "Обучение — твой город", "Город — главное место учёбы и твоих построек. Нажми «Обучение»."),
  { target: CITY, when: CITY, title: "Панель города", text: "Все кнопки города: уровень и опыт, другие города, стройка, задания дня, навыки и управление картой." },
  { target: PANEL("quests"), when: PANEL("quests"), title: "Задания дня", text: "Три ситуации каждый день. Ответы открывают сундук дня, даже неверные." },
  { target: PANEL("skills"), when: PANEL("skills"), title: "Навыки", text: "Районы обучения и их миссии. Каждая миссия учит рабочему инструменту, даёт опыт и коины и растит здание района." },

  { target: PANEL("build"), when: PANEL("build"), advanceWhen: ".city-build-entry:not([aria-busy=true])", action: "Нажми", title: "Стройка в районе", text: "За коины ты строишь свой дом, офис или сквер в районе своей команды. Нажми «Строить»." },
  { target: ".city-build-entry", skipWhen: tour("build-open"), title: "Стройка пока закрыта", text: "Когда руководитель откроет стройку в твоём районе, здесь появится кнопка «Строить в районе». А пока — главное ты уже знаешь." },
  { target: tour("build-open"), when: tour("build-open"), advanceWhen: DOCK, action: "Нажми", title: "Строить в районе", text: "Нажми — карта приблизится к свободной земле твоего района." },
  { target: `${DOCK} [aria-label="Разделы стройки"]`, when: DOCK, title: "Три вкладки", text: "«Строить» — магазин, «Мои постройки» — то, что уже твоё, «Район» — как растёт главное здание команды." },
  { target: `${DOCK} .estate-shop__item`, when: DOCK, advanceWhen: `${DOCK} .estate-chosen`, action: "Нажми", title: "Что построить?", text: "Первый шаг стройки — каталог: дома, офисы, скверы, дороги, деревья. Начнём с дома — нажми на него." },
  { target: ".city-frame", when: DOCK, advanceWhen: `${DOCK} .estate-where .estate-ok`, allow: ".city-mount, .city-turn", action: "Нажми на клетку",
    mistakes: [{ when: `${DOCK} .estate-where .estate-problem`, text: "Здесь занято — красные клетки мешают. Нажми на другую зелёную клетку." },
      { when: `${DOCK} .estate-back`, text: "Это твоя постройка. Нажми на свободную зелёную клетку рядом — дом встанет там." }],
    title: "Где поставить?", text: "Второй шаг — место. Нажми на любую зелёную клетку: дом встанет вокруг неё. Повернуть карту можно кнопками ↺ ↻ внизу." },
  { target: `${DOCK} .estate-buybar`, when: `${DOCK} .estate-buybar`, title: "Купить", text: "Третий шаг — покупка. Цена — земля под клетками и сам дом, коины спишутся только после «Купить». Сейчас покупать не обязательно: вернёшься, когда захочешь." },
  { target: `${DOCK} .estate-dock__close`, when: DOCK, advanceWhen: PANEL("skills"), action: "Нажми", slot: FINISH, title: "Закроем стройку", text: "Выбранное место сбросится, ничего не купится. Нажми ✕." },

  { target: PANEL("skills"), when: PANEL("skills"), advanceWhen: ".skills", action: "Нажми", slot: FINISH, title: "Экскурсия пройдена!", text: "Награда ждёт в «Навыках». Нажми на них." },
  { target: ".skills-next[data-reward] .city-action, .skills-foot .city-action", when: ".skills", action: "Нажми", waitClick: true, title: "Забери награду", text: "Опыт и коины придут сразу. Дальше — миссии других районов: автопарк, CRM и Диспетчерская. Удачи!" },
];
