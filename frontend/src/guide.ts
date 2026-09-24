import { useAuth } from "./auth/AuthContext";
import type { UserOut } from "./api/types";

/* Помощник оператора. По умолчанию это Пульсар; оператор может дать ему своё имя,
   и тогда оно звучит во всех подсказках вместо «Пульсар». */
export const DEFAULT_GUIDE = "Пульсар";

export function guideName(user: Pick<UserOut, "guide_name"> | null | undefined) {
  return user?.guide_name?.trim() || DEFAULT_GUIDE;
}

/** Подставляет имя помощника в готовый текст. Имена не склоняем: «у Айгерим», «Пульсара» → «Айгерим». */
export function guideText(text: string, name: string) {
  if (!text || name === DEFAULT_GUIDE) return text;
  return text.replace(/Пульсар(?:ом|у|а|е)?/g, name);
}

export function useGuide() {
  const { user } = useAuth();
  const name = guideName(user);
  return { name, gender: user?.gender ?? null, named: name !== DEFAULT_GUIDE, text: (value: string) => guideText(value, name) };
}
