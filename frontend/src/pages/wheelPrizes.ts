export interface PrizeLike {
  title: string;
  coins: number;
  weight: number;
}

/** The drawn stickers (PrizeArt), from an empty chest to the biggest prize. */
export type StickerKind = "clover" | "coin" | "stack" | "pouch" | "gift" | "crown" | "gem";

export interface PrizeSticker {
  kind: StickerKind;
  /** The same prize as one character, for places that cannot draw (notifications, plain text). */
  icon: string;
  color: string;
}

/** The empty sector keeps a friendly sticker: it is a "next time", not a loss. */
const NO_PRIZE: PrizeSticker = { kind: "clover", icon: "🍀", color: "#3fa46a" };
/** From the smallest reward to the largest one: every step is a different drawing and colour. */
const LADDER: PrizeSticker[] = [
  { kind: "coin", icon: "🪙", color: "#f0a23a" },
  { kind: "stack", icon: "🪙", color: "#e3862c" },
  { kind: "pouch", icon: "💰", color: "#b9773c" },
  { kind: "gift", icon: "🎁", color: "#e86aa6" },
  { kind: "crown", icon: "👑", color: "#8f6cf0" },
  { kind: "gem", icon: "💎", color: "#2fb8c9" },
];
/** When every prize pays the same, the amount itself picks the step: [at least, step]. */
const SCALE: [number, number][] = [[500, 5], [100, 4], [50, 3], [20, 2], [5, 1], [0, 0]];

/**
 * A sticker for a chest prize. Rewards are ranked among the prizes of the same
 * chest, so the biggest prize always gets the brightest sticker, different
 * rewards get different stickers and equal rewards share one.
 */
export function prizeSticker(prize: Pick<PrizeLike, "coins">, prizes: readonly Pick<PrizeLike, "coins">[]): PrizeSticker {
  if (!(prize.coins > 0)) return NO_PRIZE;
  const amounts = [...new Set(prizes.map((item) => item.coins).filter((value) => value > 0))].sort((a, b) => a - b);
  if (amounts.length <= 1) return LADDER[SCALE.find(([least]) => prize.coins >= least)?.[1] ?? 0];
  const rank = Math.max(0, amounts.indexOf(prize.coins));
  return LADDER[Math.round((rank / (amounts.length - 1)) * (LADDER.length - 1))];
}

/** Chance of every prize in percent; an all-zero wheel has no chances to show. */
export function prizeChances(prizes: readonly Pick<PrizeLike, "weight">[]): number[] {
  const total = prizes.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  return prizes.map((item) => total > 0 ? (Math.max(0, item.weight) / total) * 100 : 0);
}

/**
 * What a prize's name promises: «5 коинов» → 5, «В этот раз без награды» → 0,
 * a name without an amount → null (nothing to check).
 */
export function promisedCoins(title: string): number | null {
  const text = title.toLowerCase().replace(/[  ]/g, " ");
  if (/без\s+(награды|коин|приза|выигрыша)|пустой/.test(text)) return 0;
  const match = text.match(/(\d[\d ]*)\s*(коин|монет)/);
  return match ? Number(match[1].replace(/ /g, "")) : null;
}

/** The prizes whose name and reward disagree: the operator is told one thing and gets another. */
export function mismatchedPrizes(prizes: readonly Pick<PrizeLike, "title" | "coins">[]): number[] {
  return prizes.flatMap((item, index) => {
    const promised = promisedCoins(item.title);
    return promised !== null && promised !== item.coins ? [index] : [];
  });
}

/** Coins an operator gets from the free chests alone in a month of 22 working days. */
export function monthlyChestCoins(dailySpins: number, prizes: readonly Pick<PrizeLike, "coins" | "weight">[]): number {
  const total = prizes.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  if (!total) return 0;
  const average = prizes.reduce((sum, item) => sum + Math.max(0, item.weight) * Math.max(0, item.coins), 0) / total;
  return Math.round(Math.max(0, dailySpins) * average * 22);
}
