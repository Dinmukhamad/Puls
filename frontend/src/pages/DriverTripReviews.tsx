import type { ShiftResult } from "../api/driverShift";

export function DriverTripReviews({ trips }: { trips: ShiftResult["trips"] }) {
  return <div className="stack">{trips?.map(trip => <details key={trip.id} className="dn-order-details"><summary>{trip.origin} → {trip.destination}{trip.navigation.score != null ? ` · ${trip.navigation.score}/100` : " · практика"}</summary><p>Маршрут {(trip.navigation.planned_distance / 1000).toFixed(2)} км · пройдено {((trip.navigation.actual_distance ?? 0) / 1000).toFixed(2)} км</p><p>Поездка {Math.floor((trip.navigation.trip_seconds ?? 0) / 60)} мин {(trip.navigation.trip_seconds ?? 0) % 60} с · ожидание {trip.navigation.wait_seconds ?? 0} с</p><p>{trip.payment === "cash" ? "Наличные" : "Карта"} · {trip.fare.toLocaleString("ru-RU")} ₸</p>{trip.navigation.result?.map(check => <p key={check.key}>{check.done ? "✓" : "○"} {check.title} · {check.done ? check.weight : 0}/{check.weight}</p>)}</details>)}</div>;
}
