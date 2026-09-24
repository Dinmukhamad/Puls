import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { RoadRoute, RoutePoint } from "../api/driverNavigation";
import type { GeoPoint } from "../utils/driverLocation";
import { bearing, MAP_STYLES, routeLayers, tuneStyle, type MapTheme } from "./driverMapStyle";

const lngLat = (p: GeoPoint): [number, number] => [p.longitude, p.latitude];
const ALMATY = { latitude: 43.2389, longitude: 76.8897 };

function pinElement(label: string, caption: string) {
  const element = document.createElement("div");
  element.className = "dn-map-pin"; element.title = `${label}: ${caption}`;
  const badge = document.createElement("span"); badge.textContent = label; element.append(badge);
  return element;
}
function carElement() {
  const element = document.createElement("div");
  element.className = "dn-map-car";
  element.innerHTML = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 4 33 34 20 27 7 34z" /></svg>';
  return element;
}

/** Тема карты следует теме смены: светлая смена — светлая карта. */
function themeOf(element: HTMLElement | null): MapTheme {
  return element?.closest(".ds-light") ? "light" : "dark";
}

export function DriverRouteMap({ current, stale, pickup, destination, route, picking, onCenter, focusKey, active, sheetHeight }: {
  current: GeoPoint | null; stale: boolean; pickup?: RoutePoint | null; destination?: RoutePoint | null; route?: RoadRoute | null;
  picking?: "А" | "Б" | null; onCenter: (point: GeoPoint) => void; focusKey: string; active: boolean; sheetHeight: number;
}) {
  const element = useRef<HTMLDivElement>(null), map = useRef<maplibregl.Map>(), car = useRef<maplibregl.Marker>(), pins = useRef<maplibregl.Marker[]>([]);
  const heading = useRef(0), previous = useRef<GeoPoint | null>(null), theme = useRef<MapTheme>("dark");
  const [following, follow] = useState(true), [ready, setReady] = useState(false), [styled, setStyled] = useState(0);
  const [tileError, setTileError] = useState(false), [unsupported, setUnsupported] = useState(false), [rotation, setRotation] = useState(0);
  const latest = useRef({ onCenter, route, active }); latest.current = { onCenter, route, active };

  /** Сдвиг центра вверх, чтобы машина была видна над открытой панелью заказа. */
  const offset = (m: maplibregl.Map): [number, number] => m.getContainer().clientWidth < 900 ? [0, -m.getContainer().clientHeight * sheetHeight / 200] : [0, 0];
  function focus(point: GeoPoint) {
    const m = map.current; if (!m) return;
    const drive = latest.current.active;
    m.easeTo({ center: lngLat(point), offset: offset(m), duration: 800, ...(drive ? { bearing: heading.current, pitch: 55, zoom: Math.max(m.getZoom(), 16.5) } : { pitch: 0 }) });
  }

  // Карта создаётся один раз; стиль меняется вместе с темой смены.
  useEffect(() => {
    if (!element.current) return;
    theme.current = themeOf(element.current);
    let m: maplibregl.Map;
    try {
      m = new maplibregl.Map({ container: element.current, style: MAP_STYLES[theme.current], center: lngLat(current ?? pickup ?? ALMATY), zoom: 15, minZoom: 3, maxZoom: 19, attributionControl: false, pitchWithRotate: true, fadeDuration: 150 });
    } catch { setUnsupported(true); return; }
    map.current = m;
    m.on("style.load", () => {
      tuneStyle(m, theme.current);
      if (!m.getSource("dx-route")) m.addSource("dx-route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      const before = m.getStyle().layers?.find(layer => layer.type === "symbol")?.id;
      for (const layer of routeLayers(theme.current)) if (!m.getLayer(layer.id)) m.addLayer(layer as maplibregl.AddLayerObject, before);
      setStyled(n => n + 1);
    });
    m.on("error", event => { if ((event as { sourceId?: string }).sourceId || /tile|style/i.test(String(event.error?.message))) setTileError(true); });
    m.on("dragstart", () => follow(false));
    m.on("rotate", () => setRotation(m.getBearing()));
    m.on("moveend", () => { const c = m.getCenter().wrap(); latest.current.onCenter({ latitude: c.lat, longitude: c.lng }); });
    const observer = new ResizeObserver(() => m.resize()); observer.observe(element.current);
    const shell = element.current.closest(".driver-workspace");
    const themeWatch = new MutationObserver(() => {
      const next = themeOf(element.current);
      if (next !== theme.current) { theme.current = next; m.setStyle(MAP_STYLES[next]); }
    });
    if (shell) themeWatch.observe(shell, { attributes: true, attributeFilter: ["class"] });
    setReady(true);
    return () => { observer.disconnect(); themeWatch.disconnect(); m.remove(); map.current = undefined; car.current = undefined; pins.current = []; };
  }, []);

  // Маршрут и точки А/Б.
  useEffect(() => {
    const m = map.current; if (!m || !styled) return;
    const source = m.getSource("dx-route") as maplibregl.GeoJSONSource | undefined;
    source?.setData(route ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: route.coordinates } } : { type: "FeatureCollection", features: [] });
    pins.current.forEach(pin => pin.remove());
    pins.current = ([[pickup, "А"], [destination, "Б"]] as const).flatMap(([p, label]) => p ? [new maplibregl.Marker({ element: pinElement(label, p.label), anchor: "bottom" }).setLngLat(lngLat(p)).addTo(m)] : []);
  }, [styled, pickup?.latitude, pickup?.longitude, pickup?.label, destination?.latitude, destination?.longitude, destination?.label, route]);

  function fit() {
    const m = map.current; if (!m || !route) return;
    const box = new maplibregl.LngLatBounds();
    route.coordinates.forEach(c => box.extend(c as [number, number]));
    if (pickup) box.extend(lngLat(pickup)); if (destination) box.extend(lngLat(destination));
    m.fitBounds(box, { padding: { top: 60, left: 40, right: 60, bottom: m.getContainer().clientHeight * .32 }, maxZoom: 17, pitch: 0, bearing: 0, duration: 900 }); follow(false);
  }
  useEffect(() => { if (!ready) return; if (route && !active) fit(); else if (active) follow(true); }, [focusKey, ready, active, styled > 0]);

  // Машина: стрелка поворачивается по курсу, при поездке камера едет за ней с наклоном.
  useEffect(() => {
    const m = map.current; if (!m) return;
    if (!current) { car.current?.remove(); car.current = undefined; previous.current = null; return; }
    if (previous.current) { const course = bearing(previous.current, current); if (course !== null) heading.current = course; }
    previous.current = current;
    if (!car.current) car.current = new maplibregl.Marker({ element: carElement(), rotationAlignment: "map", pitchAlignment: "map" }).setLngLat(lngLat(current)).addTo(m);
    car.current.setLngLat(lngLat(current)).setRotation(heading.current);
    car.current.getElement().style.opacity = stale ? ".45" : "1";
    if (following && !picking) focus(current);
  }, [ready, current?.latitude, current?.longitude, stale, following, picking, sheetHeight]);

  useEffect(() => { if (picking) { follow(false); const c = map.current?.getCenter().wrap(); if (c) onCenter({ latitude: c.lat, longitude: c.lng }); } }, [picking]);

  if (unsupported) return <div className="dn-map dn-map--unsupported"><p>Карта не поддерживается этим браузером: нужен WebGL. Маршрут и этапы заказа доступны в панели.</p></div>;
  return <><div className="dn-map" ref={element} aria-label="Карта маршрута" />
    {picking && <span className="dn-center-pin" aria-label={`Выбор точки ${picking}`}>{picking}</span>}
    <div className="dn-map-controls">
      <button type="button" aria-label="Увеличить карту" onClick={() => map.current?.zoomIn()}>+</button>
      <button type="button" aria-label="Уменьшить карту" onClick={() => map.current?.zoomOut()}>−</button>
      {Math.abs(rotation) > 1 && <button type="button" className="dn-compass" aria-label="Повернуть карту на север" onClick={() => { follow(false); map.current?.easeTo({ bearing: 0, pitch: 0, duration: 600 }); }}><span style={{ transform: `rotate(${-rotation}deg)` }}>▲</span></button>}
      {route && <button type="button" onClick={fit}>Маршрут</button>}
      <button type="button" className="dn-locate" aria-label="Вернуться к моей позиции" aria-pressed={following} title={following ? "Карта следует за машиной" : "Вернуться к моей позиции"} disabled={!current} onClick={() => { follow(true); if (current) focus(current); }}>◎</button>
    </div>
    <div className="dn-attribution" style={{ bottom: `calc(${Math.min(sheetHeight, 88)}% + 5px)` }}><a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> · <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">© OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a></div>
    {tileError && <p className="dn-map-note">Часть карты не загрузилась. Маршрут и положение остаются на экране.</p>}
  </>;
}
