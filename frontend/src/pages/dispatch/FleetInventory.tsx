import { useState } from "react";
import { fleet as api, type InventoryType } from "../../api/dispatch";
import { FleetHead, Icon, Modal, useFleet } from "./FleetUi";
import { parkTitle, shortDate } from "./fleetNav";

/** Thermoboxes as the courier sees them: Еда is the yellow one, Доставка the black one. */
export function Thermobox({ type, number = "" }: { type: InventoryType; number?: string }) {
  const eda = type === "eda";
  return <svg className={`fleet-box fleet-box--${type}`} viewBox="0 0 160 150" role="img" aria-label={`${eda ? "Жёлтый термокороб Яндекс Еды" : "Чёрный термокороб Яндекс Доставки"}${number ? `, номер ${number}` : ""}`}>
    <path d="M22 34h116l-6 106H28z" className="fleet-box-body" /><path d="M16 22h128v18H16z" className="fleet-box-lid" />
    {eda ? <path d="M80 118a26 26 0 1 1 26-26 19 19 0 1 1-19-19 12 12 0 1 1-12 12 6 6 0 1 1 6 6" className="fleet-box-spiral" />
      : <g className="fleet-box-icons"><rect x="46" y="58" width="18" height="18" rx="4" /><rect x="71" y="58" width="18" height="18" rx="4" /><rect x="96" y="58" width="18" height="18" rx="9" /><rect x="46" y="83" width="43" height="18" rx="4" /><circle cx="105" cy="92" r="9" className="fleet-box-red" /></g>}
    <path d="M16 26h128" className="fleet-box-strip" />
    <g className="fleet-box-sticker"><rect x="44" y="4" width="72" height="20" rx="4" /><text x="80" y="18">{number || "номер"}</text></g>
  </svg>;
}

type Dialog = "issue" | "return" | null;

/** «Инвентарь»: issue and take back thermoboxes of the chosen park. */
export function InventoryPage() {
  const { state, park } = useFleet();
  const [dialog, setDialog] = useState<Dialog>(null);
  const rows = state.inventory.log.filter(r => !r.park || r.park === park.id);
  return <div className="fleet-page"><FleetHead title="Инвентарь">
    <button className="fleet-add" data-coach="inventory-add" aria-label="Выдать инвентарь" onClick={() => setDialog("issue")}><Icon name="plus" /></button>
    <button className="fleet-btn" data-coach="inventory-return" onClick={() => setDialog("return")}><Icon name="refresh" /> Вернуть</button>
  </FleetHead>
    <p className="fleet-note">Сначала выберите в правом верхнем углу парк исполнителя и город его регистрации. Сейчас выбран: <strong>{parkTitle(park)}</strong>.</p>
    <div className="fleet-stock">{(Object.keys(state.catalog.inventory) as InventoryType[]).map(type => <div key={type} className="fleet-card fleet-stock-card"><div><h3>{state.catalog.inventory[type]}</h3><small>Осталось на складе</small><strong>{state.inventory.stock[type]}</strong></div><Thermobox type={type} /></div>)}</div>
    <div className="fleet-table-card fleet-scroll"><table className="fleet-table" data-coach="inventory-table">
      <thead><tr><th>Сотрудник</th><th>Исполнитель</th><th>Тип операции</th><th>Тип инвентаря</th><th className="fleet-num">Количество</th><th>Дата</th></tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i} className={r.driver ? "is-mine" : ""} data-coach={r.driver && i === 0 ? "inventory-new-row" : undefined}><td>{r.employee}</td><td>{r.driver_name}</td><td>{r.operation}</td><td>{state.catalog.inventory[r.type]}</td><td className="fleet-num">{r.qty}</td><td>{shortDate(r.at, false)}</td></tr>)}</tbody>
    </table></div>
    {dialog && <InventoryDialog mode={dialog} onClose={() => setDialog(null)} />}
  </div>;
}

function InventoryDialog({ mode, onClose }: { mode: "issue" | "return"; onClose: () => void }) {
  const { state, park, run } = useFleet();
  const [type, setType] = useState<InventoryType | "">(""), [code, setCode] = useState(""), [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const issue = mode === "issue";
  async function save() {
    if (!type) return;
    setBusy(true); setError("");
    try {
      const input = { park: park.id, type, code, number };
      await run(() => issue ? api.issue(input) : api.giveBack(input), issue ? "Инвентарь выдан" : "Инвентарь возвращён на склад");
      onClose();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Modal title={issue ? "Выдать инвентарь" : "Вернуть инвентарь"} onClose={onClose} className="fleet-inventory-dialog">
    <form className="fleet-form" data-coach="inventory-dialog" onSubmit={e => { e.preventDefault(); void save(); }}>
      <label className={`fleet-float${type ? " is-filled" : ""}`} data-coach="inventory-type" data-value={type}><span>Тип инвентаря</span>
        <select value={type} autoFocus onChange={e => setType(e.target.value as InventoryType)}><option value="" disabled hidden /> {(Object.entries(state.catalog.inventory) as [InventoryType, string][]).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      {type && <>
        <div className="fleet-inventory-art"><Thermobox type={type} number={number.trim().toUpperCase()} /><p>{type === "eda" ? "Жёлтый термокороб" : "Чёрный термокороб"}{issue && <><br /><small>Номер, который вы впишете, пишут на термокоробе</small></>}</p></div>
        <label className={`fleet-float${code ? " is-filled" : ""}`} data-coach="inventory-code"><span>Код для получения</span><input value={code} maxLength={5} autoComplete="off" spellCheck={false} onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} aria-describedby="inventory-code-hint" /></label>
        <small className="fleet-field-hint" id="inventory-code-hint">Исполнитель диктует код из Яндекс Про: Профиль → Инвентарь → Получить код. Код обновляется каждые 2 минуты.</small>
        <label className={`fleet-float${number ? " is-filled" : ""}`} data-coach="inventory-number"><span>Номер инвентаря</span><input value={number} maxLength={12} autoComplete="off" onChange={e => setNumber(e.target.value.toUpperCase())} /></label>
      </>}
      {error && <p className="fleet-error" role="alert">{error}</p>}
      <button className="fleet-btn fleet-btn--yellow fleet-btn--wide" data-coach="inventory-save" disabled={busy || !type || code.length !== 5 || number.trim().length < 3}>{busy ? "Сохраняем…" : "Сохранить"}</button>
    </form>
  </Modal>;
}
