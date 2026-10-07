import { useQuery } from "@tanstack/react-query";
import { scenarioKeys, scenarios } from "../../api/scenarios";

export function crmSubmissionDetails(details: Record<string, string>, fields: string[], attemptId?: string) {
  const result = Object.fromEntries(fields.map(key => [key, details[key] ?? ""]));
  if (attemptId) {
    result.scenario_attempt = attemptId;
    for (const key of ["scenario_checks", "scenario_outcome", "scenario_next_action"]) result[key] = details[key] ?? "";
  }
  return result;
}

export function parseScenarioChecks(value: string | undefined): string[] {
  try { const parsed: unknown = JSON.parse(value ?? "[]"); return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : []; } catch { return []; }
}

export function ScenarioCrmProof({ attemptId, details, onChange }: { attemptId: string; details: Record<string, string>; onChange: (details: Record<string, string>) => void }) {
  const query = useQuery({ queryKey: scenarioKeys.attempt(attemptId), queryFn: ({ signal }) => scenarios.attempt(attemptId, signal), retry: false });
  const checks = parseScenarioChecks(details.scenario_checks);
  if (query.isError) return <div className="crm-error" role="alert"><p>{query.error.message}</p><button type="button" className="crm-secondary" onClick={() => query.refetch()}>Загрузить требования сценария</button></div>;
  if (!query.data) return <p role="status">Загружаем требования сценария…</p>;
  return <fieldset className="scenario-crm-proof"><legend>Практика сценария · Business через парк</legend><p>Объясните водителю все перечисленные темы и отметьте каждый пункт. В комментарии запишите проверенные данные, результат консультации и следующий шаг — не менее 40 символов.</p>
    {query.data.crm_requirements.map(item => <label key={item.key}><input type="checkbox" required checked={checks.includes(item.key)} onChange={event => onChange({ ...details, scenario_checks: JSON.stringify(event.target.checked ? [...checks, item.key] : checks.filter(key => key !== item.key)) })} /><span>{item.label}</span></label>)}
    <label className="crm-field"><span>Итог консультации *</span><select required value={details.scenario_outcome ?? ""} onChange={event => onChange({ ...details, scenario_outcome: event.target.value })}><option value="">Выберите итог</option><option value="not_confirmed">Допуск к Business не подтверждён — нужна проверка сервиса</option><option value="confirmed">Допуск к Business подтверждён</option></select></label>
    <label className="crm-field"><span>Следующее действие водителя *</span><select required value={details.scenario_next_action ?? ""} onChange={event => onChange({ ...details, scenario_next_action: event.target.value })}><option value="">Выберите действие</option><option value="check_pro_diagnostics">Проверить классификатор, тарифы и диагностику Яндекс Про; прислать результат</option><option value="start_business">Сразу начать выполнять заказы Business</option><option value="wait_park">Ждать ручного подключения от парка</option></select></label>
  </fieldset>;
}
