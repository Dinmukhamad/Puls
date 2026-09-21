import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { systemApi, type DeviceSession } from "../api/system";
import { useAuth } from "../auth/AuthContext";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { Badge, Button, Card, EmptyState, ErrorState, KPI, Skeleton, SegmentedControl } from "../components/ui";
import { dateTime, parseTimestamp, plural } from "../utils/format";
import "./workflow.css";

/** Строка User-Agent целиком нечитаема, а различать сеансы надо по браузеру и системе. */
export function browserOf(agent: string) {
  if (/Edg\//.test(agent)) return "Edge";
  if (/Firefox\//.test(agent)) return "Firefox";
  if (/Chrome\//.test(agent)) return "Chrome";
  if (/Safari\//.test(agent)) return "Safari";
  return "Браузер";
}

export function platformOf(agent: string) {
  if (/iPhone|iPad/.test(agent)) return "iOS";
  if (/Android/.test(agent)) return "Android";
  if (/Windows/.test(agent)) return "Windows";
  if (/Mac/.test(agent)) return "macOS";
  if (/Linux/.test(agent)) return "Linux";
  return "Другое";
}

const MOBILE = new Set(["iOS", "Android"]);

/**
 * Давность активности. Это главный признак на экране безопасности: вход
 * недельной давности с чужого адреса выглядит иначе, чем сеанс, живой прямо
 * сейчас. Пороги совпадают с подписями, чтобы фильтр и колонка не расходились.
 *
 * Время разбирается через parseTimestamp, а не через new Date: бэкенд отдаёт
 * отметки без часового пояса, и голый конструктор считает их локальными.
 * В UTC+5 это давало промах в пять часов — сеанс, начатый минуту назад,
 * попадал в «Сегодня» вместо «Сейчас».
 */
export type Freshness = "now" | "today" | "week" | "stale";

export function freshnessOf(iso: string, now = Date.now()): Freshness {
  const minutes = (now - parseTimestamp(iso).getTime()) / 60000;
  if (minutes < 5) return "now";
  if (minutes < 60 * 24) return "today";
  if (minutes < 60 * 24 * 7) return "week";
  return "stale";
}

const FRESHNESS: Record<Freshness, { label: string; tone: "success" | "neutral" | "warning" }> = {
  now: { label: "Сейчас", tone: "success" },
  today: { label: "Сегодня", tone: "neutral" },
  week: { label: "На этой неделе", tone: "neutral" },
  stale: { label: "Давно", tone: "warning" },
};

function relative(iso: string) {
  const minutes = Math.floor((Date.now() - parseTimestamp(iso).getTime()) / 60000);
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} ${plural(minutes, "минуту", "минуты", "минут")} назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${plural(hours, "час", "часа", "часов")} назад`;
  const days = Math.floor(hours / 24);
  return `${days} ${plural(days, "день", "дня", "дней")} назад`;
}

export interface SessionFilters {
  scope: "all" | "mine";
  person: string;
  platform: string;
  freshness: string;
  search: string;
  sort: SortKey;
  meId?: number;
}

/**
 * Отбор и порядок строк. Вынесено из компонента намеренно: это единственное
 * место, где экран может соврать — показать чужой сеанс под «Мой аккаунт»
 * или потерять строку из-за регистра в поиске. Внутри useMemo такую логику
 * не проверить.
 */
export function filterSessions(sessions: DeviceSession[], f: SessionFilters, now = Date.now()): DeviceSession[] {
  const needle = f.search.trim().toLowerCase();
  const rows = sessions.filter((s) => {
    if (f.scope === "mine" && s.user_id !== f.meId) return false;
    if (f.person && String(s.user_id) !== f.person) return false;
    if (f.platform && platformOf(s.device) !== f.platform) return false;
    if (f.freshness && freshnessOf(s.last_active_at, now) !== f.freshness) return false;
    if (!needle) return true;
    // Поиск идёт и по адресу: при разборе подозрительного входа ищут именно IP.
    return [s.full_name, s.ip_address ?? "", browserOf(s.device), platformOf(s.device)]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
  return rows.sort((a, b) => {
    if (f.sort === "name") return a.full_name.localeCompare(b.full_name, "ru");
    const field = f.sort === "created" ? "created_at" : "last_active_at";
    return parseTimestamp(b[field]).getTime() - parseTimestamp(a[field]).getTime();
  });
}

export type SortKey = "active" | "created" | "name";

export function SessionsPage() {
  const data = useQuery({ queryKey: ["sessions", "developer"], queryFn: () => systemApi.sessions(true) });
  const [target, setTarget] = useState<DeviceSession | "others" | null>(null);
  const client = useQueryClient();
  const toast = useToast();
  const { logout, user } = useAuth();

  const [scope, setScope] = useState<"all" | "mine">("all");
  const [search, setSearch] = useState("");
  const [person, setPerson] = useState("");
  const [platform, setPlatform] = useState("");
  const [freshness, setFreshness] = useState("");
  const [sort, setSort] = useState<SortKey>("active");

  const sessions = useMemo(() => data.data ?? [], [data.data]);

  const people = useMemo(() => {
    const seen = new Map<number, string>();
    for (const s of sessions) seen.set(s.user_id, s.full_name);
    return [...seen].sort((a, b) => a[1].localeCompare(b[1], "ru"));
  }, [sessions]);

  const platforms = useMemo(
    () => [...new Set(sessions.map((s) => platformOf(s.device)))].sort((a, b) => a.localeCompare(b, "ru")),
    [sessions],
  );

  const visible = useMemo(
    () => filterSessions(sessions, { scope, person, platform, freshness, search, sort, meId: user?.id }),
    [sessions, scope, person, platform, freshness, search, sort, user?.id],
  );

  const stats = useMemo(
    () => ({
      total: sessions.length,
      people: new Set(sessions.map((s) => s.user_id)).size,
      mobile: sessions.filter((s) => MOBILE.has(platformOf(s.device))).length,
      stale: sessions.filter((s) => freshnessOf(s.last_active_at) === "stale").length,
    }),
    [sessions],
  );

  const filtered = search || person || platform || freshness || scope === "mine";

  const revoke = useMutation({
    mutationFn: () =>
      target === "others" ? systemApi.revokeOthers() : systemApi.revoke((target as DeviceSession).id, true),
    onSuccess: () => {
      if (target !== "others" && target?.current) logout();
      setTarget(null);
      void client.invalidateQueries({ queryKey: ["sessions"] });
      toast.success("Сеансы завершены");
    },
  });

  function reset() {
    setSearch("");
    setPerson("");
    setPlatform("");
    setFreshness("");
    setScope("all");
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1 className="page-title">Сессии и устройства</h1>
          <p className="page-subtitle">Активные входы сотрудников и управление сеансами</p>
        </div>
        <Button
          disabled={!sessions.some((s) => s.user_id === user?.id && !s.current)}
          onClick={() => setTarget("others")}
        >
          Завершить мои другие сеансы
        </Button>
      </div>

      {data.isLoading && <Skeleton height={220} />}
      {data.isError && <ErrorState error={data.error} onRetry={() => data.refetch()} />}

      {data.data && (
        <>
          <div className="kpi-grid">
            <KPI label="Активных сеансов" value={stats.total} />
            <KPI label="Пользователей" value={stats.people} hint="у одного человека может быть несколько устройств" />
            <KPI label="С телефонов" value={stats.mobile} />
            <KPI
              label="Без активности неделю"
              value={stats.stale}
              tone={stats.stale ? "accent" : "neutral"}
              hint="такие сеансы стоит завершить"
            />
          </div>

          <Card>
            <div className="workflow-toolbar">
              {/* Переключатель стоит первым и здесь же, а не отдельной полосой
                  во всю ширину: это такой же отбор, как остальные, и держать
                  его в стороне значит заставлять искать фильтры в двух местах. */}
              <div className="field" style={{ flex: "0 0 auto" }}>
                <span className="field__label">Чьи сеансы</span>
                <SegmentedControl
                  value={scope}
                  onChange={setScope}
                  options={[
                    { value: "all", label: "Все" },
                    { value: "mine", label: "Мои" },
                  ]}
                />
              </div>
              <label className="field" style={{ flex: "2 1 220px" }}>
                <span className="field__label">Поиск</span>
                <input
                  className="input"
                  type="search"
                  value={search}
                  placeholder="Имя, IP-адрес или устройство"
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <label className="field">
                <span className="field__label">Сотрудник</span>
                <select className="input" value={person} onChange={(e) => setPerson(e.target.value)}>
                  <option value="">Все сотрудники</option>
                  {people.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field__label">Платформа</span>
                <select className="input" value={platform} onChange={(e) => setPlatform(e.target.value)}>
                  <option value="">Любая</option>
                  {platforms.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field__label">Активность</span>
                <select className="input" value={freshness} onChange={(e) => setFreshness(e.target.value)}>
                  <option value="">Любая</option>
                  {Object.entries(FRESHNESS).map(([key, item]) => (
                    <option key={key} value={key}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field__label">Сортировка</span>
                <select className="input" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                  <option value="active">Сначала активные</option>
                  <option value="created">Сначала новые входы</option>
                  <option value="name">По имени</option>
                </select>
              </label>
              <Button disabled={!filtered} onClick={reset}>
                Сбросить
              </Button>
            </div>
          </Card>

          {sessions.length === 0 ? (
            <EmptyState title="Активных сессий нет" hint="Никто не вошёл в систему с действующим сеансом." />
          ) : visible.length === 0 ? (
            <EmptyState
              title="Под фильтры ничего не попало"
              hint="Снимите часть условий, чтобы увидеть остальные сеансы."
              action={<Button onClick={reset}>Сбросить фильтры</Button>}
            />
          ) : (
            <Card
              title="Сеансы"
              subtitle={
                filtered
                  ? `Показано ${visible.length} из ${sessions.length}`
                  : `${sessions.length} ${plural(sessions.length, "сеанс", "сеанса", "сеансов")}`
              }
            >
              <div className="table-wrap table-wrap--responsive">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Сотрудник</th>
                      <th>Устройство</th>
                      <th>IP-адрес</th>
                      <th>Последняя активность</th>
                      <th>Вход</th>
                      <th aria-label="Действия" />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((record) => {
                      const state = FRESHNESS[freshnessOf(record.last_active_at)];
                      return (
                        <tr key={record.id}>
                          <td>
                            {record.full_name}
                            {record.current && (
                              <>
                                {" "}
                                <Badge tone="success">Текущая</Badge>
                              </>
                            )}
                          </td>
                          <td>
                            {browserOf(record.device)} · {platformOf(record.device)}
                          </td>
                          <td>{record.ip_address ?? "Не записан"}</td>
                          <td>
                            <Badge tone={state.tone}>{state.label}</Badge>{" "}
                            <span className="secondary">{relative(record.last_active_at)}</span>
                          </td>
                          <td>{dateTime(record.created_at)}</td>
                          <td>
                            <Button variant="destructive" onClick={() => setTarget(record)}>
                              Завершить
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {target && (
        <Sheet
          title="Завершить сеанс?"
          onClose={() => {
            if (!revoke.isPending) setTarget(null);
          }}
          footer={
            <>
              <Button disabled={revoke.isPending} onClick={() => setTarget(null)}>
                Отмена
              </Button>
              <Button variant="destructive" disabled={revoke.isPending} onClick={() => revoke.mutate()}>
                {revoke.isPending ? "Завершаем…" : "Завершить"}
              </Button>
            </>
          }
        >
          <p>
            {target === "others"
              ? "На других устройствах вашего аккаунта потребуется повторный вход. Сеансы сотрудников сохранятся."
              : `На устройстве «${browserOf(target.device)} · ${platformOf(target.device)}» потребуется снова ввести логин и пароль.`}
          </p>
          {revoke.isError && <ErrorState error={revoke.error} />}
        </Sheet>
      )}
    </div>
  );
}
