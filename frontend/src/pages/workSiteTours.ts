/**
 * Pulsar's walks through the work sites (docs/TRAINING_CRM.md, «Подсказки Пульсара»): the first visit to Oktell or the
 * Диспетчерская starts its walk by itself once per account, from whichever device. «Помощь Пульсара» replays any walk.
 */
export type TourState = "done" | "closed";
type Record_ = Partial<Record<string, TourState>> | null | undefined;

/** A walk counts as seen when the account remembers it, or this browser did before the account could (until 2.24.113). */
export const seenTour = (account: Record_, tour: string, browser: string | null): boolean => !!account?.[tour] || !!browser;

/**
 * This browser's records the account lacks, to move there once. A finished walk stays finished: a browser's «closed»
 * never replaces the account's «done».
 */
export function browserOnly(account: Record_, browser: Record<string, string | null>): [string, TourState][] {
  return Object.entries(browser).flatMap(([tour, value]): [string, TourState][] => {
    if (!value) return [];
    const state: TourState = value === "done" ? "done" : "closed";
    return account?.[tour] === "done" || account?.[tour] === state ? [] : [[tour, state]];
  });
}

let pending: Promise<unknown> = Promise.resolve();
/** One save at a time: the account's record is written whole, so two saves at once could lose one of them. */
export function queueTourSave<T>(save: () => Promise<T>): Promise<T> {
  const next = pending.then(save, save);
  pending = next.catch(() => undefined);
  return next;
}
