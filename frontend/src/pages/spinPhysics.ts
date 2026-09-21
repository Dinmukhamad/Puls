/**
 * Общая механика розыгрыша: профиль скорости и подгонка холста.
 *
 * Вынесено из компонента отдельным модулем, потому что это единственные
 * места, где легко ошибиться незаметно — и единственные, которые можно
 * проверить без браузера.
 */

/**
 * Профиль скорости: разгон, затем инерционное торможение до полной
 * остановки. Возвращает долю пройденного пути от 0 до 1.
 *
 * Скорость нулевая на обоих концах — это и отличает живое движение от
 * перемотки: лента трогается с места и останавливается, а не возникает
 * уже в движении.
 *
 *   до ACCEL       скорость растёт линейно (разгон),
 *   после ACCEL    падает квадратично до нуля (выбег).
 *
 * Обе ветви сходятся в точке ACCEL и по значению, и по скорости, поэтому
 * перелома в движении не видно.
 */
const ACCEL = 0.22;
const SPAN = ACCEL / 2 + (1 - ACCEL) / 3;

export function spinProgress(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (t <= ACCEL) return (t * t) / (2 * ACCEL) / SPAN;
  const tail = (1 - t) / (1 - ACCEL);
  return (ACCEL / 2 + ((1 - ACCEL) / 3) * (1 - tail ** 3)) / SPAN;
}

/**
 * Подгоняет буфер холста под размер на экране с учётом плотности пикселей.
 *
 * Стороны проверяются по отдельности намеренно. Сначала здесь стояло одно
 * условие по ширине — и оно промахивалось ровно в самом частом случае: у
 * холста размер буфера по умолчанию 300x150, ширина совпадала с нужной,
 * присваивание не выполнялось, и высота оставалась 150. Картинка рисовалась
 * обрезанной, при этом и типы, и сборка, и тесты были зелёными.
 */
export function fitCanvas(
  canvas: { width: number; height: number; clientWidth: number; clientHeight: number },
  ratio: number,
): boolean {
  const w = Math.round(canvas.clientWidth * ratio);
  const h = Math.round(canvas.clientHeight * ratio);
  let changed = false;
  if (canvas.width !== w) { canvas.width = w; changed = true; }
  if (canvas.height !== h) { canvas.height = h; changed = true; }
  return changed;
}

/**
 * Куда должна доехать лента, чтобы под меткой оказался нужный приз.
 *
 * Лента бесконечна и повторяет набор призов по кругу, поэтому карточка
 * задаётся сквозным номером: карточка номер i стоит под меткой, когда
 * смещение равно i умножить на шаг. Из всех подходящих номеров берём
 * ближайший вперёд — назад лента ехать не должна.
 *
 * @param current текущее смещение в пикселях
 * @param prize   индекс приза, который выбрал сервер
 * @param count   сколько всего призов в наборе
 * @param pitch   расстояние между центрами соседних карточек
 * @param laps    сколько полных проходов набора сделать до остановки
 */
export function stripTarget(
  current: number,
  prize: number,
  count: number,
  pitch: number,
  laps = 4,
): number {
  const from = Math.round(current / pitch);
  let index = from + laps * count;
  // Доводим номер до нужного приза, двигаясь только вперёд.
  index += (((prize - (index % count)) % count) + count) % count;
  return index * pitch;
}

/** Какой приз сейчас под меткой — обратная операция к stripTarget. */
export function prizeUnderMark(offset: number, count: number, pitch: number): number {
  const index = Math.round(offset / pitch);
  return ((index % count) + count) % count;
}
