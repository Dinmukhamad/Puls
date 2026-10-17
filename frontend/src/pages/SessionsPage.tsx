import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { systemApi, type DeviceSession, type SessionBulkRevokeInput, type SessionRevokeScope } from "../api/system";
import type { Role } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { Badge, Button, Card, EmptyState, ErrorState, KPI, Select, Skeleton, SegmentedControl } from "../components/ui";
import { dateTime, parseTimestamp, plural, ROLE_LABELS } from "../utils/format";
import "./workflow.css";
import "./sessions.css";

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
  role?: string;
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
    if (f.role && s.role !== f.role) return false;
    if (f.platform && platformOf(s.device) !== f.platform) return false;
    if (f.freshness && freshnessOf(s.last_active_at, now) !== f.freshness) return false;
    if (!needle) return true;
    // Поиск идёт и по адресу: при разборе подозрительного входа ищут именно IP.
    return [s.full_name, s.login, s.role, ROLE_LABELS[s.role], s.ip_address ?? "", browserOf(s.device), platformOf(s.device)]
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
const SORTS: { value: SortKey; label: string }[] = [
  { value: "active", label: "Сначала активные" },
  { value: "created", label: "Сначала новые входы" },
  { value: "name", label: "По имени" },
];

export interface SessionTarget {
  title: string;
  scope: SessionRevokeScope;
  sessions: DeviceSession[];
  userId?: number;
  role?: Role;
}

/** Only visible, still-live rows can remain selected after refresh or filtering. */
export function selectedSessions(visible: DeviceSession[], selected: readonly string[]): DeviceSession[] {
  const ids = new Set(selected);
  return visible.filter((session) => ids.has(session.id));
}

/** A confirmation owns its snapshot: later refreshes/new logins cannot expand it. */
export function sessionTarget(
  sessions: DeviceSession[],
  scope: SessionRevokeScope,
  title: string,
  context: { userId?: number; role?: Role; ids?: readonly string[] } = {},
): SessionTarget {
  const ids = new Set(context.ids ?? []);
  const seen = new Set<string>();
  const rows = sessions.filter((session) => {
    if (seen.has(session.id)) return false;
    seen.add(session.id);
    if (scope === "user") return context.userId != null && session.user_id === context.userId;
    if (scope === "role") return context.role != null && session.role === context.role;
    if (scope === "selected") return ids.has(session.id);
    return true;
  }).map((session) => ({ ...session }));
  return {
    title, scope, sessions: rows,
    ...(scope === "user" ? { userId: context.userId } : {}),
    ...(scope === "role" ? { role: context.role } : {}),
  };
}

export function revocationSummary(target: SessionTarget, keepCurrent: boolean) {
  const sessions = target.sessions.filter((session) => !keepCurrent || !session.current);
  return { sessions, count: sessions.length, people: new Set(sessions.map((session) => session.user_id)).size };
}

export function bulkRequestFor(target: SessionTarget, keepCurrent: boolean): SessionBulkRevokeInput {
  return {
    scope: target.scope,
    session_ids: target.sessions.map((session) => session.id),
    keep_current: keepCurrent,
    ...(target.scope === "user" ? { user_id: target.userId } : {}),
    ...(target.scope === "role" ? { role: target.role } : {}),
  };
}

export function SessionsPage() {
  const data = useQuery({
    queryKey: ["sessions", "developer"],
    queryFn: () => systemApi.sessions(true),
    refetchOnWindowFocus: "always",
    refetchInterval: 30_000,
  });
  const client = useQueryClient();
  const toast = useToast();
  const { logout, user } = useAuth();
  const [target, setTarget] = useState<SessionTarget | null>(null);
  const [keepCurrent, setKeepCurrent] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [search, setSearch] = useState("");
  const [person, setPerson] = useState("");
  const [role, setRole] = useState("");
  const [platform, setPlatform] = useState("");
  const [freshness, setFreshness] = useState("");
  const [sort, setSort] = useState<SortKey>("active");
  const [notice, setNotice] = useState("");

  const sessions = useMemo(() => data.data ?? [], [data.data]);
  const people = useMemo(() => {
    const seen = new Map<number, DeviceSession>();
    for (const session of sessions) seen.set(session.user_id, session);
    return [...seen.values()].sort((a, b) => a.full_name.localeCompare(b.full_name, "ru"));
  }, [sessions]);
  const platforms = useMemo(
    () => [...new Set(sessions.map((session) => platformOf(session.device)))].sort((a, b) => a.localeCompare(b, "ru")),
    [sessions],
  );
  const visible = useMemo(
    () => filterSessions(sessions, { scope, person, role, platform, freshness, search, sort, meId: user?.id }),
    [sessions, scope, person, role, platform, freshness, search, sort, user?.id],
  );
  const chosen = selectedSessions(visible, selected);
  const allVisibleSelected = visible.length > 0 && chosen.length === visible.length;
  const selectedPerson = people.find((employee) => String(employee.user_id) === person);
  const summary = target ? revocationSummary(target, keepCurrent) : null;
  const filtered = Boolean(search || person || role || platform || freshness || scope === "mine");
  const stats = useMemo(() => ({
    total: sessions.length,
    people: new Set(sessions.map((session) => session.user_id)).size,
    mobile: sessions.filter((session) => MOBILE.has(platformOf(session.device))).length,
    stale: sessions.filter((session) => freshnessOf(session.last_active_at) === "stale").length,
  }), [sessions]);

  const revoke = useMutation({
    mutationFn: (body: SessionBulkRevokeInput) => systemApi.revokeBulk(body),
    onSuccess: (result) => {
      const message = `Завершено сеансов: ${result.revoked_count}. Сотрудников: ${result.user_count}.`;
      setTarget(null);
      setSelected([]);
      setNotice(message);
      toast.success(message);
      if (result.current_revoked) {
        void logout();
      } else {
        void client.invalidateQueries({ queryKey: ["sessions"] });
      }
    },
  });

  function changeFilter<T>(setter: (value: T) => void, value: T) {
    setSelected([]);
    setter(value);
  }

  function reset() {
    setSelected([]);
    setSearch("");
    setPerson("");
    setRole("");
    setPlatform("");
    setFreshness("");
    setScope("all");
  }

  function confirm(next: SessionTarget) {
    revoke.reset();
    setKeepCurrent(true);
    setTarget(next);
  }

  function confirmUser(userId: number, name: string) {
    confirm(sessionTarget(sessions, "user", `Все устройства: ${name}`, { userId }));
  }

  function toggleSession(id: string, checked: boolean) {
    setSelected((previous) => checked ? [...new Set([...previous, id])] : previous.filter((value) => value !== id));
  }

  function selectVisible(checked: boolean) {
    setSelected(checked ? visible.map((session) => session.id) : []);
  }

  function sessionIdentity(record: DeviceSession) {
    return <div className="sessions-identity"><strong>{record.full_name}</strong><span>{record.login} · {ROLE_LABELS[record.role] ?? record.role}</span>{record.current && <Badge tone="success">Текущая</Badge>}</div>;
  }

  function rowActions(record: DeviceSession) {
    return <div className="sessions-row-actions">
      <Button size="s" variant="destructive" disabled={revoke.isPending} onClick={() => confirm(sessionTarget(sessions, "selected", `Завершить сеанс: ${record.full_name}`, { ids: [record.id] }))}>Завершить</Button>
      <Button size="s" disabled={revoke.isPending} onClick={() => confirmUser(record.user_id, record.full_name)}>Все устройства</Button>
    </div>;
  }

  const canSubmit = summary != null && summary.count > 0 && (target?.sessions.length ?? 0) <= 5000;

  return (
    <div className="stack sessions-page">
      <div className="page-head">
        <div><h1 className="page-title">Сессии и устройства</h1><p className="page-subtitle">Управляйте входами одного сотрудника, роли или всей команды</p></div>
        <div className="workflow-actions">
          <Button disabled={data.isFetching || revoke.isPending} onClick={() => void data.refetch()}>{data.isFetching ? "Обновляем…" : "Обновить"}</Button>
          <Button disabled={revoke.isPending || !sessions.some((session) => session.user_id === user?.id && !session.current)} onClick={() => confirm(sessionTarget(sessions.filter((session) => !session.current), "user", "Завершить мои другие сеансы", { userId: user?.id }))}>Завершить мои другие сеансы</Button>
        </div>
      </div>

      {notice && <p className="sessions-notice" role="status">{notice}</p>}
      {data.isLoading && <Skeleton height={220} />}
      {data.isError && <ErrorState error={data.error} onRetry={() => void data.refetch()} />}

      {data.data && <>
        <div className="kpi-grid">
          <KPI label="Активных сеансов" value={stats.total} />
          <KPI label="Пользователей" value={stats.people} hint="У одного человека может быть несколько устройств" />
          <KPI label="С телефонов" value={stats.mobile} />
          <KPI label="Без активности неделю" value={stats.stale} tone={stats.stale ? "accent" : "neutral"} hint="Такие сеансы стоит проверить" />
        </div>

        <Card>
          <div className="sessions-filter-grid">
            <div className="field sessions-scope"><span className="field__label">Чьи сеансы</span><SegmentedControl value={scope} onChange={(value) => changeFilter(setScope, value)} options={[{ value: "all", label: "Все" }, { value: "mine", label: "Мои" }]} /></div>
            <label className="field sessions-search"><span className="field__label">Поиск</span><input className="input" type="search" value={search} placeholder="Имя, логин, роль, IP или устройство" onChange={(event) => changeFilter(setSearch, event.target.value)} /></label>
            <label className="field"><span className="field__label">Сотрудник</span><Select aria-label="Сотрудник" value={person} onChange={(value) => changeFilter(setPerson, value)} options={[{ value: "", label: "Все сотрудники" }, ...people.map((employee) => ({ value: employee.user_id, label: `${employee.full_name} · ${employee.login}` }))]} /></label>
            <label className="field"><span className="field__label">Роль</span><Select aria-label="Роль" value={role} onChange={(value) => changeFilter(setRole, value)} options={[{ value: "", label: "Все роли" }, ...Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }))]} /></label>
            <label className="field"><span className="field__label">Платформа</span><Select aria-label="Платформа" value={platform} onChange={(value) => changeFilter(setPlatform, value)} options={[{ value: "", label: "Любая" }, ...platforms.map((name) => ({ value: name, label: name }))]} /></label>
            <label className="field"><span className="field__label">Активность</span><Select aria-label="Активность" value={freshness} onChange={(value) => changeFilter(setFreshness, value)} options={[{ value: "", label: "Любая" }, ...Object.entries(FRESHNESS).map(([value, item]) => ({ value, label: item.label }))]} /></label>
            <label className="field"><span className="field__label">Сортировка</span><Select aria-label="Сортировка" value={sort} onChange={(value) => changeFilter(setSort, SORTS.some((item) => item.value === value) ? value as SortKey : "active")} options={SORTS} /></label>
            <Button disabled={!filtered} onClick={reset}>Сбросить</Button>
          </div>
        </Card>

        <Card title="Завершение по сотруднику или роли" subtitle="Эти действия охватывают все устройства выбранного сотрудника или роли, независимо от остальных фильтров.">
          <div className="sessions-bulk-actions">
            <Button disabled={!selectedPerson || revoke.isPending} onClick={() => selectedPerson && confirmUser(selectedPerson.user_id, selectedPerson.full_name)}>Все устройства сотрудника</Button>
            <Button disabled={!role || revoke.isPending || !sessions.some((session) => session.role === role)} onClick={() => confirm(sessionTarget(sessions, "role", `Все сеансы роли «${ROLE_LABELS[role]}»`, { role: role as Role }))}>Все сеансы роли{role ? `: ${ROLE_LABELS[role]}` : ""}</Button>
            <Button variant="destructive" disabled={sessions.length === 0 || revoke.isPending} onClick={() => confirm(sessionTarget(sessions, "all", "Завершить все сеансы"))}>Завершить все сеансы</Button>
          </div>
          <p className="workflow-note">Для действия по сотруднику или роли выберите их в фильтрах выше. Завершение сеанса требует повторного входа; аккаунт и устройство не блокируются.</p>
        </Card>

        {sessions.length === 0 ? <EmptyState title="Активных сессий нет" hint="Никто не вошёл в систему с действующим сеансом." /> : visible.length === 0 ? <EmptyState title="Под фильтры ничего не попало" hint="Снимите часть условий, чтобы увидеть остальные сеансы." action={<Button onClick={reset}>Сбросить фильтры</Button>} /> : <Card title="Сеансы" subtitle={filtered ? `Показано ${visible.length} из ${sessions.length}` : `${sessions.length} ${plural(sessions.length, "сеанс", "сеанса", "сеансов")}`}>
          <div className="sessions-selection">
            <label className="sessions-check"><input type="checkbox" checked={allVisibleSelected} ref={(input) => { if (input) input.indeterminate = chosen.length > 0 && !allVisibleSelected; }} onChange={(event) => selectVisible(event.target.checked)} disabled={revoke.isPending} />Выбрать все показанные ({visible.length})</label>
            <span className="secondary" role="status">Выбрано: {chosen.length}</span>
            <div className="workflow-actions">
              <Button variant="destructive" disabled={chosen.length === 0 || revoke.isPending} onClick={() => confirm(sessionTarget(visible, "selected", "Завершить выбранные сеансы", { ids: chosen.map((session) => session.id) }))}>Завершить выбранные ({chosen.length})</Button>
              <Button disabled={revoke.isPending} onClick={() => confirm(sessionTarget(visible, "selected", "Завершить все показанные сеансы", { ids: visible.map((session) => session.id) }))}>Завершить показанные ({visible.length})</Button>
            </div>
          </div>
          <div className="table-wrap sessions-desktop">
            <table className="table sessions-table">
              <thead><tr><th aria-label="Выбор" /><th>Сотрудник</th><th>Устройство</th><th>IP-адрес</th><th>Последняя активность</th><th>Вход</th><th aria-label="Действия" /></tr></thead>
              <tbody>{visible.map((record) => {
                const state = FRESHNESS[freshnessOf(record.last_active_at)];
                return <tr key={record.id} className={selected.includes(record.id) ? "sessions-row-selected" : undefined}>
                  <td><input className="sessions-checkbox" type="checkbox" aria-label={`Выбрать сеанс ${record.full_name}: ${browserOf(record.device)} · ${platformOf(record.device)}, ${record.ip_address ?? "IP не записан"}`} checked={selected.includes(record.id)} onChange={(event) => toggleSession(record.id, event.target.checked)} disabled={revoke.isPending} /></td>
                  <td>{sessionIdentity(record)}</td><td>{browserOf(record.device)} · {platformOf(record.device)}</td><td>{record.ip_address ?? "Не записан"}</td>
                  <td><Badge tone={state.tone}>{state.label}</Badge><div className="secondary">{relative(record.last_active_at)}</div></td><td>{dateTime(record.created_at)}</td><td>{rowActions(record)}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          <div className="sessions-mobile">{visible.map((record) => {
            const state = FRESHNESS[freshnessOf(record.last_active_at)];
            return <article key={record.id} className={`sessions-device-card${selected.includes(record.id) ? " sessions-row-selected" : ""}`}>
              <div className="sessions-device-head"><label className="sessions-check"><input type="checkbox" aria-label={`Выбрать сеанс ${record.full_name}: ${browserOf(record.device)} · ${platformOf(record.device)}, ${record.ip_address ?? "IP не записан"}`} checked={selected.includes(record.id)} onChange={(event) => toggleSession(record.id, event.target.checked)} disabled={revoke.isPending} />{sessionIdentity(record)}</label></div>
              <dl className="sessions-device-details"><div><dt>Устройство</dt><dd>{browserOf(record.device)} · {platformOf(record.device)}</dd></div><div><dt>IP-адрес</dt><dd>{record.ip_address ?? "Не записан"}</dd></div><div><dt>Активность</dt><dd><Badge tone={state.tone}>{state.label}</Badge> {relative(record.last_active_at)}</dd></div><div><dt>Вход</dt><dd>{dateTime(record.created_at)}</dd></div></dl>
              {rowActions(record)}
            </article>;
          })}</div>
        </Card>}
        <p className="sessions-refresh-note">Список обновляется каждые 30 секунд и при возвращении на страницу.</p>
      </>}

      {target && summary && <Sheet title={target.title} subtitle="Подтвердите завершение сеансов" onClose={() => { if (!revoke.isPending) setTarget(null); }} footer={<>
        <Button disabled={revoke.isPending} onClick={() => setTarget(null)}>Отмена</Button>
        <Button variant="destructive" disabled={revoke.isPending || !canSubmit} onClick={() => revoke.mutate(bulkRequestFor(target, keepCurrent))}>{revoke.isPending ? "Завершаем…" : `Завершить (${summary.count})`}</Button>
      </>}>
        <div className="sessions-confirm-stats"><div><strong>{summary.count}</strong><span>{plural(summary.count, "сеанс", "сеанса", "сеансов")}</span></div><div><strong>{summary.people}</strong><span>{plural(summary.people, "сотрудник", "сотрудника", "сотрудников")}</span></div></div>
        <p>На этих устройствах потребуется повторный вход. Сотрудники смогут снова войти со своими учётными данными.</p>
        {target.sessions.some((session) => session.current) && <>
          <label className="sessions-keep-current"><input type="checkbox" checked={keepCurrent} disabled={revoke.isPending} onChange={(event) => setKeepCurrent(event.target.checked)} /><span><strong>Сохранить мой текущий сеанс</strong><small>Оставить вход в этом браузере активным</small></span></label>
          {!keepCurrent && <p className="workflow-error" role="alert">Ваш текущий сеанс тоже будет завершён. После подтверждения потребуется войти заново.</p>}
          {keepCurrent && summary.count === 0 && <p className="workflow-note">Выбран только текущий сеанс. Чтобы завершить его, снимите отметку выше.</p>}
        </>}
        {target.sessions.length > 5000 && <p className="workflow-error" role="alert">За одно действие можно завершить до 5000 сеансов. Закройте окно и сузьте выбор.</p>}
        <ul className="sessions-confirm-list">{summary.sessions.slice(0, 30).map((session) => <li key={session.id}><strong>{session.full_name}</strong><span>{session.login} · {ROLE_LABELS[session.role]} · {browserOf(session.device)} · {platformOf(session.device)} · {session.ip_address ?? "IP не записан"}{session.current ? " · Текущий сеанс" : ""}</span></li>)}</ul>
        {summary.count > 30 && <p className="secondary">И ещё {summary.count - 30} сеансов.</p>}
        <p className="workflow-note">Будут завершены только сеансы из этого подтверждения. Новые входы не затрагиваются.</p>
        {revoke.isError && <ErrorState error={revoke.error} />}
      </Sheet>}
    </div>
  );
}
