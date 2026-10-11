import { Component, useEffect, useState, type ReactNode } from "react";
import { Button, Skeleton } from "../../components/ui";
import { createCityRouteLoader } from "./cityRouteLoader";
import { catalogueFiles, lodFiles, prefetchModels } from "../../city3d/assets/modelFiles";

/**
 * The engine and the city's models download while the page and its data load, not after them (the map starts
 * the engine only once its data has come). Only the five-island map (?world=v1) places the building kit.
 */
function prefetchCity() {
  void import("../../city3d").catch(() => undefined);
  prefetchModels(catalogueFiles(lodFiles(), new URLSearchParams(window.location.search).get("world") === "v1").urls);
}
// Keep the city and Three.js out of the initial application bundle.
const cityPageLoader = createCityRouteLoader(() => { prefetchCity(); return import("./CityPage").then(module => module.CityPage); });

function CityRouteError({ reason, onRetry }: { reason: "timeout" | "failed" | "render"; onRetry: () => void }) {
  const message = reason === "timeout"
    ? "Загрузка заняла слишком много времени. Проверь соединение и повтори загрузку города."
    : reason === "render"
      ? "Не удалось открыть город. Попробуй ещё раз или обнови страницу."
      : "Не удалось открыть город. Проверь соединение и повтори загрузку города.";
  return <div className="state state--error" role="alert">
    <p className="state__title">Город временно недоступен</p>
    <p className="state__hint">{message}</p>
    <div className="state__action">
      {reason === "render" ? <>
        <Button onClick={onRetry}>Повторить</Button>
        <Button variant="plain" onClick={() => window.location.reload()}>Обновить страницу</Button>
      </> : <Button variant="primary" onClick={() => window.location.reload()}>Повторить загрузку</Button>}
    </div>
  </div>;
}

class CityRouteBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <CityRouteError reason="render" onRetry={this.props.onRetry} /> : this.props.children;
  }
}

export function CityRoute() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState(() => cityPageLoader.peek());
  useEffect(() => cityPageLoader.subscribe(setState), [attempt]);
  const retry = () => setAttempt(value => value + 1);
  if (state.status === "error") return <CityRouteError reason={state.reason} onRetry={retry} />;
  if (state.status === "loading") return <div role="status" aria-label="Загружаем город">
    <Skeleton height={540} />
  </div>;
  const CityPage = state.value;
  return <CityRouteBoundary key={attempt} onRetry={retry}><CityPage /></CityRouteBoundary>;
}
