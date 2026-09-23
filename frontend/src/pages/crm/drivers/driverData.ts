/** Training copy of «Водители → Учётные записи водителей». Every participant practises on their own copy. */

export type DriverStatus = "Офлайн" | "Свободен" | "Занят" | "Нет данных";
export type DriverType = "Физлицо" | "СМЗ";
export type PhotoControl = "Нет данных" | "Пройден" | "Требуется";

export interface TrainingCar {
  status: string; brand: string; model: string; color: string; year: number; owner: string; plate: string;
  vin: string; body: string; sts: string; callsign: string; transmission: string; wrap: boolean; lightbox: boolean; fuel: string; tariffs: string[];
}
export interface DriverEvent { at: string; text: string }
export interface TrainingDriver {
  id: number; account: string; driverNo: number; lastName: string; firstName: string; middleName: string; phone: string; park: string;
  works: boolean; status: DriverStatus; type: DriverType; conditions: string; createdAt: string; updatedAt: string;
  license: string; licenseCountry: string; licenseIssued: string; licenseExpires: string; experienceSince: string;
  address: string; iin: string; balance: number; balanceLimit: number; cashLimit: boolean; photoControl: PhotoControl;
  rating: string; callsign: string; car: TrainingCar; orders: [number, number, number, number]; codes: number; history: DriverEvent[];
}

export const CAR_BRANDS: Record<string, string[]> = {
  Chevrolet: ["Cobalt", "Nexia", "Onix", "Malibu", "Spark"], Hyundai: ["Accent", "Elantra", "Sonata", "Creta"], Kia: ["Rio", "K5", "Cerato", "Sportage"],
  Toyota: ["Camry", "Corolla", "Prius", "RAV4"], Volkswagen: ["Polo", "Golf", "Passat"], Nissan: ["Cefiro", "Almera", "Qashqai"], Lada: ["Granta", "Vesta", "Largus"], Skoda: ["Rapid", "Octavia"],
};
export const CAR_COLORS = ["Белый", "Чёрный", "Серый", "Серебристый", "Синий", "Красный", "Жёлтый", "Зелёный", "Коричневый", "Бежевый"];
export const TARIFFS = ["Эконом", "Комфорт", "Комфорт+", "Курьер", "Экспресс", "Межгород", "Доставка"];
export const CONDITIONS = ["Новички_2026 (По умолчанию)", "Для всех 2%", "Самозанятые 3%", "Курьеры 1%"];
export const CASH_LIMIT = 500_000;

const car = (brand: string, model: string, color: string, year: number, plate: string, callsign: string, tariffs = ["Эконом", "Курьер", "Экспресс"]): TrainingCar =>
  ({ status: "Работает", brand, model, color, year, owner: "Другое", plate, vin: "", body: "", sts: "", callsign, transmission: "Автомат", wrap: false, lightbox: false, fuel: "Бензин", tariffs });

type Seed = [number, string, number, string, string, string, string, string, DriverType, DriverStatus, TrainingCar, [number, number, number, number], Partial<TrainingDriver>?];
const SEEDS: Seed[] = [
  [11046706, "ddcd8d21379f4694aa01eff73e5aadc1", 823544, "Байбосынов", "Самат", "Ерланович", "+77055607794", "QAZAQ Алматы", "Физлицо", "Занят", car("Nissan", "Cefiro", "Чёрный", 1995, "803ASD02", "altynbek_op"), [0, 0, 0, 0]],
  [11046705, "19550946448b4b21a86008657bcae625", 1006074, "Жумабеков", "Нурлан", "Кайратович", "+77012345601", "iTaxi Туркестан", "СМЗ", "Офлайн", car("Hyundai", "Accent", "Белый", 2019, "512KLM13", "512KLM13"), [3, 21, 88, 412], { address: "г. Туркестан, ул. Тауке хана, 15", iin: "880314300512" }],
  [11046704, "2a06d17a5b00451db3b7bf91b76423da", 1548803, "Сапарова", "Айгерим", "Маратовна", "+77471112233", "iTaxi Алматы", "Физлицо", "Нет данных", car("Kia", "Rio", "Серый", 2021, "771ABE02", "771ABE02"), [0, 0, 0, 0], { works: false }],
  [11046703, "830572280daf44c89f40c56e9409b373", 1548802, "Омаров", "Ерлан", "Сериккалиевич", "+77089876543", "iTaxi Алматы", "Физлицо", "Свободен", car("Toyota", "Camry", "Белый", 2018, "120BCD02", "120BCD02", ["Эконом", "Комфорт", "Комфорт+"]), [5, 34, 140, 960]],
  [11046702, "57673c362b6041f0a9c1bb6a4629f613", 603011, "Касымов", "Данияр", "Болатович", "+77773334455", "iTaxi Алматы", "Физлицо", "Офлайн", car("Chevrolet", "Cobalt", "Серебристый", 2022, "305CAT02", "305CAT02"), [0, 12, 57, 301]],
  [11046701, "390d464b21d847f2a0b26a7143b7aa5f", 1548801, "Ахметова", "Динара", "Асылбековна", "+77025556677", "Честный Алматы", "Физлицо", "Офлайн", car("Chevrolet", "Onix", "Красный", 2023, "418DKZ02", "418DKZ02"), [1, 9, 33, 75]],
  [11046700, "ce6fef80007049aea677a3b7dda0f8db", 1528022, "Тлеубаев", "Арман", "Сейтжанович", "+77057778899", "Аманат Уральск", "СМЗ", "Офлайн", car("Lada", "Vesta", "Синий", 2020, "221ARM07", "221ARM07"), [2, 17, 61, 544], { address: "г. Уральск, пр. Абая, 42", iin: "910705300118" }],
  [11046699, "18a831202ec44b9f97ae6ee49e6068aa", 1548800, "Мухамеджанов", "Руслан", "Айдарович", "+77019990011", "Ноль Такси Алматы", "Физлицо", "Занят", car("Hyundai", "Elantra", "Чёрный", 2020, "909RUS02", "909RUS02", ["Эконом", "Комфорт"]), [7, 40, 152, 1203]],
  [11046698, "4b790a4be2bb47e2b4c7f11b9e054473", 1548799, "Исмаилова", "Гульнара", "Ержановна", "+77478880022", "Jana Taxi Тараз", "СМЗ", "Занят", car("Kia", "K5", "Белый", 2022, "777JTZ08", "777JTZ08", ["Эконом", "Комфорт", "Комфорт+"]), [4, 26, 97, 388], { address: "г. Тараз, ул. Толе би, 7", iin: "930211400327" }],
  [11046697, "f569ca4a25b84d00ae1324d34f49b48e", 1532275, "Нурпеисов", "Бауыржан", "Талгатович", "+77086661133", "Tenge Taxi Астана", "Физлицо", "Занят", car("Skoda", "Rapid", "Серый", 2019, "045TNG01", "045TNG01"), [6, 31, 118, 877]],
  [11046696, "bfcb98ee71d54682be284538b31985fd", 1548798, "Абдрахманов", "Ильяс", "Муратович", "+77752224466", "EKI DONGELEK Алматы", "Физлицо", "Офлайн", car("Volkswagen", "Polo", "Белый", 2021, "632EKI02", "632EKI02"), [0, 3, 20, 44], { cashLimit: true }],
  [11046695, "06eb1317b88c437bb52896390123f621", 1547402, "Серикбаева", "Жанар", "Кенжебековна", "+77013337799", "iTaxi (Доставка) Алматы", "Физлицо", "Офлайн", car("Chevrolet", "Spark", "Жёлтый", 2020, "150DLV02", "150DLV02", ["Курьер", "Доставка"]), [0, 5, 22, 130]],
];

const iso = (minutesAgo: number) => new Date(Date.UTC(2026, 8, 23, 11, 0) - minutesAgo * 60000).toISOString();
export function seedDrivers(): TrainingDriver[] {
  return SEEDS.map(([id, account, driverNo, lastName, firstName, middleName, phone, park, type, status, carData, orders, extra], index) => ({
    id, account, driverNo, lastName, firstName, middleName, phone, park, works: true, status, type,
    conditions: type === "СМЗ" ? "Самозанятые 3%" : "Новички_2026 (По умолчанию)", createdAt: iso(60 * 24 * (index + 2)), updatedAt: iso(index * 4 + 1),
    license: `${["MR", "HM", "KZ", "AA"][index % 4]}${String(993753 - index * 48117).padStart(6, "0")}`, licenseCountry: "kaz",
    licenseIssued: `2025-${String(1 + index % 12).padStart(2, "0")}-05`, licenseExpires: `2035-${String(1 + index % 12).padStart(2, "0")}-04`, experienceSince: `${2010 + index % 12}-06-01`,
    address: "", iin: "", balance: [0, 1250, -50, 3400, 0, 870, 15, -30, 2200, 540, 0, 90][index], balanceLimit: -50, cashLimit: false,
    photoControl: index % 3 ? "Пройден" : "Нет данных", rating: index % 4 ? (4.6 + (index % 4) / 10).toFixed(2) : "Нет данных", callsign: carData.callsign,
    car: carData, orders, codes: 0, history: [{ at: iso(60 * 24 * (index + 2)), text: "Учётная запись создана" }], ...extra,
  }));
}

export const driverName = (d: Pick<TrainingDriver, "lastName" | "firstName">) => `${d.lastName} ${d.firstName}`;
export const carTitle = (c: Pick<TrainingCar, "brand" | "model">) => `${c.brand} ${c.model}`;

/** Accepts a plain query or a pasted link like …/contractors/<id>/details?… */
export function driverSearchQuery(raw: string) {
  const link = raw.match(/contractors\/([0-9a-f]{32})\/details/i) ?? raw.match(/driver-accounts\/(\d+)/);
  return (link ? link[1] : raw).trim().toLowerCase();
}
export function matchesDriver(d: TrainingDriver, raw: string) {
  const q = driverSearchQuery(raw);
  if (!q) return true;
  // Local numbers are often dictated with a leading 8 instead of +7.
  const digits = q.replace(/\D/g, "").replace(/^8(\d{10})$/, "7$1");
  const haystack = [driverName(d), `${d.firstName} ${d.lastName}`, d.middleName, d.account, String(d.id), String(d.driverNo), carTitle(d.car), d.car.plate, d.callsign, d.license].join(" ").toLowerCase();
  return haystack.includes(q) || (digits.length >= 4 && d.phone.replace(/\D/g, "").includes(digits));
}

const stamp = (d: TrainingDriver, text: string, now: string): TrainingDriver => ({ ...d, updatedAt: now, history: [{ at: now, text }, ...d.history] });

export function validateSmz(input: { address: string; iin: string }) {
  const errors: Partial<Record<"address" | "iin", string>> = {};
  if (input.address.trim().length < 5) errors.address = "Укажите адрес прописки водителя.";
  if (!/^\d{12}$/.test(input.iin.trim())) errors.iin = "ИИН состоит из 12 цифр.";
  return errors;
}
export function transferToSmz(d: TrainingDriver, input: { lastName: string; firstName: string; middleName: string; address: string; iin: string; conditions: string; balanceLimit: number }, now = new Date().toISOString()) {
  if (d.type === "СМЗ") throw new Error("Водитель уже работает как самозанятый.");
  if (Object.keys(validateSmz(input)).length) throw new Error("Проверьте адрес и ИИН.");
  return stamp({ ...d, ...input, address: input.address.trim(), iin: input.iin.trim(), type: "СМЗ" }, "Переведён в СМЗ. Водителю нужно выйти из аккаунта и снова войти в Яндекс Про.", now);
}
export function returnToIndividual(d: TrainingDriver, now = new Date().toISOString()) {
  return stamp({ ...d, type: "Физлицо", conditions: CONDITIONS[0] }, "Возвращён в физлицо (учебный сброс)", now);
}
export function setCashLimit(d: TrainingDriver, enabled: boolean, now = new Date().toISOString()) {
  if (d.cashLimit === enabled) return d;
  return stamp({ ...d, cashLimit: enabled }, enabled ? `Лимит ${CASH_LIMIT.toLocaleString("ru-RU")} ₸ включён: наличные заказы не поступают` : "Лимит отключён: наличные заказы поступают в обычном режиме", now);
}
export function validateCar(c: TrainingCar, requireCallsign = true) {
  const errors: Partial<Record<keyof TrainingCar, string>> = {};
  if (!c.brand) errors.brand = "Выберите марку.";
  if (!c.model) errors.model = "Выберите модель.";
  if (!c.color) errors.color = "Выберите цвет.";
  if (!c.year) errors.year = "Выберите год выпуска.";
  if (!/^[0-9A-Z]{5,9}$/.test(c.plate)) errors.plate = "Госномер — латинские буквы и цифры, например 803ASD02.";
  if (requireCallsign && c.plate && c.callsign !== c.plate) errors.callsign = "Скопируйте госномер в поле «Позывной».";
  return errors;
}
export function changeCar(d: TrainingDriver, next: TrainingCar, now = new Date().toISOString()) {
  const replaced = next.plate !== d.car.plate;
  if (Object.keys(validateCar(next, replaced)).length) throw new Error("Проверьте данные автомобиля.");
  return stamp({ ...d, car: next, callsign: next.callsign, photoControl: replaced ? "Требуется" : d.photoControl },
    replaced ? `Автомобиль изменён: ${carTitle(next)}, ${next.plate}. Требуется фотоконтроль автомобиля и техпаспорта.` : `Данные автомобиля ${next.plate} обновлены`, now);
}
export function sendCode(d: TrainingDriver, now = new Date().toISOString()) {
  return stamp({ ...d, codes: d.codes + 1 }, `Код подтверждения для Такси Про отправлен на ${d.phone}`, now);
}

export const storageKey = (userId?: number) => `crm-drivers:v1:${userId ?? "guest"}`;
export function loadDrivers(userId?: number): TrainingDriver[] {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(userId)) ?? "null");
    if (Array.isArray(saved) && saved.length && saved.every(d => typeof d?.id === "number" && d.car)) return saved;
  } catch { /* A broken or blocked store falls back to fresh data. */ }
  return seedDrivers();
}
export function saveDrivers(userId: number | undefined, drivers: TrainingDriver[]) {
  try { localStorage.setItem(storageKey(userId), JSON.stringify(drivers)); } catch { /* Practice still works for this visit. */ }
}
