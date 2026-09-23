/** Guided tours: Pulsar flies to each target, points at it and explains it in a speech bubble. */
export interface CoachStep {
  /** CSS selector of the element Pulsar points at. */
  target: string;
  title: string;
  text: string;
  /** Moves on by itself once this selector appears, e.g. after the operator clicks the highlighted button. */
  advanceWhen?: string;
  /** The step is skipped when this selector is already on screen (the operator is past it). */
  skipWhen?: string;
  /** A hint that the operator should act, shown next to the pointing hand. */
  action?: string;
}
export type CoachTourId = "appeals" | "drivers";
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


export const COACH_TOURS: Record<CoachTourId, CoachStep[]> = {
  appeals: [
    { target: "[data-coach=create]", skipWhen: "[data-coach=channel]", advanceWhen: "[data-coach=channel]", action: "Нажми сюда", title: "Привет! Я Пульсар 👋", text: "Покажу, как оформить обращение водителя. Начнём с кнопки «Создать обращение»." },
    { target: "[data-coach=channel]", title: "Откуда обращение?", text: "Выбери, как связался водитель: позвонил или написал в чат." },
    { target: "[data-coach=phone]", action: "Заполни", title: "Телефон водителя", text: "Впиши номер, с которого водитель звонит или пишет. Он нужен, чтобы найти водителя." },
    { target: "[data-coach=license_number]", action: "Заполни", title: "Номер В/У", text: "Номер водительского удостоверения возьми из диспетчерской. ID водителя можно не заполнять." },
    { target: "[data-coach=park]", title: "Таксопарк и город", text: "Выбери таксопарк водителя — после этого появится выбор города." },
    { target: "[data-coach=categories]", advanceWhen: "[data-coach=context-help]", action: "Выбери", title: "Причина обращения", text: "Выбирай категории по порядку: каждая следующая зависит от предыдущей. Серые варианты недоступны." },
    { target: "[data-coach=context-help]", title: "Моя подсказка", text: "Для выбранной категории я показываю инструкцию. Прочитай её — там всё, что нужно сделать и приложить." },
    { target: "[data-coach=comment]", action: "Опиши", title: "Комментарий", text: "Опиши ситуацию своими словами. Если инструкция просит ссылку на аккаунт — вставь её сюда." },
    { target: "[data-coach=files]", title: "Скриншоты", text: "Перетащи файл, выбери его или просто нажми Ctrl+V — скриншот прикрепится сам." },
    { target: "[data-coach=ticket]", title: "Тикет для отдела", text: "Включи «Формировать тикет», если запрос нужно передать отделу. Для некоторых категорий я включаю его сам." },
    { target: "[data-coach=save]", action: "Проверь и нажми", title: "Финиш! 🎉", text: "Проверь данные и нажми «Сохранить». Обращение увидят все участники. Ты справился!" },
  ],
  drivers: [
    { target: "[data-coach=drv-search]", action: "Вставь ссылку", title: "Поиск водителя", text: "Вставь ссылку на водителя или его ID. Я сам достану ID из части между «/contractors/» и «/details»." },
    { target: ".drv-table tbody .drv-btn--details", title: "«Подробнее»", text: "Карточка водителя: телефон, парк, автомобиль, баланс и вся история действий." },
    { target: ".drv-table tbody .drv-btn--smz", title: "«СМЗ»", text: "Переводит водителя в самозанятые. Понадобятся адрес прописки и ИИН из 12 цифр. Потом водитель перезаходит в Яндекс Про." },
    { target: ".drv-table tbody .drv-btn--limit", title: "«Лимит»", text: "Включает лимит 500 000 ₸ — водитель перестаёт получать наличные заказы. Лимит можно и отключить." },
    { target: ".drv-table tbody .drv-btn--car", title: "«Автомобиль»", text: "Смена машины: нажми «Новый», заполни данные и обязательно скопируй госномер в «Позывной»." },
    { target: ".drv-table tbody .drv-btn--code", title: "«Код»", text: "Отправляет водителю код подтверждения для входа в Такси Про." },
    { target: "[data-coach=drv-reset]", title: "Практикуйся смело 💪", text: "Эти водители — учебные. Эта кнопка вернёт их в исходное состояние, если захочешь начать заново." },
  ],
};
