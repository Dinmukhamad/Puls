import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { auth as authApi } from "../../api/endpoints";
import type { Gender } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { DEFAULT_GUIDE, guideName } from "../../guide";

export const GUIDE_AVATAR: Record<Gender, string> = { female: "👩‍💻", male: "👨‍💻" };

/** Оператор выбирает фигуру в центре города (если пол не указан при создании) и называет помощника. */
export function CityGuideSetup() {
  const { user, applyProfile } = useAuth(), client = useQueryClient();
  const current = user?.guide_name ?? "";
  const [editing, setEditing] = useState(false);
  const [gender, setGender] = useState<Gender | null>(user?.gender ?? null);
  const [name, setName] = useState(current);
  const save = useMutation({
    mutationFn: () => authApi.guide({ ...(gender ? { gender } : {}), guide_name: name.trim() || null }),
    onSuccess: profile => { applyProfile(profile); setEditing(false); void client.invalidateQueries({ queryKey: ["city"] }); },
  });
  if (!user) return null;
  const needsFigure = !user.gender, needsName = !user.guide_name;
  if (!editing && !needsFigure && !needsName) return <div className="city-guide-chip">
    <span aria-hidden="true">{GUIDE_AVATAR[user.gender!]}</span><span>Твой помощник: <strong>{guideName(user)}</strong></span>
    <button type="button" onClick={() => { setGender(user.gender ?? null); setName(current); setEditing(true); }}>Изменить</button>
  </div>;
  function submit(event: FormEvent) { event.preventDefault(); if (gender && name.trim().length >= 2 && !save.isPending) save.mutate(); }
  return <form className="city-guide-setup" onSubmit={submit} aria-labelledby="city-guide-title">
    <div className="city-guide-setup__head">
      <span className="city-guide-setup__avatar" aria-hidden="true">{gender ? GUIDE_AVATAR[gender] : "✨"}</span>
      <div><h2 id="city-guide-title">{needsFigure || editing ? "Кто встанет в центре твоего города?" : "Как зовут твоего помощника?"}</h2>
        <p>Выбери фигуру и дай ей имя. Это имя заменит «{DEFAULT_GUIDE}» во всех подсказках.</p></div>
    </div>
    <div className="city-guide-setup__figures" role="radiogroup" aria-label="Фигура в центре города">
      {(["female", "male"] as const).map(value => <button key={value} type="button" role="radio" aria-checked={gender === value} className="city-guide-figure" onClick={() => setGender(value)}>
        <span aria-hidden="true">{GUIDE_AVATAR[value]}</span><strong>{value === "female" ? "Девушка-оператор" : "Парень-оператор"}</strong>
      </button>)}
    </div>
    <label className="city-guide-setup__name"><span>Имя помощника</span>
      <input value={name} maxLength={40} placeholder={gender === "male" ? "Например, Арман" : gender === "female" ? "Например, Айгерим" : "Сначала выбери фигуру"} onChange={e => { setName(e.target.value); save.reset(); }} />
    </label>
    {save.isError && <p className="city-guide-setup__error" role="alert">{save.error.message}</p>}
    <div className="city-guide-setup__actions">
      <button className="city-action" disabled={!gender || name.trim().length < 2 || save.isPending}>{save.isPending ? "Сохраняем…" : "Готово"}</button>
      {editing && <button type="button" className="city-secondary" onClick={() => setEditing(false)}>Отмена</button>}
    </div>
  </form>;
}
