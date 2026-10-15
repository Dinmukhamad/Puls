/** A city's districts (up to five) share one row of equal cards; a longer legacy list splits into two even rows. */
export const districtColumns = (count: number) => count <= 5 ? Math.max(1, count) : Math.ceil(count / 2);
