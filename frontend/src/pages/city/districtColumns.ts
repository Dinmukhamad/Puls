/** A city's districts share one row; a longer list splits into two even rows. */
export const districtColumns = (count: number) => count <= 4 ? Math.max(1, count) : Math.ceil(count / 2);
