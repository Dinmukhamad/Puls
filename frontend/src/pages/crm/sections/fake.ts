/** Deterministic fictional identifiers for the training CRM sections: the same seed gives the same value. */

function hash(seed: string, salt: number) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  return (h ^ (h >>> 13)) >>> 0;
}
/** A 32-character hex ID like a Яндекс contractor ID. */
export const hex32 = (seed: string) => [0, 1, 2, 3].map(i => hash(seed, i).toString(16).padStart(8, "0")).join("");
/** A number from 0 to max-1 picked by the seed. */
export const pick = (seed: string, max: number) => hash(seed, 7) % max;
/** A Kazakh-style IIN: birth date YYMMDD, century and sex digit, then fictional digits. */
export function iinFor(birth: string, seed: string, woman = false) {
  const [y, m, d] = birth.split("-");
  const century = Number(y) >= 2000 ? (woman ? 6 : 5) : (woman ? 4 : 3);
  return `${y.slice(2)}${m}${d}${century}${String(hash(seed, 3) % 100000).padStart(5, "0")}`;
}
/** A fictional mobile number in the +7 700 format. */
export const phoneFor = (seed: string) => `+7700${String(hash(seed, 5) % 10_000_000).padStart(7, "0")}`;
