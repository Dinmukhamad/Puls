import { useId, useState } from "react";
import type { MyEstate } from "../../api/cityEstate";
import { Sheet } from "../../components/Sheet";
import "./cityBuildEntry.css";

/** A visible operator entry point, including the reason when a district is not assigned yet. */
export function CityBuildEntry({ mine, loading, failed, onRetry, onBuild }: {
  mine?: MyEstate; loading: boolean; failed: boolean; onRetry: () => void; onBuild: () => void;
}) {
  const titleId = useId(), [help, setHelp] = useState(false);
  const pending = loading || !mine;
  const canEnter = !!mine?.district && (mine.status === "ready" || mine.status === "closed");
  const reason = mine?.message || (mine?.status === "no_land"
    ? "Для команды пока не назначен район с участками."
    : "Для стройки нужна группа супервайзера и назначенный ей район.");

  return <>
    <section className="city-build-entry glass glass--regular" aria-labelledby={titleId} aria-busy={!failed && pending}>
      <header className="city-build-entry__head"><span className="city-build-entry__icon" aria-hidden="true">🏡</span><div>
        <h2 id={titleId}>Застройка района</h2>
        {mine?.district && <p className="city-build-entry__district">{mine.district.name}</p>}
      </div></header>
      <p className="city-build-entry__route">Выбери участок → выбери здание → построй</p>
      {failed ? <>
        <p className="city-build-entry__notice" role="alert">Не удалось проверить доступ к стройке.</p>
        <button type="button" className="city-secondary city-build-entry__button" onClick={onRetry}>Повторить загрузку</button>
      </> : pending ? <>
        <p className="city-build-entry__notice" role="status">Проверяем твой район…</p>
        <button type="button" className="city-action city-build-entry__button" disabled>Загружаем стройку…</button>
      </> : canEnter ? <>
        {mine.status === "closed" && <p className="city-build-entry__notice" role="status">{mine.message || "Стройка закрыта руководителем."} Можно посмотреть участки.</p>}
        <button type="button" className="city-action city-build-entry__button" onClick={onBuild}>Строить в районе</button>
      </> : <>
        <p className="city-build-entry__notice" role="status">{reason}</p>
        <button type="button" className="city-secondary city-build-entry__button" onClick={() => setHelp(true)}>Как открыть стройку</button>
      </>}
    </section>
    {help && <Sheet title="Как открыть стройку" subtitle="Настройку выполняет руководитель или администратор" size="s" onClose={() => setHelp(false)}
      footer={<button type="button" className="city-action city-build-entry__button" onClick={() => { setHelp(false); onRetry(); }}>Проверить доступ</button>}>
      <CityBuildSetupSteps />
    </Sheet>}
  </>;
}

/** Concrete assignment steps used by the help sheet. */
export function CityBuildSetupSteps() {
  return <div className="city-build-setup">
    <p>Попроси руководителя или администратора:</p>
    <ol>
      <li>Добавить тебя в активную группу супервайзера.</li>
      <li>В разделе «Города и районы» назначить этого супервайзера району своего города.</li>
      <li>Включить «Стройка открыта» у этого района и сохранить настройки.</li>
    </ol>
    <p>После настройки вернись в город и нажми «Проверить доступ». Все свободные участки района команды будут доступны сразу.</p>
  </div>;
}
