import { useState } from "react";
import type { BenchmarkMode, PilotReport, TimeOfDay } from "./index";

export function PilotTools({ night, onTime, report, inspect, onBenchmark }: {
  night: boolean; onTime: (mode: TimeOfDay) => void; report: PilotReport | null; inspect: boolean;
  onBenchmark: (mode: BenchmarkMode, seconds: number) => void;
}) {
  const [open, setOpen] = useState(false);
  function download() {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `puls-city-${report.backend.toLowerCase()}-${Date.now()}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const running = report?.benchmark?.status === "running";
  return <>
    <div className="city-v3-toolbar">
      <span className="city-v3-caption"><b>Остров CRM</b><small>Пилот нового города</small></span>
      <div className="city-v3-times" role="group" aria-label="Время суток">
        <button type="button" aria-pressed={!night} onClick={() => onTime("day")}>☀ День</button>
        <button type="button" aria-pressed={night} onClick={() => onTime("night")}>☾ Ночь</button>
      </div>
      {inspect && <button type="button" className="city-v3-metrics-button" aria-expanded={open} aria-controls="city-v3-stats" onClick={() => setOpen(value => !value)}>Замер</button>}
    </div>
    {inspect && open && <aside id="city-v3-stats" className="city-v3-stats" aria-label="Производительность пилота">
      <header><strong>Проверка плавности</strong><span>{report?.backend ?? "Загрузка"}</span></header>
      <dl>
        <div><dt>Средний FPS</dt><dd>{report?.stats.fps.toFixed(1) ?? "—"}</dd></div>
        <div><dt>1% медленных</dt><dd>{report?.stats.fpsP1.toFixed(1) ?? "—"}</dd></div>
        <div><dt>CPU / кадр</dt><dd>{report?.stats.cpuMs.toFixed(1) ?? "—"} мс</dd></div>
        <div><dt>Первый кадр</dt><dd>{report ? (report.firstFrameMs / 1000).toFixed(2) : "—"} с</dd></div>
      </dl>
      <p>{report ? `${Math.round(report.stats.drawCalls)} вызовов · ${Math.round(report.stats.triangles).toLocaleString("ru-RU")} треугольников · DPR ${report.dpr}` : "Готовим сцену…"}</p>
      <p className="city-v3-stats-help">{report?.benchmark && !running ? `Сохранённый результат: ${report.timeOfDay === "night" ? "ночь" : "день"}, ${report.width}×${report.height}, движение ${report.trafficEnabled ? "включено" : "на паузе"}. ` : "Текущие показатели. "}FPS выше — плавнее. CPU — работа главного потока, без времени GPU. Задержки загрузки учитываются.</p>
      <div className="city-v3-benchmarks">
        <button type="button" disabled={!report || running} onClick={() => onBenchmark("static", 60)}>Вид · 60 с</button>
        <button type="button" disabled={!report || running} onClick={() => onBenchmark("orbit", 60)}>Облёт · 60 с</button>
        <button type="button" disabled={!report || running} onClick={() => onBenchmark("orbit", 900)}>Нагрев · 15 мин</button>
      </div>
      {report?.benchmark && <div className="city-v3-benchmark-status" role="status">
        <progress max={1} value={report.benchmark.progress} />
        <span>{running ? `Замер: ${Math.round(report.benchmark.progress * 100)}%` : report.benchmark.status === "complete" ? "Замер завершён" : "Замер прерван"}</span>
        {running && <small>Оставьте вкладку открытой. Управление камерой прерывает замер.</small>}
      </div>}
      <button type="button" disabled={!report || running} className="city-v3-download" onClick={download}>Скачать отчёт JSON ↓</button>
    </aside>}
  </>;
}
