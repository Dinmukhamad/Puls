export interface PrizeLike {
  title: string;
  coins: number;
  weight: number;
}

export interface PrizeSticker {
  icon: string;
  color: string;
}

/** The empty sector keeps a friendly sticker: it is a "next time", not a loss. */
const NO_PRIZE: PrizeSticker = { icon: "🍀", color: "#3fa46a" };
/** From the smallest reward to the largest one. */
const LADDER: PrizeSticker[] = [
  { icon: "🪙", color: "#f0a23a" },
  { icon: "💰", color: "#d9a520" },
  { icon: "🎁", color: "#e86aa6" },
  { icon: "🏆", color: "#5b8def" },
  { icon: "💎", color: "#35b6a6" },
];

/**
 * A sticker for a wheel prize. Rewards are ranked among the prizes of the same
 * wheel, so the biggest prize always gets the brightest sticker and equal
 * rewards share one.
 */
export function prizeSticker(prize: Pick<PrizeLike, "coins">, prizes: readonly Pick<PrizeLike, "coins">[]): PrizeSticker {
  if (!(prize.coins > 0)) return NO_PRIZE;
  const amounts = [...new Set(prizes.map((item) => item.coins).filter((value) => value > 0))].sort((a, b) => a - b);
  if (amounts.length <= 1) return LADDER[2];
  const rank = Math.max(0, amounts.indexOf(prize.coins));
  return LADDER[Math.round((rank / (amounts.length - 1)) * (LADDER.length - 1))];
}

/** Chance of every prize in percent; an all-zero wheel has no chances to show. */
export function prizeChances(prizes: readonly Pick<PrizeLike, "weight">[]): number[] {
  const total = prizes.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  return prizes.map((item) => total > 0 ? (Math.max(0, item.weight) / total) * 100 : 0);
}
