import type { AccessPolicy, AccessPreviewSection, AccessUpdate, Effect, SectionCode, TargetType } from "../api/access";

export function applyAccessDraft(policy: AccessPolicy, draft: AccessUpdate, revision: number): AccessPolicy {
  const sections = new Set(draft.changes.map(change => change.section));
  const rules = policy.rules.filter(rule => !(rule.target_type === draft.target_type && draft.target_ids.includes(rule.target_id) && sections.has(rule.section)));
  for (const id of draft.target_ids) for (const change of draft.changes) {
    if (change.effect !== "inherit") rules.push({ target_type: draft.target_type, target_id: id, section: change.section, effect: change.effect });
  }
  return { ...policy, revision, rules };
}

export function draftEffect(policy: AccessPolicy, kind: TargetType, ids: string[], changes: Partial<Record<SectionCode, Effect>>, code: SectionCode, effect: Effect, beforeState?: AccessPreviewSection["state"]) {
  const next = { ...changes };
  const identical = ids.every(id => (policy.rules.find(rule => rule.target_type === kind && rule.target_id === id && rule.section === code)?.effect ?? "inherit") === effect);
  const restored = effect === "allow" && beforeState === "on" || effect === "deny" && beforeState === "off";
  if (identical || restored) delete next[code]; else next[code] = effect;
  return next;
}

const sources = { default: "Роль по умолчанию", all: "Общее правило для всех", role: "Настройка роли", group: "Настройка группы", user: "Личное исключение", admin_only: "Ограничение администратора" };
export function sourceDescription(value: AccessPreviewSection["sources"]) {
  const labels = Object.entries(value).filter(([, count]) => count).map(([key]) => sources[key as keyof typeof sources]);
  return labels.length === 1 ? `Источник: ${labels[0]}.` : `Источники: ${labels.join(", ")}.`;
}
