/**
 * Training copy of CRM «Регистрация водителей». A registered driver becomes a fleet account: it shows
 * in «Учётные записи водителей» and in its park in «Диспетчерская». All people and documents are fictional.
 */
import type { RegisterInput } from "../../../api/dispatch";
import { CAR_BRANDS, type TrainingDriver } from "../drivers/driverData";
import { hex32, iinFor, phoneFor, pick } from "./fake";

export const REG_TYPES = ["Регистрация нового физического лица", "Регистрация нового СМЗ"] as const;
export const PROFESSIONS = ["Водитель", "Курьер на автомобиле", "Курьер на велосипеде/электровелосипеде или пеший курьер"] as const;
export type RegType = typeof REG_TYPES[number];
export type Profession = typeof PROFESSIONS[number];
export const LICENSE_COUNTRIES = ["Казахстан", "Кыргызстан", "Узбекистан", "Россия"];
export const REG_STATUSES = ["Зарегистрирован", "Черновик", "Ошибка"] as const;
export type RegStatus = typeof REG_STATUSES[number];
export const ACCOUNT_LIMIT = -50;

export interface RegCar { brand: string; model: string; color: string; year: number; plate: string }
export interface RegForm {
  type: RegType | ""; address: string; park: string; profession: Profession | "";
  lastName: string; firstName: string; middleName: string; phone: string; iin: string;
  license: string; licenseCountry: string; licenseIssued: string; licenseExpires: string; birthday: string; car: RegCar;
}
export interface Registration extends RegForm {
  id: number; status: RegStatus; result: "Через CRM" | "—"; operator: string; createdAt: string; lastOrder: string; error: string;
  account: string; driverId?: number;
}

export const emptyForm = (): RegForm => ({ type: "", address: "", park: "", profession: "", lastName: "", firstName: "", middleName: "", phone: "+7", iin: "", license: "", licenseCountry: "Казахстан", licenseIssued: "", licenseExpires: "", birthday: "", car: { brand: "", model: "", color: "", year: 0, plate: "" } });
/** Drivers and couriers on a car need a licence and the car; bicycle and walking couriers give a birthday. */
export const drives = (f: Pick<RegForm, "profession">) => f.profession === "Водитель" || f.profession === "Курьер на автомобиле";
export const walks = (f: Pick<RegForm, "profession">) => f.profession === PROFESSIONS[2];
export const phoneDigits = (raw: string) => raw.replace(/\D/g, "").replace(/^8(\d{10})$/, "7$1");
export const normalizePhone = (raw: string) => { const digits = phoneDigits(raw); return digits.length === 11 && digits.startsWith("7") ? `+${digits}` : raw.trim(); };

/** Checks the IIN the way the operator can: 12 digits, a real birth date inside, the century digit. */
export function iinProblem(iin: string, birthday = "") {
  if (!/^\d{12}$/.test(iin)) return "ИИН — 12 цифр.";
  const [yy, mm, dd, century] = [iin.slice(0, 2), iin.slice(2, 4), iin.slice(4, 6), Number(iin[6])];
  if (century < 1 || century > 6) return "Седьмая цифра ИИН — век и пол, от 1 до 6.";
  const year = (century <= 2 ? 1800 : century <= 4 ? 1900 : 2000) + Number(yy), date = `${year}-${mm}-${dd}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return "Первые 6 цифр ИИН — дата рождения ГГММДД.";
  if (birthday && birthday !== date) return "Дата рождения не совпадает с ИИН.";
  return null;
}
const age = (birthday: string, today: string) => { const [y, m, d] = birthday.split("-").map(Number), [ty, tm, td] = today.split("-").map(Number); return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0); };
const iinBirthday = (iin: string) => { const century = Number(iin[6]); return `${(century <= 2 ? 1800 : century <= 4 ? 1900 : 2000) + Number(iin.slice(0, 2))}-${iin.slice(2, 4)}-${iin.slice(4, 6)}`; };

export type RegErrors = Partial<Record<"type" | "address" | "park" | "profession" | "lastName" | "firstName" | "phone" | "iin" | "license" | "licenseIssued" | "licenseExpires" | "birthday" | "brand" | "model" | "color" | "year" | "plate", string>>;
/** Everything «Сохранить» needs; `today` is YYYY-MM-DD. */
export function regErrors(f: RegForm, today: string): RegErrors {
  const e: RegErrors = {};
  if (!f.type) e.type = "Выберите тип сотрудничества.";
  if (f.type === "Регистрация нового СМЗ" && f.address.trim().length < 5) e.address = "Укажите адрес прописки.";
  if (!f.park) e.park = "Выберите парк.";
  if (!f.profession) e.profession = "Выберите профессию.";
  if (f.lastName.trim().length < 2) e.lastName = "Укажите фамилию.";
  if (f.firstName.trim().length < 2) e.firstName = "Укажите имя.";
  if (!/^\+77\d{9}$/.test(normalizePhone(f.phone))) e.phone = "Номер телефона: +7 и 10 цифр, например +77001234567.";
  const iin = iinProblem(f.iin.trim(), walks(f) ? f.birthday : "");
  if (iin) e.iin = iin;
  else if (age(iinBirthday(f.iin.trim()), today) < 18) e.iin = "Водителю или курьеру должно быть 18 лет.";
  if (walks(f) && !f.birthday) e.birthday = "Укажите дату рождения.";
  if (drives(f)) {
    if (!/^[A-Z]{2}\d{6}$/.test(f.license.trim().toUpperCase())) e.license = "Номер В/У — 2 латинские буквы и 6 цифр, например AN898706.";
    if (!f.licenseIssued) e.licenseIssued = "Укажите дату выдачи В/У.";
    else if (f.licenseIssued > today) e.licenseIssued = "Дата выдачи не может быть в будущем.";
    if (!f.licenseExpires) e.licenseExpires = "Укажите, до какого числа действует В/У.";
    else if (f.licenseExpires <= today) e.licenseExpires = "Срок действия В/У истёк — такого водителя не регистрируют.";
    else if (f.licenseIssued && f.licenseExpires <= f.licenseIssued) e.licenseExpires = "Дата окончания позже даты выдачи.";
    if (!f.car.brand) e.brand = "Выберите марку.";
    if (!f.car.model) e.model = "Выберите модель.";
    if (!f.car.color) e.color = "Выберите цвет.";
    if (!f.car.year) e.year = "Выберите год выпуска.";
    if (!/^[0-9A-Z]{5,9}$/.test(f.car.plate)) e.plate = "Госномер — латинские буквы и цифры, например 803ASD02.";
  }
  return e;
}
/** A draft needs only the type and a way to find it again. */
export const draftProblem = (f: RegForm) => !f.type ? "Выберите тип сотрудничества." : !f.lastName.trim() && phoneDigits(f.phone).length < 11 ? "Для черновика укажите фамилию или номер телефона." : null;

/** «Проверить водителя» looks for the same phone, IIN or licence among existing drivers. */
export const checkKey = (f: RegForm) => [phoneDigits(f.phone), f.iin.trim(), drives(f) ? f.license.trim().toUpperCase() : ""].join("|");
export function checkDriver(f: RegForm, drivers: TrainingDriver[], registrations: Registration[]) {
  const phone = phoneDigits(f.phone), iin = f.iin.trim(), license = f.license.trim().toUpperCase();
  if (phone.length !== 11 || iin.length !== 12) return { ok: false, key: checkKey(f), text: "Для проверки заполните номер телефона и ИИН." };
  const same = drivers.find(d => phoneDigits(d.phone) === phone || (d.iin && d.iin === iin) || (drives(f) && license && d.license === license));
  if (same) return { ok: false, key: checkKey(f), text: `Водитель уже есть: ${same.lastName} ${same.firstName}, парк «${same.park}», аккаунт ${same.account}. Повторно не регистрируем — проверьте парк и условия в его учётной записи.` };
  const pending = registrations.find(r => r.status === "Зарегистрирован" && (phoneDigits(r.phone) === phone || r.iin === iin));
  if (pending) return { ok: false, key: checkKey(f), text: `Этого водителя уже зарегистрировали: заявка №${pending.id}, ${pending.operator}.` };
  return { ok: true, key: checkKey(f), text: "Водитель не найден в базе — можно регистрировать." };
}

/** What «Сохранить» sends; `park` is the park's id in «Диспетчерская». */
export function registerInput(f: RegForm, park: string): RegisterInput {
  const car = drives(f) ? { brand: f.car.brand, model: f.car.model, color: f.car.color, year: f.car.year, plate: f.car.plate.trim().toUpperCase() } : null;
  return {
    park, profession: f.profession, self_employed: f.type === "Регистрация нового СМЗ", last_name: f.lastName.trim(), first_name: f.firstName.trim(), middle_name: f.middleName.trim(),
    phone: normalizePhone(f.phone), iin: f.iin.trim(), address: f.address.trim(), license: drives(f) ? f.license.trim().toUpperCase() : "",
    license_issued: drives(f) ? f.licenseIssued : "", license_expires: drives(f) ? f.licenseExpires : "", car,
  };
}
/** The registration as the list keeps it, with the fleet account the server created. */
export function registered(f: RegForm, id: number, operator: string, now: string, driver: Pick<TrainingDriver, "account" | "id">): Registration {
  return { ...f, phone: normalizePhone(f.phone), id, status: "Зарегистрирован", result: "Через CRM", operator, createdAt: now, lastOrder: "", error: "", account: driver.account, driverId: driver.id };
}

/** Fictional earlier registrations of the park team. */
export function seedRegistrations(): Registration[] {
  const people: [string, string, string, string, Profession, boolean][] = [
    ["Есенов", "Диас", "Ноль Такси Алматы", "1995-03-12", "Водитель", false], ["Надыров", "Азиз", "Jana Taxi Тараз", "1990-11-02", "Водитель", false],
    ["Ахвердиев", "Вали", "Честный Алматы", "1988-07-21", "Водитель", true], ["Шарипова", "Лятифа", "Достойный Шымкент", "1993-01-30", "Водитель", false],
    ["Касенов", "Алмас", "iTaxi курьер Алматы", "2001-05-17", PROFESSIONS[2], false], ["Калиев", "Болат", "Ноль Такси Алматы", "1985-09-09", "Водитель", false],
    ["Жанибеков", "Ернар", "iTaxi Алматы", "1999-12-04", "Курьер на автомобиле", true], ["Муратова", "Салтанат", "Global Астана", "1997-04-26", "Водитель", false],
    ["Орынбаев", "Талгат", "Tenge Taxi Астана", "1991-08-15", "Водитель", false], ["Абенова", "Малика", "EKI DONGELEK Алматы", "2000-02-11", PROFESSIONS[2], false],
  ];
  const brands = Object.keys(CAR_BRANDS);
  return people.map(([lastName, firstName, park, birth, profession, smz], i): Registration => {
    const id = 7_540 + i * 9, woman = /а$/.test(lastName), createdAt = new Date(Date.UTC(2026, 8, 28 - i * 2, 9 + i, 12)).toISOString();
    const brand = brands[pick(`reg-car-${i}`, brands.length)], car = profession === PROFESSIONS[2] ? { brand: "", model: "", color: "", year: 0, plate: "" }
      : { brand, model: CAR_BRANDS[brand][0], color: ["Белый", "Серый", "Чёрный"][i % 3], year: 2016 + (i % 8), plate: `${300 + i * 37}${["AB", "KZ", "TR", "SM"][i % 4]}0${2 + (i % 7)}` };
    const status: RegStatus = i === 6 ? "Черновик" : i === 8 ? "Ошибка" : "Зарегистрирован";
    return {
      type: smz ? "Регистрация нового СМЗ" : "Регистрация нового физического лица", address: smz ? `г. Алматы, ул. Учебная, ${10 + i}` : "", park, profession, lastName, firstName, middleName: "",
      phone: phoneFor(`reg-${i}`), iin: iinFor(birth, `reg-${i}`, woman), license: profession === PROFESSIONS[2] ? "" : `${["DQ", "AN", "YX", "KZ"][i % 4]}${String(961305 - i * 40417).padStart(6, "0")}`,
      licenseCountry: "Казахстан", licenseIssued: profession === PROFESSIONS[2] ? "" : `20${18 + (i % 7)}-0${1 + (i % 9)}-15`, licenseExpires: profession === PROFESSIONS[2] ? "" : `20${28 + (i % 7)}-0${1 + (i % 9)}-14`,
      birthday: profession === PROFESSIONS[2] ? birth : "", car, id, status, result: status === "Зарегистрирован" ? "Через CRM" : "—", operator: i % 3 ? "Смагулова Инкар" : "Оператор Учебный", createdAt,
      lastOrder: status === "Зарегистрирован" && i % 2 ? new Date(Date.UTC(2026, 8, 28 - i, 18, 16)).toISOString() : "",
      error: status === "Ошибка" ? "Номер телефона уже используется другим водителем парка «Ноль Такси Алматы»" : "", account: status === "Зарегистрирован" ? hex32(`seed-registration-${i}`) : "",
    };
  });
}
