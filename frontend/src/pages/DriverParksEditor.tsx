import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { driver, type DriverPark } from "../api/driver";
import { useAuth } from "../auth/AuthContext";
import { Button, Card, ErrorState, RowsSkeleton } from "../components/ui";

export function DriverParksEditor() {
  const { atLeast } = useAuth();
  const query = useQuery({ queryKey: ["driver-parks"], queryFn: driver.parks });
  return <Card title="Driver Simulator · варианты сотрудничества" subtitle="Парки на экране учебного входа">
    {query.isLoading ? <RowsSkeleton rows={2} /> : query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : query.data &&
      <ParksForm initial={query.data.parks} readOnly={!atLeast("head")} />}
  </Card>;
}

function ParksForm({ initial, readOnly }: { initial: DriverPark[]; readOnly: boolean }) {
  const [parks, setParks] = useState(() => structuredClone(initial));
  const client = useQueryClient();
  const save = useMutation({ mutationFn: () => driver.saveParks(parks), onSuccess: (data) => {
    setParks(data.parks);
    client.setQueryData(["driver-parks"], data);
    void client.invalidateQueries({ queryKey: ["driver-profile"] });
  } });
  function update(next: DriverPark[]) { setParks(next); save.reset(); }
  return <form className="stack" onSubmit={(event) => { event.preventDefault(); if (!save.isPending) save.mutate(); }}>
    <p className="secondary small">Названия и комиссии используются только в учебном приложении. Выбранные ранее условия сохраняются в профиле до следующего выбора парка.</p>
    <fieldset className="learning-fieldset stack" disabled={readOnly || save.isPending}>
      {parks.map((park, index) => <div className="learning-form-grid" key={park.id}>
        <label className="field"><span className="field__label">Название парка {index + 1}</span><input className="input" required maxLength={100} value={park.name} onChange={(e) => update(parks.map((item, i) => i === index ? { ...item, name: e.target.value } : item))} /></label>
        <label className="field"><span className="field__label">Комиссия, %</span><input className="input" required type="number" min={0} max={100} step="any" value={park.commission} onChange={(e) => update(parks.map((item, i) => i === index ? { ...item, commission: Number(e.target.value) } : item))} /></label>
        {!readOnly && <Button disabled={parks.length === 1} onClick={() => update(parks.filter((item) => item.id !== park.id))}>Удалить парк {index + 1}</Button>}
      </div>)}
      {!readOnly && <div className="row"><Button disabled={parks.length >= 20} onClick={() => update([...parks, { id: crypto.randomUUID(), name: "", commission: 0 }])}>Добавить парк</Button><Button type="submit" variant="primary">{save.isPending ? "Сохраняем…" : "Сохранить парки"}</Button></div>}
    </fieldset>
    {save.isSuccess && <p role="status">Варианты сотрудничества сохранены.</p>}
    {save.isError && <ErrorState error={save.error} />}
  </form>;
}
