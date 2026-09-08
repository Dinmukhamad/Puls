import { useEffect, useRef, useState } from "react";
import { Button } from "./ui";

export interface Position { latitude: number; longitude: number; accuracy: number }
export function SimulatorMap({ position, progress, ready, idle = false }: { position: Position | null; progress: number; ready: boolean; idle?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 500, height: 500 });
  const [zoom, setZoom] = useState(15);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);
  const [tileError, setTileError] = useState(false);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(container.current); return () => observer.disconnect();
  }, []);
  const scale = 2 ** zoom;
  const lat = Math.max(-85, Math.min(85, position?.latitude ?? 0)) * Math.PI / 180;
  const world = { x: ((position?.longitude ?? 0) + 180) / 360 * scale * 256, y: (1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2 * scale * 256 };
  const left = world.x - size.width / 2 - offset.x, top = world.y - size.height / 2 - offset.y;
  const tiles: { x: number; y: number }[] = [];
  if (position) for (let x = Math.floor(left / 256); x <= Math.floor((left + size.width) / 256); x++) for (let y = Math.floor(top / 256); y <= Math.floor((top + size.height) / 256); y++) if (y >= 0 && y < scale) tiles.push({ x, y });
  return <div className={`sim-map${position ? " sim-map--real" : ""}`} ref={container} aria-label={position ? "Карта текущего местоположения" : "Карта учебного города"}>
    {position ? <div className="sim-map__tiles" onPointerDown={(e) => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, dx: offset.x, dy: offset.y }; }} onPointerMove={(e) => { if (drag.current) setOffset({ x: drag.current.dx + e.clientX - drag.current.x, y: drag.current.dy + e.clientY - drag.current.y }); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      {tiles.map((tile) => <img alt="" draggable={false} key={`${zoom}/${tile.x}/${tile.y}`} src={`https://tile.openstreetmap.org/${zoom}/${((tile.x % scale) + scale) % scale}/${tile.y}.png`} referrerPolicy="strict-origin-when-cross-origin" onError={() => setTileError(true)} width={256} height={256} style={{ position: "absolute", left: tile.x * 256 - left, top: tile.y * 256 - top }} />)}
      <span className="sim-location" style={{ left: size.width / 2 + offset.x, top: size.height / 2 + offset.y }}><span /></span>
    </div> : <svg className="sim-map__virtual" viewBox="0 0 800 800" preserveAspectRatio="xMidYMid slice" role="img" aria-label={idle ? "Карта учебного города" : "Учебный маршрут: дом, парк и деловой центр"}>
      <defs><pattern id="sim-blocks" width="160" height="160" patternUnits="userSpaceOnUse"><rect x="12" y="12" width="132" height="132" rx="18" fill="var(--sim-block)" /><path d="M0 0H160M0 0V160" stroke="var(--sim-road)" strokeWidth="16" /></pattern></defs>
      <rect width="800" height="800" fill="url(#sim-blocks)" /><path d="M670 -20Q540 160 650 320T690 820" fill="none" stroke="var(--sim-water)" strokeWidth="75" />
      <rect x="342" y="175" width="118" height="124" rx="22" fill="var(--sim-park)" /><text x="401" y="240" textAnchor="middle" fill="var(--text-secondary)" fontSize="13">Парк</text><text x="240" y="395" textAnchor="middle" fill="var(--text-secondary)" fontSize="13">Центр</text>
      <path d="M100 480H320V320H480V110" fill="none" stroke="var(--sim-road)" strokeWidth="24" />
      {ready && <><path d="M100 480H320V320H480V110" fill="none" stroke="var(--accent-primary)" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" /><g transform="translate(100 480)"><circle r="17" fill="var(--surface-primary)" stroke="var(--accent-primary)" strokeWidth="3" /><text textAnchor="middle" y="5" fontSize="13" fill="var(--text-primary)">A</text></g><g transform="translate(480 110)"><circle r="17" fill="var(--accent-primary)" /><text textAnchor="middle" y="5" fontSize="13" fill="white">B</text></g></>}
      <g className="sim-map__driver" transform={idle ? "translate(400 400)" : `translate(${progress < .33 ? 100 + progress / .33 * 220 : progress < .66 ? 320 : 320 + (progress - .66) / .34 * 160},${progress < .33 ? 480 : progress < .66 ? 480 - (progress - .33) / .33 * 160 : 320 - (progress - .66) / .34 * 210})`}><circle r="28" fill="var(--accent-primary)" opacity=".14" /><circle r="13" fill="var(--accent-primary)" stroke="white" strokeWidth="4" /><path d="M-5 -3L0 -10L5 -3" fill="white" /></g>
    </svg>}
    <div className="sim-map__label">{position ? "Ваше местоположение" : "Виртуальный город"}</div>
    {position && <><div className="sim-map__tools"><Button aria-label="Увеличить карту" disabled={zoom >= 18} onClick={() => { setZoom(zoom + 1); setOffset({x:0,y:0}); }}>+</Button><Button aria-label="Уменьшить карту" disabled={zoom <= 10} onClick={() => { setZoom(zoom - 1); setOffset({x:0,y:0}); }}>−</Button><Button aria-label="Моё местоположение" onClick={() => setOffset({x:0,y:0})}>◎</Button></div><a className="sim-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a><span className="sim-map__accuracy">Точность ±{Math.round(position.accuracy)} м</span>{tileError && <div className="sim-map__error" role="status">Карта не загрузилась. Можно продолжить учебный сценарий.</div>}</>}
  </div>;
}
