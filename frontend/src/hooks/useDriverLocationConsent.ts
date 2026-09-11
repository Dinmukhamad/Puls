import { useEffect, useState } from "react";

export type LocationConsent = "ask" | "enabled" | "off";
const KEY = "pulse.driver-geoconsent";

function stores(): Storage[] {
  const list: Storage[] = [];
  // localStorage первым: согласие должно пережить закрытие вкладки и установленного приложения.
  try { if (window.localStorage) list.push(window.localStorage); } catch { /* приватный режим */ }
  try { if (window.sessionStorage) list.push(window.sessionStorage); } catch { /* приватный режим */ }
  return list;
}
function read(): LocationConsent {
  for (const store of stores()) {
    try { const value = store.getItem(KEY); if (value === "enabled" || value === "off") return value; } catch { /* хранилище закрыто */ }
  }
  return "ask";
}
function write(value: LocationConsent) {
  for (const store of stores()) { try { store.setItem(KEY, value); } catch { /* нет места — останется только в памяти */ } }
}

/**
 * Согласие на геолокацию — выбор устройства, а не смены. Ключ один и лежит в localStorage,
 * поэтому новый заказ, новая смена и повторный вход больше не спрашивают заново.
 *
 * Если браузер уже решил вопрос — разрешил или запретил, — объяснять нечего: включаем сразу,
 * и водитель видит либо карту, либо инструкцию, как снять запрет. Своё окно остаётся только
 * для состояния «ещё не спрашивали», чтобы объяснить причину до системного запроса.
 * Ответ браузера в хранилище не пишем: явный выбор водителя должен оставаться его выбором.
 */
export function useDriverLocationConsent() {
  const [consent, setStored] = useState<LocationConsent>(read);
  const setConsent = (value: LocationConsent) => { setStored(value); write(value); };

  useEffect(() => {
    if (consent !== "ask" || typeof navigator === "undefined" || !navigator.permissions?.query) return;
    let cancelled = false;
    let status: PermissionStatus | undefined;
    const apply = () => { if (!cancelled && status && status.state !== "prompt") setStored("enabled"); };
    try {
      void navigator.permissions.query({ name: "geolocation" as PermissionName }).then(value => {
        if (cancelled) return;
        status = value;
        value.addEventListener("change", apply);
        apply();
      }).catch(() => { /* Safari до 16 не умеет спрашивать про геолокацию */ });
    } catch { /* синхронный отказ в старых браузерах */ }
    return () => { cancelled = true; status?.removeEventListener("change", apply); };
  }, [consent]);

  return [consent, setConsent] as const;
}
