/**
 * CRM «Водители → Учётные записи водителей» over the training fleet: the accounts are the same ones
 * «Диспетчерская» shows, and every change goes to the server, so both work sites always agree.
 */
import type { CrmCarInput, FleetDriver, FleetState } from "../../../api/dispatch";

export type DriverStatus = "Офлайн" | "Свободен" | "Занят" | "Нет данных";
export type DriverType = "Физлицо" | "СМЗ";
export type PhotoControl = "Нет данных" | "Пройден" | "Требуется";

export interface TrainingCar {
  status: string; brand: string; model: string; color: string; year: number; owner: string; plate: string;
  vin: string; body: string; sts: string; callsign: string; transmission: string; wrap: boolean; lightbox: boolean; fuel: string; tariffs: string[];
}
export interface DriverEvent { at: string; text: string }
export interface TrainingDriver {
  /** The CRM number; `account` is the contractor ID from the dispatch link. */
  id: number; account: string; driverNo: number; lastName: string; firstName: string; middleName: string; phone: string;
  /** «iTaxi Алматы»: the park as CRM names it; `parkId` and `parkLink` are its ids in the dispatch and in the link. */
  park: string; parkId: string; parkLink: string; city: string; profession: string; provider: string;
  works: boolean; status: DriverStatus; type: DriverType; conditions: string; createdAt: string; updatedAt: string;
  license: string; licenseCountry: string; licenseIssued: string; licenseExpires: string; experienceSince: string;
  address: string; iin: string; balance: number; balanceLimit: number; cashLimit: boolean; photoControl: PhotoControl;
  rating: string; callsign: string; car: TrainingCar | null; orders: [number, number, number, number]; codes: number; history: DriverEvent[];
}

export const CAR_BRANDS: Record<string, string[]> = {
  Chevrolet: ["Cobalt", "Nexia", "Onix", "Malibu", "Spark"], Hyundai: ["Accent", "Elantra", "Sonata", "Creta"], Kia: ["Rio", "K5", "Cerato", "Sportage"],
  Toyota: ["Camry", "Corolla", "Prius", "RAV4"], Volkswagen: ["Polo", "Golf", "Passat"], Nissan: ["Cefiro", "Almera", "Qashqai"], Lada: ["Granta", "Vesta", "Largus"], Skoda: ["Rapid", "Octavia"],
};
export const CAR_COLORS = ["Белый", "Чёрный", "Серый", "Серебристый", "Синий", "Красный", "Жёлтый", "Зелёный", "Коричневый", "Бежевый"];
export const TRANSMISSIONS = ["Автоматическая", "Механическая", "Робот", "Вариатор"];
export const FUELS = ["Бензин", "Газ", "Гибрид", "Электро", "Дизель"];
export const CASH_LIMIT = 500_000;
export const INDIVIDUAL = "Физическое лицо";

const STATUS: Record<FleetDriver["status"], DriverStatus> = { free: "Свободен", order: "Занят", busy: "Занят", offline: "Офлайн" };
export const parkLabel = (park: { name: string; city: string }) => `${park.name} ${park.city}`;

/** The fleet accounts as CRM shows them, newest first like the CRM list. */
export function fromFleet(state: Pick<FleetState, "drivers" | "parks">): TrainingDriver[] {
  const parks = new Map(state.parks.map(p => [p.id, p]));
  return state.drivers.map((d): TrainingDriver => {
    const park = parks.get(d.park), car = d.car;
    return {
      id: d.crm_id, account: d.id, driverNo: d.driver_no, lastName: d.last_name, firstName: d.first_name, middleName: d.middle_name, phone: d.phone,
      park: park ? parkLabel(park) : d.park, parkId: d.park, parkLink: park?.park_id ?? "", city: park?.city ?? "", profession: d.profession, provider: d.provider,
      works: d.works, status: d.works ? STATUS[d.status] : "Нет данных", type: d.employment === INDIVIDUAL ? "Физлицо" : "СМЗ", conditions: d.rule,
      createdAt: d.created, updatedAt: d.updated_at, license: d.license, licenseCountry: d.license_country, licenseIssued: d.license_issued, licenseExpires: d.license_expires,
      experienceSince: d.experience_since, address: d.address, iin: d.iin, balance: d.balance, balanceLimit: d.account_limit, cashLimit: d.cash_limit, photoControl: d.photo_control,
      rating: d.rating === null ? "Нет данных" : d.rating.toFixed(2), callsign: car?.callsign ?? "",
      car: car && { status: car.status ?? "Работает", brand: car.brand, model: car.model, color: car.color, year: car.year, owner: car.owner ?? "Водитель", plate: car.plate,
        vin: car.vin, body: car.body ?? "", sts: car.sts ?? "", callsign: car.callsign, transmission: car.transmission, wrap: car.wrap, lightbox: car.lightbox, fuel: car.fuel, tariffs: car.tariffs },
      orders: d.stats, codes: d.codes, history: d.history,
    };
  }).sort((a, b) => b.id - a.id);
}

export const driverName = (d: Pick<TrainingDriver, "lastName" | "firstName">) => `${d.lastName} ${d.firstName}`;
export const carTitle = (c: Pick<TrainingCar, "brand" | "model">) => `${c.brand} ${c.model}`;
/** The link to the account in «Диспетчерская»: the operator copies it into appeals, CRM search reads the ID from it. */
export const fleetLink = (d: Pick<TrainingDriver, "account" | "parkLink">) => `https://fleet.yandex.kz/contractors/${d.account}/details?park_id=${d.parkLink}&lang=ru`;
/** Cabinet times are local and come without a zone: they are shown as they are. */
export function fleetDate(value: string) {
  if (!value) return "—";
  const [date, clock = ""] = value.split("T"), day = date.split("-").reverse().join(".");
  return clock ? `${day}, ${clock.slice(0, 5)}` : day;
}

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
  const haystack = [driverName(d), `${d.firstName} ${d.lastName}`, d.middleName, d.account, String(d.id), String(d.driverNo), d.car ? carTitle(d.car) : "", d.car?.plate ?? "", d.callsign, d.license].join(" ").toLowerCase();
  return haystack.includes(q) || (digits.length >= 4 && d.phone.replace(/\D/g, "").includes(digits));
}

export function validateSmz(input: { address: string; iin: string }) {
  const errors: Partial<Record<"address" | "iin", string>> = {};
  if (input.address.trim().length < 5) errors.address = "Укажите адрес прописки водителя.";
  if (!/^\d{12}$/.test(input.iin.trim())) errors.iin = "ИИН состоит из 12 цифр.";
  return errors;
}
export function validateCar(c: TrainingCar, requireCallsign = true) {
  const errors: Partial<Record<keyof TrainingCar, string>> = {};
  if (!c.brand) errors.brand = "Выберите марку.";
  if (!c.model) errors.model = "Выберите модель.";
  if (!c.color) errors.color = "Выберите цвет.";
  if (!c.year) errors.year = "Выберите год выпуска.";
  if (!/^[0-9A-Z]{5,9}$/.test(c.plate)) errors.plate = "Госномер — латинские буквы и цифры, например 803ASD02.";
  if (requireCallsign && c.plate && c.callsign !== c.plate) errors.callsign = "Скопируйте госномер в поле «Позывной».";
  if (!c.tariffs.length) errors.tariffs = "Отметьте хотя бы один тариф.";
  return errors;
}
/** A new plate is a new car: its plate goes into the callsign. */
export const replacesCar = (d: Pick<TrainingDriver, "car">, next: Pick<TrainingCar, "plate">) => !d.car || next.plate !== d.car.plate;
export function carInput(c: TrainingCar): CrmCarInput {
  const { status, brand, model, color, year, owner, plate, vin, body, sts, callsign, transmission, wrap, lightbox, fuel, tariffs } = c;
  return { status, brand, model, color, year, owner, plate, vin, body, sts, callsign, transmission, wrap, lightbox, fuel, tariffs };
}
