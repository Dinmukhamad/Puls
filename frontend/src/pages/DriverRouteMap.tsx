import { useEffect, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { RoadRoute, RoutePoint } from "../api/driverNavigation";
import type { GeoPoint } from "../utils/driverLocation";

const latlng = (p: GeoPoint): L.LatLngTuple => [p.latitude, p.longitude];
const pin = (label: string) => L.divIcon({ className: "dn-map-pin", html: `<span>${label}</span>`, iconSize: [34, 42], iconAnchor: [17, 42] });
const carIcon = L.divIcon({ className: "dn-map-car", html: '<span aria-hidden="true">▲</span>', iconSize: [38, 38], iconAnchor: [19, 19] });
export function DriverRouteMap({ current, stale, pickup, destination, route, picking, onCenter, focusKey, active, sheetHeight }: {
  current: GeoPoint | null; stale: boolean; pickup?: RoutePoint | null; destination?: RoutePoint | null; route?: RoadRoute | null;
  picking?: "А" | "Б" | null; onCenter: (point: GeoPoint) => void; focusKey: string; active: boolean; sheetHeight: number;
}) {
  const element = useRef<HTMLDivElement>(null), map = useRef<L.Map>(), layers = useRef<L.LayerGroup>(), car = useRef<L.Marker>();
  const [following, follow] = useState(true), [ready, setReady] = useState(false), [tileError, setTileError] = useState(false);
  const latest = useRef({ onCenter, current }); latest.current = { onCenter, current };
  function focus(point: GeoPoint) {
    const m = map.current; if (!m) return;
    const pixel = m.project(latlng(point), m.getZoom());
    if (m.getSize().x < 900) pixel.y += m.getSize().y * sheetHeight / 200;
    m.panTo(m.unproject(pixel, m.getZoom()), { animate: true, duration: .8 });
  }
  useEffect(() => {
    if (!element.current) return;
    const m = L.map(element.current, { center: latlng(current ?? pickup ?? { latitude: 43.2389, longitude: 76.8897 }), zoom: 15, zoomControl: false, minZoom: 3, maxZoom: 19, attributionControl: false });
    map.current = m;
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, keepBuffer: 1, updateWhenIdle: true, referrerPolicy: "strict-origin-when-cross-origin" }).on("tileerror", () => setTileError(true)).addTo(m);
    layers.current = L.layerGroup().addTo(m);
    m.on("dragstart zoomstart", e => { if (e.type === "dragstart") follow(false); });
    m.on("moveend", () => { const p = m.getCenter().wrap(); latest.current.onCenter({ latitude: p.lat, longitude: p.lng }); });
    const observer = new ResizeObserver(() => m.invalidateSize({ pan: false })); observer.observe(element.current);
    setReady(true);
    return () => { observer.disconnect(); m.remove(); map.current = undefined; car.current = undefined; layers.current = undefined; };
  }, []);
  useEffect(() => {
    const m = map.current, group = layers.current; if (!m || !group) return;
    group.clearLayers();
    if (route) L.polyline(route.coordinates.map(([lng, lat]) => [lat, lng]), { color: "#5790ff", weight: 6, opacity: .95 }).addTo(group);
    for (const [p, label] of [[pickup, "А"], [destination, "Б"]] as const) if (p) {
      const caption = document.createElement("span"); caption.textContent = p.label;
      L.marker(latlng(p), { icon: pin(label), title: `${label}: ${p.label}`, keyboard: true }).bindTooltip(caption).addTo(group);
    }
  }, [ready, pickup?.latitude, pickup?.longitude, pickup?.label, destination?.latitude, destination?.longitude, destination?.label, route]);
  function fit() {
    const m = map.current; if (!m || !route) return;
    const box = L.latLngBounds(route.coordinates.map(([lng, lat]) => [lat, lng]));
    if (pickup) box.extend(latlng(pickup)); if (destination) box.extend(latlng(destination));
    m.fitBounds(box, { paddingTopLeft: [35, 55], paddingBottomRight: [40, m.getSize().y * .3], maxZoom: 17 }); follow(false);
  }
  useEffect(() => { if (route && !active) fit(); else if (active) { map.current?.setZoom(16); follow(true); } }, [focusKey, ready, active]);
  useEffect(() => {
    const m = map.current; if (!m) return;
    if (!current) { car.current?.remove(); car.current = undefined; return; }
    if (!car.current) car.current = L.marker(latlng(current), { icon: carIcon, zIndexOffset: 1000, title: "Положение автомобиля" }).addTo(m);
    car.current.setLatLng(latlng(current)).setOpacity(stale ? .45 : 1);
    if (following && !picking) focus(current);
  }, [ready, current?.latitude, current?.longitude, stale, following, picking, sheetHeight]);
  useEffect(() => { if (picking) { follow(false); const p = map.current?.getCenter().wrap(); if (p) onCenter({ latitude: p.lat, longitude: p.lng }); } }, [picking]);
  return <><div className="dn-map" ref={element} aria-label="Карта маршрута" />
    {picking && <span className="dn-center-pin" aria-label={`Выбор точки ${picking}`}>{picking}</span>}
    <div className="dn-map-controls"><button type="button" aria-label="Увеличить карту" onClick={() => map.current?.zoomIn()}>+</button><button type="button" aria-label="Уменьшить карту" onClick={() => map.current?.zoomOut()}>−</button>{route && <button type="button" onClick={fit}>Весь маршрут</button>}<button type="button" aria-label="Вернуться к моей позиции" disabled={!current} onClick={() => { follow(true); if (current) focus(current); }}>{following ? "◎" : "Вернуться к моей позиции"}</button></div>
    <div className="dn-attribution" style={{ bottom: `calc(${Math.min(sheetHeight, 88)}% + 5px)` }}><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a> · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">Исправить карту</a></div>
    {tileError && <p className="dn-map-note">Часть карты не загрузилась. Маршрут и положение остаются на экране.</p>}
  </>;
}
