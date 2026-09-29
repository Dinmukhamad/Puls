import type { CityControls } from "../../api/types";

/** Что делает каждая кнопка мыши и палец в двух схемах камеры (city3d/engine/camera.ts mouseGesture). */
export const CONTROL_SCHEMES: Record<CityControls, { title: string; note: string; left: string; right: string; wheel: string; touch: string; hint: string }> = {
  orbit: {
    title: "Как раньше", note: "камера вращается вокруг города",
    left: "вращать и наклонять", right: "двигать город", wheel: "— масштаб, зажать и тянуть — тоже",
    touch: "Один палец — вращать, два — масштаб и сдвиг",
    hint: "Тяни — вращай · правая кнопка — двигай город · колесо — масштаб · WASD, Q/E — с клавиатуры",
  },
  map: {
    title: "Как на карте", note: "город едет за мышью, как карта",
    left: "двигать город", right: "вращать и наклонять", wheel: "— масштаб, зажать и тянуть — вращать",
    touch: "Один палец — двигать город, два — масштаб и поворот",
    hint: "Тяни — двигай город · правая кнопка или Shift — поворот и наклон · колесо — масштаб · WASD, Q/E — с клавиатуры",
  },
};
