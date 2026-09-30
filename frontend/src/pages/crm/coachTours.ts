/** Guided tours: Pulsar flies to each target, points at it and explains it in a speech bubble. */
export interface CoachStep {
  /** CSS selector of the element Pulsar points at. */
  target: string;
  title: string;
  text: string;
  /** Moves on by itself once this selector appears, e.g. after the operator clicks the highlighted button. Until then the step waits. */
  advanceWhen?: string;
  /** The step is skipped when this selector is already on screen (the operator is past it). */
  skipWhen?: string;
  /** The operator acts on the lit element: only then it is clickable. Without it the step only explains. */
  action?: string;
  /** The step applies only while this selector matches, e.g. after a particular category was chosen. */
  when?: string;
  /** The step waits until the operator presses the lit element, then moves on (the last one ends the tour). */
  waitClick?: boolean;
  /** With `waitClick`: after the press the step also waits for the lit element to go away, so a failed save keeps the operator here. */
  untilGone?: boolean;
  /** Places the operator also needs during this step; the rest of the page stays locked. */
  allow?: string;
  /** Something Pulsar hands over inside his bubble, rendered by the page that runs the tour. */
  slot?: string;
}
export type CoachTourId = "appeals" | "drivers" | "promoConnect" | "promoRegistry" | "promoBackdated" | "promoConditions" | "registration" | "edo" | "edoProvider" | "edoDashboard" | "providerDashboard";
type Side = "right" | "left" | "below" | "above";

/** Room between the target and Pulsar, where the pointing hand sits. */
const GAP = 70;

/** Where Pulsar stands next to the target and where his speech bubble goes; all in viewport pixels. */
export function coachLayout(target: { left: number; top: number; right: number; bottom: number }, view: { width: number; height: number; right: number }, size: { mascot: number; bubbleW: number; bubbleH: number }) {
  const { mascot, bubbleW, bubbleH } = size, midY = (target.top + target.bottom) / 2, midX = (target.left + target.right) / 2;
  const roomRight = view.right - target.right, roomLeft = target.left;
  const side: Side = roomRight >= mascot + GAP * 2 ? "right" : roomLeft >= mascot + GAP * 2 ? "left" : target.top > view.height - target.bottom ? "above" : "below";
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(Math.max(lo, hi), v));
  const mx = side === "right" ? target.right + GAP : side === "left" ? target.left - GAP - mascot : clamp(midX - mascot / 2, 8, view.right - mascot - 8);
  const my = side === "below" ? target.bottom + GAP : side === "above" ? target.top - GAP - mascot : clamp(midY - mascot / 2, 8, view.height - mascot - 8);
  // The bubble prefers the free side of the mascot, then above or below it, and always stays on screen.
  let bx: number, by: number;
  if (side === "right" && view.right - (mx + mascot) >= bubbleW + 12) { bx = mx + mascot + 8; by = my + mascot / 2 - bubbleH / 2; }
  else if (side === "left" && mx >= bubbleW + 12) { bx = mx - bubbleW - 8; by = my + mascot / 2 - bubbleH / 2; }
  else { bx = mx + mascot / 2 - bubbleW / 2; by = my - bubbleH - 10 >= 8 && side !== "below" ? my - bubbleH - 10 : my + mascot + 10; }
  bx = clamp(bx, 8, view.right - bubbleW - 8); by = clamp(by, 8, view.height - bubbleH - 8);
  // The hand is centred in the gap between Pulsar and the target.
  const hand = side === "right" ? { x: target.right + GAP / 2, y: midY, icon: "👈" } : side === "left" ? { x: target.left - GAP / 2, y: midY, icon: "👉" } : side === "below" ? { x: midX, y: target.bottom + GAP / 2, icon: "👆" } : { x: midX, y: target.top - GAP / 2, icon: "👇" };
  return { side, mascot: { x: mx, y: my, flip: side === "left" }, bubble: { x: bx, y: by }, hand };
}


const CAT = "[data-coach=categories]", FORM = "[data-coach=appeal-form]", DONE = `${CAT}[data-complete=true]`, DRIVER = `${CAT}[data-root="Водитель"]`;
const choice = (level: number, label: string) => `[data-coach=category-${level}][data-choice="${label}"]`;
const level = (n: number) => `[data-coach=category-${n}]`;
/** The next category level appeared, or the chosen one was the last. */
const chosen = (n: number) => `${level(n + 1)}, ${DONE}`;

export const COACH_TOURS: Record<CoachTourId, CoachStep[]> = {
  appeals: [
    { target: "[data-coach=create]", skipWhen: "[data-coach=channel]", advanceWhen: "[data-coach=channel]", action: "Нажми сюда", title: "Привет! Я Пульсар 👋", text: "Покажу, как оформить обращение водителя. Начнём с кнопки «Создать обращение»." },
    { target: "[data-coach=channel]", action: "Выбери", title: "Откуда обращение?", text: "Выбери, как связался водитель: позвонил или написал в чат." },
    { target: "[data-coach=phone]", action: "Заполни", title: "Телефон водителя", text: "Впиши номер, с которого водитель звонит или пишет. По нему его найдут." },
    { target: "[data-coach=license_number]", action: "Заполни", title: "Номер В/У", text: "Номер водительского удостоверения возьми из диспетчерской. ID водителя можно не заполнять." },
    { target: "[data-coach=park]", advanceWhen: "[data-coach=city]", action: "Выбери", title: "Таксопарк", text: "Выбери таксопарк водителя. Сразу после этого появится поле «Город»." },
    { target: "[data-coach=city]", advanceWhen: "[data-coach=city][data-filled=true]", action: "Выбери", title: "Город", text: "Теперь выбери город, в котором работает водитель." },
    { target: level(1), advanceWhen: chosen(1), action: "Выбери", title: "Категория 1 — кто обратился", text: "Если звонит или пишет водитель, выбери «Водитель». Для пассажира, Яндекса или постороннего звонка — свой пункт." },
    // Driver branch: type, then what the driver needs.
    { target: level(2), when: `${DRIVER} ${level(2)}`, advanceWhen: chosen(2), action: "Выбери", title: "Категория 2 — тип водителя", text: "Обычный водитель или самозанятый? Тип виден в учётной записи водителя: «Физлицо» или «СМЗ»." },
    { target: level(3), when: `${DRIVER} ${level(3)}`, advanceWhen: chosen(3), action: "Выбери", title: "Категория 3 — что нужно водителю", text: "«Консультация» — ты сам ответил на вопросы, и всё. «Запрос» — задачу надо передать отделу: смена авто, номера, лимит. «Жалоба/Благодарность» — отзыв о чьей-то работе." },
    { target: level(4), when: choice(3, "Консультация"), advanceWhen: DONE, action: "Выбери", title: "Консультация", text: "Выбери тему, по которой ты объяснял: тарифы, баланс, фотоконтроль и т. д. Консультация значит, что ты всё рассказал сам — отдел не нужен." },
    { target: level(4), when: choice(3, "Запрос"), advanceWhen: chosen(4), action: "Выбери", title: "Запрос — кому передаём", text: "«Таксопарк» — наши отделы: смена авто, номера, лимит, вывод денег. «Яндекс» — если ты уже создал тикет в поддержку Яндекса в диспетчерской." },
    { target: level(5), when: choice(4, "Таксопарк"), advanceWhen: chosen(5), action: "Выбери", title: "Отдел", text: "«Обработка запросов/ООЗ» — смена автомобиля, номера, снятие лимита, условия работы. «Запросы по Такси.Про» — вывод денег, пополнение Каспи, вход в приложение." },
    { target: level(6), when: `${DRIVER} ${level(6)}`, advanceWhen: DONE, action: "Выбери", title: "Что именно сделать", text: "Выбери конкретную задачу, например «Смена номера» или «Смена автомобиля». От неё зависит, что писать и прикладывать." },
    { target: level(4), when: choice(3, "Жалоба/Благодарность"), advanceWhen: chosen(4), action: "Выбери", title: "Жалоба или благодарность", text: "Выбери, что это: жалоба или благодарность. Дальше укажешь, на кого: сотрудник ОТП, ОП, Регионы, таксопарк или Яндекс." },
    { target: level(5), when: choice(4, "Жалоба"), advanceWhen: DONE, action: "Выбери", title: "На кого жалоба", text: "Выбери отдел или компанию. Для сотрудника ОТП, ОП или Регионов появится поле для его имени." },
    { target: level(5), when: choice(4, "Благодарность"), advanceWhen: DONE, action: "Выбери", title: "Кого благодарят", text: "Выбери отдел или компанию. Для сотрудника ОТП, ОП или Регионов появится поле для его имени." },
    // Other callers: walk to the last level without driver-specific advice.
    { target: level(2), when: `${CAT}:not([data-root="Водитель"]) ${level(2)}`, advanceWhen: DONE, allow: CAT, action: "Выбери", title: "Уточни причину", text: "Выбирай следующие категории по порядку, пока не дойдёшь до последней. Серые варианты недоступны." },
    // Any branch without its own steps is finished here: the whole category block is open.
    { target: CAT, when: `${CAT}:not([data-complete=true])`, advanceWhen: DONE, action: "Выбери", title: "Доведи категорию до конца", text: "Выбери оставшиеся категории по порядку, пока не дойдёшь до последней. Без неё обращение не сохранится." },
    { target: "[data-coach=context-help]", when: DONE, title: "Моя подсказка", text: "Для выбранной категории я показываю инструкцию: что проверить и что приложить. Прочитай её перед тем, как заполнять комментарий." },
    { target: "[data-coach=extra-field]", when: "[data-coach=extra-field]", allow: "[data-coach=extra-field]", action: "Заполни", title: "Дополнительные поля", text: "Этой категории нужны отдельные поля: имя сотрудника, транзакция или новые условия. Заполни их." },
    // The comment and files come last and depend on the chosen category.
    { target: "[data-coach=comment]", when: `${FORM}[data-rules~=phone_change]`, action: "Напиши", title: "Смена номера: комментарий", text: "Напиши старый номер, новый номер и ссылку на аккаунт водителя из диспетчерской. Без ссылки отдел не найдёт водителя." },
    { target: "[data-coach=files]", when: `${FORM}[data-rules~=phone_change]`, action: "Приложи", title: "Смена номера: скриншоты", text: "Скриншоты обязательны: Октелл и диспетчерская, номер водителя должен быть виден на обоих. Вставь их Ctrl+V или перетащи." },
    { target: "[data-coach=comment]", when: `${FORM}[data-leaf="Смена автомобиля"]`, action: "Напиши", title: "Смена автомобиля: комментарий", text: "Ссылка на аккаунт водителя и данные новой машины: марка, модель, год, цвет и госномер. Фото техпаспорта приложи файлом." },
    { target: "[data-coach=comment]", when: `${FORM}[data-rules~=account_link]:not([data-rules~=phone_change]):not([data-leaf="Смена автомобиля"])`, action: "Напиши", title: "Комментарий к запросу", text: "Обязательно вставь ссылку на аккаунт водителя из диспетчерской и коротко напиши, что нужно сделать." },
    { target: "[data-coach=comment]", when: `${FORM}[data-rules~=description]:not([data-rules~=account_link])`, action: "Опиши", title: "Опиши ситуацию", text: "Подробно: что произошло, когда и с кем. Если это запрос в Яндекс — укажи номер тикета." },
    { target: "[data-coach=comment]", when: `${FORM}[data-path*="/ Консультация /"]`, action: "Напиши", title: "Комментарий", text: "Коротко запиши, о чём спрашивал водитель и что ты ему ответил." },
    { target: "[data-coach=comment]", when: `${FORM}[data-rules=""]:not([data-path*="/ Консультация /"])`, action: "Напиши", title: "Комментарий", text: "Если нужно, коротко опиши обращение своими словами." },
    { target: "[data-coach=files]", when: `${FORM}[data-rules~=image]:not([data-rules~=phone_change])`, action: "Приложи", title: "Скриншот обязателен", text: "Для этой категории нужен скриншот. Нажми Ctrl+V, выбери файл или перетащи его сюда." },
    { target: "[data-coach=save]", waitClick: true, untilGone: true, action: "Проверь и нажми", title: "Финиш! 🎉", text: "Проверь данные и нажми «Сохранить». Обращение увидят все участники. Ты справился!" },
  ],
  drivers: [
    // List: find the driver and read the row.
    { target: "[data-coach=drv-search]", action: "Вставь ссылку", title: "Поиск водителя", text: "Вставь ссылку на водителя или его ID. Я сам достану ID из части между «/contractors/» и «/details». Искать можно и по ФИО, телефону, госномеру." },
    { target: ".drv-table tbody tr:first-child", title: "Строка водителя", text: "ID и аккаунт, парк, работает ли он и статус на линии (свободен, занят, офлайн), тип: физлицо или самозанятый. Ниже — отметки о лимите и фотоконтроле." },
    { target: ".drv-table tbody tr:first-child .drv-btn--details", advanceWhen: "[data-coach=drv-card]", action: "Нажми", title: "Открой карточку", text: "Нажми «Подробнее» — покажу, что значит каждое поле в карточке водителя." },
    // Card: what each block means.
    { target: "[data-coach=drv-summary]", title: "Шапка карточки", text: "Телефон и парк водителя, тип сотрудничества, условия работы (комиссия парка), статус в CRM и дата создания аккаунта." },
    { target: "[data-coach=drv-tiles]", title: "Данные из Диспетчерской", text: "Работает ли водитель, статус на линии, баланс счёта, рейтинг, поступают ли наличные заказы и пройден ли фотоконтроль." },
    { target: "[data-coach=drv-car]", title: "Автомобиль", text: "Марка и модель, госномер, год, цвет и тарифы, по которым водитель может брать заказы." },
    { target: "[data-coach=drv-contacts]", title: "Контакты", text: "Телефон, номер В/У, позывной (обычно это госномер), ИИН и адрес прописки — их спрашивают при переводе в СМЗ." },
    { target: "[data-coach=drv-extra]", title: "Дополнительно", text: "Лимит по счёту, сколько кодов уже отправлено и ссылка на водителя. Эту ссылку вставляют в комментарий запроса." },
    { target: "[data-coach=drv-history-tab]", title: "История", text: "Здесь все действия с аккаунтом: смена машины, лимит, коды, перевод в СМЗ. Проверь её, если водитель говорит, что что-то уже меняли." },
    // Car change, field by field.
    { target: "[data-coach=drv-card] .drv-card-actions .drv-btn--car", advanceWhen: "[data-coach=car-editor]", action: "Нажми", title: "Смена автомобиля", text: "Покажу, как сменить машину водителя. Нажми «Автомобиль»." },
    { target: "[data-coach=car-mode] button:last-child", skipWhen: "[data-coach=car-mode][data-mode=new]", advanceWhen: "[data-coach=car-mode][data-mode=new]", action: "Нажми «Новый»", title: "Существующий или новый", text: "«Существующий» — поправить данные текущей машины. Чтобы сменить машину, нажми «Новый»: форма очистится." },
    { target: "[data-coach=car-plate]", action: "Впиши", title: "Госномер", text: "Госномер без пробелов, как в техпаспорте, например 803ASD02." },
    { target: "[data-coach=car-brand]", action: "Выбери", title: "Марка", text: "Выбери марку автомобиля. После этого откроется список её моделей." },
    { target: "[data-coach=car-model]", action: "Выбери", title: "Модель", text: "Выбери модель из списка выбранной марки." },
    { target: "[data-coach=car-color]", action: "Выбери", title: "Цвет", text: "Цвет — как в техпаспорте: по нему водителя узнаёт пассажир." },
    { target: "[data-coach=car-year]", action: "Выбери", title: "Год выпуска", text: "Год выпуска из техпаспорта. От него зависит, в какие тарифы машина может попасть." },
    { target: "[data-coach=car-callsign] button", waitClick: true, action: "Нажми «Скопировать»", title: "Позывной = госномер", text: "Обязательно скопируй госномер в «Позывной» кнопкой «Скопировать госномер». Без этого машину не сохранить." },
    { target: "[data-coach=car-tariffs]", action: "Отметь", title: "Тарифы", text: "Отметь тарифы, по которым водитель будет работать на этой машине." },
    { target: "[data-coach=car-save]", waitClick: true, untilGone: true, action: "Нажми", title: "Сохранение", text: "Нажми «Сохранить» — машина сменится в профиле. Потом скажи водителю пройти фотоконтроль автомобиля и техпаспорта в Яндекс Про." },
    { target: "[data-coach=car-back]", skipWhen: "[data-coach=drv-card]", advanceWhen: "[data-coach=drv-card]", action: "Нажми", title: "Назад к карточке", text: "Вернёмся в карточку водителя — покажу лимит на наличные заказы." },
    // Cash limit.
    { target: "[data-coach=drv-card] .drv-card-actions .drv-btn--limit", advanceWhen: "[data-coach=limit-screen]", action: "Нажми", title: "Лимит наличных", text: "Нажми «Лимит» — это управление наличными заказами водителя." },
    { target: "[data-coach=limit-status]", title: "Текущий статус лимита", text: "«Отключён» — наличные заказы приходят как обычно. «Включён» — водитель получает только безналичные заказы." },
    { target: "[data-coach=limit-on]", title: "Включить лимит", text: "Включай лимит 500 000 ₸, когда водителя нужно перевести на безналичные заказы: наличные перестанут приходить." },
    { target: "[data-coach=limit-off]", title: "Отключить лимит", text: "Отключи лимит, и наличные заказы снова начнут поступать. Каждое изменение попадает в историю водителя." },
    { target: "[data-coach=limit-back]", skipWhen: "[data-coach=drv-search]", advanceWhen: "[data-coach=drv-search]", action: "Нажми", title: "К списку", text: "Вернёмся к списку водителей — там ещё две кнопки." },
    // Remaining row actions.
    { target: ".drv-table tbody tr:first-child .drv-btn--smz, .drv-table tbody tr:first-child .drv-btn--individual", title: "«СМЗ»", text: "Переводит водителя в самозанятые. Понадобятся адрес прописки и ИИН из 12 цифр. Потом водитель перезаходит в Яндекс Про." },
    { target: ".drv-table tbody tr:first-child .drv-btn--code", title: "«Код»", text: "Отправляет водителю код подтверждения для входа в Такси Про. Сначала уточни, что телефон с этим номером у него под рукой." },
    { target: "[data-coach=drv-reset]", title: "Практикуйся смело 💪", text: "Эти водители — учебные. Эта кнопка вернёт их в исходное состояние, если захочешь начать заново." },
  ],

  promoConnect: [
    { target: "[data-coach=promo-search]", advanceWhen: "[data-coach=promo-driver]", action: "Впиши и найди", title: "Найди водителя", text: "Впиши ID аккаунта и нажми «Найти». Для примера — Сапарова: 2a06d17a5b00451db3b7bf91b76423da." },
    { target: "[data-coach=promo-driver]", title: "Данные водителя", text: "Диспетчерская — это парк водителя. Смотри условие работы, Blacklist, платный найм и тип сотрудничества: от них зависят акции." },
    { target: "[data-coach=promo-history]", title: "Его акции", text: "Текущие и прошлые акции с прогрессом и статусами. Если водитель уже в акции, второй раз её не подключают." },
    { target: "[data-coach=promo-available]", when: "[data-coach=promo-available]", advanceWhen: "[data-coach=promo-joined]", action: "Нажми «Подключить»", title: "Подключи акцию", text: "Здесь только акции, подходящие парку и водителю. Нажми «Подключить» у нужной и назови водителю условие и срок." },
    { target: "[data-coach=promo-none]", when: "[data-coach=promo-none]", title: "Нет подходящих акций", text: "Для парка этого водителя акций нет — так и скажи водителю. Так будет, например, у Ахметовой из «Честный Алматы»." },
    { target: "[data-coach=side-promo-registry]", title: "Дальше — реестр", text: "Подключённый водитель появился в «Реестре участников»: там его прогресс и выплата." },
  ],
  promoRegistry: [
    { target: "[data-coach=registry-banner]", title: "Только по кнопке", text: "Автоначисление приостановлено: деньги уходят только по кнопке «Пополнить». Исключение — акции вроде «Тенге 2000»: они начисляются сами." },
    { target: "[data-coach=registry-legend]", title: "Статусы выплаты", text: "«Готово к выплате» и «Ошибка начисления» — кнопка активна. «Требует проверки» сверяет финансовый отдел, не оператор." },
    { target: "[data-coach=registry-filters]", title: "Фильтры", text: "Найди водителя по ID, акции или статусу. Фильтры применяются кнопкой «Применить»." },
    { target: "[data-coach=registry-pay]:not(:disabled)", when: "[data-coach=registry-pay]:not(:disabled)", advanceWhen: "[data-coach=registry-confirm]", action: "Нажми", title: "Пополнить", text: "Кнопка активна только у «Готово к выплате» и «Ошибка начисления». Нажми «Пополнить» в подсвеченной строке." },
    { target: "[data-coach=registry-confirm] .crm-primary", waitClick: true, untilGone: true, action: "Нажми", title: "Подтверди выплату", text: "Проверь водителя, акцию и прогресс и подтверди: деньги уйдут водителю сразу." },
    { target: "[data-coach=registry-table]", title: "Выплачено", text: "Строка стала «Выплачено»: заполнились сумма и дата выплаты. Строки «Требует проверки» не трогаем." },
  ],
  promoBackdated: [
    { target: "[data-coach=backdated-note]", title: "Заявка задним числом", text: "Если водителя вовремя не добавили в акцию, подаём заявку руководителю. После подтверждения водитель попадёт в реестр." },
    { target: "[data-coach=backdated-promo]", action: "Выбери", title: "Акция", text: "Задним числом добавляют только в денежные акции, например «Приведи друга»." },
    { target: "[data-coach=backdated-account]", action: "Впиши", title: "ID водителя", text: "ID из карточки водителя, например Абдрахманова: bfcb98ee71d54682be284538b31985fd." },
    { target: "[data-coach=backdated-since]", action: "Выбери дату", title: "Участник с", text: "Дата, с которой водитель должен был участвовать. Если прошло больше 14 дней, руководитель откажет." },
    { target: "[data-coach=backdated-reason]", action: "Напиши", title: "Причина", text: "Почему водителя не добавили вовремя: например, его сообщение в WhatsApp осталось необработанным." },
    { target: "[data-coach=backdated-files]", action: "Приложи", title: "Подтверждение", text: "Без вложения заявку не примут: нажми «Выбрать файлы» и приложи скриншот переписки." },
    { target: "[data-coach=backdated-send]", advanceWhen: "[data-coach=backdated-sent]", action: "Нажми", title: "Отправь", text: "Отправь заявку руководителю. Если чего-то не хватает, CRM подсветит поле с ошибкой." },
    { target: "[data-coach=backdated-list]", title: "Мои заявки", text: "Руководитель ответит через 2 минуты: «Одобрена» — водитель в реестре, «Отклонена» — с причиной." },
  ],
  promoConditions: [
    { target: "[data-coach=conditions-promo]", action: "Выбери", title: "Акция", text: "Здесь акции, которые меняют условия работы, например «Неделя без комиссии — 7 дн.»." },
    { target: "[data-coach=conditions-account]", action: "Впиши", title: "ID аккаунта", text: "ID из Диспетчерской. Попробуй Ахметову из «Честный Алматы»: 390d464b21d847f2a0b26a7143b7aa5f." },
    { target: "[data-coach=conditions-add]", advanceWhen: "[data-coach=conditions-result]", action: "Нажми", title: "Добавить", text: "Нажми «Добавить»: CRM проверит, участвует ли парк водителя в акции." },
    { target: "[data-coach=conditions-result]", title: "Ответ CRM", text: "Парк «Честный» в акции не участвует — добавить нельзя, объясни это водителю. Для Омарова из iTaxi Алматы всё получится." },
    { target: "[data-coach=conditions-recent]", title: "Последние добавления", text: "Здесь твои добавления. Условие работы водителя меняется и в его учётной записи." },
  ],
  registration: [
    { target: "[data-coach=reg-new]", skipWhen: "[data-coach=reg-form]", advanceWhen: "[data-coach=reg-form]", action: "Нажми", title: "Новый водитель", text: "Нажми «Новый водитель» — откроется форма регистрации." },
    { target: "[data-coach=reg-type]", action: "Выбери", title: "Тип сотрудничества", text: "Физическое лицо или самозанятый (СМЗ). Для СМЗ появится поле «Адрес»." },
    { target: "[data-coach=reg-address]", when: "[data-coach=reg-address]", action: "Впиши", title: "Адрес", text: "Для СМЗ нужен адрес прописки водителя." },
    { target: "[data-coach=reg-park]", action: "Выбери", title: "Парк", text: "Парк, в котором водитель будет работать." },
    { target: "[data-coach=reg-profession]", action: "Выбери", title: "Профессия", text: "От профессии зависят поля: водителю нужны В/У и автомобиль, вело- и пешему курьеру — дата рождения." },
    { target: "[data-coach=reg-names]", action: "Впиши", title: "ФИО", text: "Фамилия и имя обязательны, отчество — если есть. Пиши как в документе." },
    { target: "[data-coach=reg-phone]", action: "Впиши", title: "Телефон", text: "Номер начинается с +7, всего 11 цифр. Можно вписать с 8 — CRM поправит." },
    { target: "[data-coach=reg-docs]", action: "Заполни", title: "Документы", text: "В/У и его даты или дата рождения, и ИИН. Первые 6 цифр ИИН — дата рождения ГГММДД." },
    { target: "[data-coach=reg-car]", when: "[data-coach=reg-car]", action: "Заполни", title: "Автомобиль", text: "Марка, модель, цвет, год выпуска и госномер латинскими буквами." },
    { target: "[data-coach=reg-check]", advanceWhen: "[data-coach=reg-check-result]", action: "Нажми", title: "Проверь водителя", text: "«Проверить водителя» ищет такой же телефон, ИИН или В/У. Без проверки CRM не сохранит." },
    { target: "[data-coach=reg-check-result]", title: "Результат проверки", text: "Если водитель уже есть, повторно не регистрируй — открой его учётную запись. Если поменял данные, проверь снова." },
    { target: "[data-coach=reg-save]", waitClick: true, untilGone: true, action: "Нажми", title: "Сохрани", text: "«Сохранить» — водитель появится в «Учётных записях водителей». Данных пока не хватает — «Сохранить черновик»." },
  ],
  edo: [
    { target: "[data-coach=edo-filters]", title: "Фильтры ЭДО", text: "Период, парк, ЭЦП и статусы документов. «Только самозанятые» и «Скрыть невыставленные» сужают список." },
    { target: "[data-coach=edo-table]", title: "Документы водителя", text: "За период: провайдер, выставлены ли документы, ЭЦП, АВР Яндекса и парка, договор. Таблица листается вправо." },
    { target: "[data-coach=edo-refresh]", waitClick: true, action: "Нажми", title: "Обновить статус", text: "Кнопка спрашивает Sapar ещё раз. Пока водитель не подписал документы, статус не меняется." },
    { target: "[data-coach=edo-call]", advanceWhen: "[data-coach=edo-call-dialog]", action: "Нажми", title: "Позвони водителю", text: "Трубка — звонок водителю. Напомни ему подписать документы в Sapar." },
    { target: "[data-coach=edo-call-dialog]", advanceWhen: "[data-coach=edo-call-saved]", action: "Заполни", title: "Итог звонка", text: "Отметь дозвон, явку в офис и коротко запиши договорённость. Потом «Сохранить»." },
    { target: "[data-coach=edo-refresh]", waitClick: true, action: "Нажми", title: "Ещё раз обнови", text: "Водитель обещал подписать — снова «Обновить статус»: документы станут «Подписано»." },
    { target: "[data-coach=edo-history]", advanceWhen: "[data-coach=edo-history-dialog]", action: "Нажми", title: "История", text: "Стрелка открывает историю строки: звонки и обновления статуса." },
    { target: "[data-coach=edo-history-dialog]", title: "Всё записано", text: "Здесь каждый звонок и ответ Sapar. Сводка по периоду — в «Дашборд ЭДО»." },
  ],
  edoProvider: [
    { target: "[data-coach=provider-filters]", title: "Смена провайдера", text: "Обзвон водителей без ЭЦП или не на Sapar. Фильтры — по парку, статусам звонка и итогам." },
    { target: "[data-coach=provider-table]", title: "Статусы обзвона", text: "Дозвон, итог звонка, запрос ID и «Провайдер сменили» — по каждому водителю." },
    { target: "[data-coach=provider-call]", advanceWhen: "[data-coach=provider-call-dialog]", action: "Нажми", title: "Позвони", text: "Трубка — звонок водителю. Предложи перейти на Sapar." },
    { target: "[data-coach=provider-call-dialog]", advanceWhen: "[data-coach=provider-call-saved]", action: "Заполни", title: "Итог звонка", text: "Согласен — отметь «Запрос ID». Когда ID получен, выбери «Получен»: провайдер сменится на Sapar." },
    { target: "[data-coach=provider-table]", title: "Готово", text: "Статусы обновились. Сводка по кампании — в «Дашборд смены провайдера»." },
  ],
  edoDashboard: [
    { target: "[data-coach=edo-signatures]", title: "ЭЦП и подписания", text: "Сколько самозанятых с поездками, у скольких валидная ЭЦП и доля подписанных АВР и договоров." },
    { target: "[data-coach=edo-all]", title: "Все три документа", text: "Главная цифра: у скольких подписаны все три документа. Целевой уровень — 50%." },
    { target: "[data-coach=edo-calls]", title: "Обзвон", text: "Кого нужно прозвонить (нет ЭЦП или не Sapar) и сколько контактов уже обработано." },
    { target: "[data-coach=edo-rating]", title: "Рейтинг менеджеров", text: "Обработанные звонки по дням за последние 7 дней. Твои звонки тоже попадут сюда." },
  ],
  providerDashboard: [
    { target: "[data-coach=provider-metrics]", title: "Общие метрики", text: "Всего контактов кампании, сколько обработано и процент выполнения звонков." },
    { target: "[data-coach=provider-tables]", title: "По статусам", text: "Разбивка по обработке, дозвону, итогу звонка, запросу ID и смене провайдера." },
  ],
};
