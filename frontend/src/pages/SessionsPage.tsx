import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { systemApi, type DeviceSession, type SessionBulkRevokeInput, type SessionRevokeScope } from "../api/system";
import type { Role } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { GlassSurface } from "../components/GlassSurface";
import { DisplayIcon, PhoneIcon } from "../components/icons";
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, KPI, Select, Skeleton } from "../components/ui";
import { dateTime, parseTimestamp, plural, ROLE_LABELS } from "../utils/format";
import "./workflow.css";
import "./sessions.css";

/** Строка User-Agent целиком нечитаема, а различать сеансы надо по браузеру и системе. */
export function browserOf(agent: string) {
  if (/Edg\//.test(agent)) return "Edge";
  if (/YaBrowser\//.test(agent)) return "Яндекс Браузер";
  if (/OPR\//.test(agent)) return "Opera";
  if (/SamsungBrowser\//.test(agent)) return "Samsung Internet";
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
/** Сколько устройств сотрудника видно сразу; остальные — по «Показать ещё». */
const FOLDED = 3;

export function isPhone(agent: string) {
  return MOBILE.has(platformOf(agent));
}

/** Одна строка на устройство: «Chrome · Windows», без пустых «Браузер · Другое». */
export function deviceName(agent: string) {
  const browser = browserOf(agent), platform = platformOf(agent);
  if (browser === "Браузер" && platform === "Другое") return "Неизвестное устройство";
  return platform === "Другое" ? browser : `${browser} · ${platform}`;
}

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
  role?: string;
  platform: string;
  freshness: string;
  search: string;
  sort: SortKey;
}

/**
 * Отбор и порядок строк. Вынесено из компонента намеренно: это единственное
 * место, где экран может соврать — показать сеанс не той роли или потерять
 * строку из-за регистра в поиске. Внутри useMemo такую логику не проверить.
 */
export function filterSessions(sessions: DeviceSession[], f: SessionFilters, now = Date.now()): DeviceSession[] {
  const needle = f.search.trim().toLowerCase();
  const rows = sessions.filter((s) => {
    if (f.role && s.role !== f.role) return false;
    if (f.platform && platformOf(s.device) !== f.platform) return false;
    if (f.freshness && freshnessOf(s.last_active_at, now) !== f.freshness) return false;
    if (!needle) return true;
    // Поиск идёт и по адресу: при разборе подозрительного входа ищут именно IP.
    return [s.full_name, s.login, s.role, ROLE_LABELS[s.role], s.ip_address ?? "", deviceName(s.device)]
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

export interface SessionGroup {
  user_id: number;
  full_name: string;
  login: string;
  role: Role;
  sessions: DeviceSession[];
}

/**
 * Сеансы одного сотрудника вместе: человек — главная единица на экране,
 * устройства — его строки. Порядок людей задаёт уже отсортированный список:
 * сотрудник стоит там, где стоит его первый сеанс, и устройства внутри
 * идут в том же порядке.
 */
export function groupSessions(rows: DeviceSession[]): SessionGroup[] {
  const groups = new Map<number, SessionGroup>();
  for (const session of rows) {
    const group = groups.get(session.user_id)
      ?? { user_id: session.user_id, full_name: session.full_name, login: session.login, role: session.role, sessions: [] };
    group.sessions.push(session);
    groups.set(session.user_id, group);
  }
  return [...groups.values()];
}

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
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [platform, setPlatform] = useState("");
  const [freshness, setFreshness] = useState("");
  const [sort, setSort] = useState<SortKey>("active");
  const [unfolded, setUnfolded] = useState<number[]>([]);
  const [notice, setNotice] = useState("");

  const sessions = useMemo(() => data.data ?? [], [data.data]);
  const platforms = useMemo(
    () => [...new Set(sessions.map((session) => platformOf(session.device)))].sort((a, b) => a.localeCompare(b, "ru")),
    [sessions],
  );
  const visible = useMemo(
    () => filterSessions(sessions, { role, platform, freshness, search, sort }),
    [sessions, role, platform, freshness, search, sort],
  );
  const groups = useMemo(() => groupSessions(visible), [visible]);
  const chosen = selectedSessions(visible, selected);
  const allVisibleSelected = visible.length > 0 && chosen.length === visible.length;
  const summary = target ? revocationSummary(target, keepCurrent) : null;
  const filtered = Boolean(search || role || platform || freshness);
  const current = sessions.find((session) => session.current);
  const myOthers = sessions.filter((session) => session.user_id === user?.id && !session.current);
  const stale = useMemo(() => sessions.filter((session) => freshnessOf(session.last_active_at) === "stale"), [sessions]);
  const stats = useMemo(() => ({
    total: sessions.length,
    people: new Set(sessions.map((session) => session.user_id)).size,
    now: sessions.filter((session) => freshnessOf(session.last_active_at) === "now").length,
  }), [sessions]);
  const roleSessions = role ? sessions.filter((session) => session.role === role) : [];

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
    setRole("");
    setPlatform("");
    setFreshness("");
  }

  function confirm(next: SessionTarget) {
    revoke.reset();
    setKeepCurrent(true);
    setTarget(next);
  }

  function confirmUser(userId: number, name: string) {
    confirm(sessionTarget(sessions, "user", `Все устройства: ${name}`, { userId }));
  }

  function toggle(ids: string[], checked: boolean) {
    setSelected((previous) => checked ? [...new Set([...previous, ...ids])] : previous.filter((value) => !ids.includes(value)));
  }

  function device(record: DeviceSession) {
    const state = FRESHNESS[freshnessOf(record.last_active_at)];
    const name = deviceName(record.device);
    return <li key={record.id} className={`sessions-device${selected.includes(record.id) ? " is-selected" : ""}`}>
      <input className="sessions-checkbox" type="checkbox" aria-label={`Выбрать сеанс ${record.full_name}: ${name}, ${record.ip_address ?? "IP не записан"}`} checked={selected.includes(record.id)} onChange={(event) => toggle([record.id], event.target.checked)} disabled={revoke.isPending} />
      <span className="sessions-device__icon" aria-hidden="true">{isPhone(record.device) ? <PhoneIcon size={18} /> : <DisplayIcon size={18} />}</span>
      <div className="sessions-device__main">
        <div className="sessions-device__name"><strong>{name}</strong>{record.current && <Badge tone="success">Это устройство</Badge>}</div>
        <span>{record.ip_address ?? "IP не записан"} · вход {dateTime(record.created_at)}</span>
      </div>
      <div className="sessions-device__activity"><Badge tone={state.tone}>{state.label}</Badge><span>{relative(record.last_active_at)}</span></div>
      <Button className="sessions-device__end" size="s" variant="plain" disabled={revoke.isPending} onClick={() => confirm(sessionTarget(sessions, "selected", `Завершить сеанс: ${record.full_name}`, { ids: [record.id] }))}>Завершить</Button>
    </li>;
  }

  function person(group: SessionGroup) {
    const ids = group.sessions.map((session) => session.id);
    const picked = ids.filter((id) => selected.includes(id)).length;
    const open = unfolded.includes(group.user_id);
    const latest = group.sessions.reduce((a, b) => parseTimestamp(a.last_active_at) >= parseTimestamp(b.last_active_at) ? a : b);
    const state = FRESHNESS[freshnessOf(latest.last_active_at)];
    const count = group.sessions.length;
    return <article key={group.user_id} className="sessions-person">
      <header className="sessions-person__head">
        <input className="sessions-checkbox" type="checkbox" aria-label={`Выбрать все показанные сеансы: ${group.full_name}`} checked={picked === count} ref={(input) => { if (input) input.indeterminate = picked > 0 && picked < count; }} onChange={(event) => { toggle(ids, event.target.checked); if (event.target.checked && count > FOLDED && !open) setUnfolded((list) => [...list, group.user_id]); }} disabled={revoke.isPending} />
        <div className="cell-person"><Avatar name={group.full_name} id={group.user_id} size={36} /><span className="cell-person__text"><span className="cell-person__name">{group.full_name}{group.user_id === user?.id && <span className="sessions-you">Вы</span>}</span><span className="cell-person__meta">{group.login} · {ROLE_LABELS[group.role] ?? group.role}</span></span></div>
        <div className="sessions-person__summary"><span>{count} {plural(count, "устройство", "устройства", "устройств")}</span><Badge tone={state.tone} dot>{state.label}</Badge></div>
        <Button size="s" disabled={revoke.isPending} onClick={() => confirmUser(group.user_id, group.full_name)}>Выйти на всех устройствах</Button>
      </header>
      <ul className="sessions-devices">{(open ? group.sessions : group.sessions.slice(0, FOLDED)).map(device)}</ul>
      {count > FOLDED && <button type="button" className="sessions-more" aria-expanded={open} onClick={() => setUnfolded((list) => open ? list.filter((id) => id !== group.user_id) : [...list, group.user_id])}>{open ? "Свернуть" : `Показать ещё ${count - FOLDED} ${plural(count - FOLDED, "устройство", "устройства", "устройств")}`}</button>}
    </article>;
  }

  const canSubmit = summary != null && summary.count > 0 && (target?.sessions.length ?? 0) <= 5000;

  return (
    <div className="stack sessions-page">
      <div className="page-head">
        <div><h1 className="page-title">Сессии и устройства</h1><p className="page-subtitle">{data.data ? `${stats.total} ${plural(stats.total, "активный сеанс", "активных сеанса", "активных сеансов")} у ${stats.people} ${plural(stats.people, "сотрудника", "сотрудников", "сотрудников")}` : "Кто вошёл в Puls и с каких устройств"}</p></div>
        <div className="page-head__actions"><Button disabled={data.isFetching || revoke.isPending} onClick={() => void data.refetch()}>{data.isFetching ? "Обновляем…" : "Обновить"}</Button></div>
      </div>

      {notice && <p className="sessions-notice" role="status">{notice}</p>}
      {data.isLoading && <Skeleton height={220} />}
      {data.isError && <ErrorState error={data.error} onRetry={() => void data.refetch()} />}

      {data.data && <>
        {current && <Card className="sessions-me">
          <div className="sessions-me__row">
            <span className="sessions-me__icon" aria-hidden="true">{isPhone(current.device) ? <PhoneIcon /> : <DisplayIcon />}</span>
            <div className="sessions-me__text"><span>Вы вошли с этого устройства</span><strong>{deviceName(current.device)}</strong><small>{current.ip_address ?? "IP не записан"} · вход {dateTime(current.created_at)}</small></div>
            <div className="sessions-me__action"><span>{myOthers.length ? `Ещё ${myOthers.length} ${plural(myOthers.length, "ваш сеанс", "ваших сеанса", "ваших сеансов")} на других устройствах` : "Других ваших сеансов нет"}</span>
              <Button disabled={revoke.isPending || myOthers.length === 0} onClick={() => confirm(sessionTarget(sessions.filter((session) => !session.current), "user", "Завершить мои другие сеансы", { userId: user?.id }))}>Выйти на других устройствах</Button></div>
          </div>
        </Card>}

        <div className="kpi-grid">
          <KPI label="Активных сеансов" value={stats.total} />
          <KPI label="Сотрудников" value={stats.people} hint="У одного человека может быть несколько устройств" />
          <KPI label="В сети сейчас" value={stats.now} hint="Активность за последние 5 минут" />
          <KPI label="Без активности неделю" value={stale.length} tone={stale.length ? "accent" : "neutral"} hint="Такие сеансы стоит проверить" />
        </div>

        {stale.length > 0 && freshness !== "stale" && <div className="sessions-attention" role="note">
          <p><strong>{stale.length} {plural(stale.length, "сеанс", "сеанса", "сеансов")} без активности больше недели.</strong> Скорее всего, это забытые входы на чужих или старых устройствах.</p>
          <div className="sessions-attention__actions"><Button size="s" onClick={() => changeFilter(setFreshness, "stale")}>Показать</Button><Button size="s" variant="destructive" disabled={revoke.isPending} onClick={() => confirm(sessionTarget(sessions, "selected", "Завершить сеансы без активности больше недели", { ids: stale.map((session) => session.id) }))}>Завершить их</Button></div>
        </div>}

        <GlassSurface variant="regular" className="team-filterbar sessions-filterbar">
          <label className="field team-search"><span className="field__label">Поиск</span><input className="input" type="search" value={search} placeholder="Имя, логин, IP или устройство" onChange={(event) => changeFilter(setSearch, event.target.value)} /></label>
          <label className="field"><span className="field__label">Роль</span><Select aria-label="Роль" value={role} onChange={(value) => changeFilter(setRole, value)} options={[{ value: "", label: "Все роли" }, ...Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }))]} /></label>
          <label className="field"><span className="field__label">Платформа</span><Select aria-label="Платформа" value={platform} onChange={(value) => changeFilter(setPlatform, value)} options={[{ value: "", label: "Любая" }, ...platforms.map((name) => ({ value: name, label: name }))]} /></label>
          <label className="field"><span className="field__label">Активность</span><Select aria-label="Активность" value={freshness} onChange={(value) => changeFilter(setFreshness, value)} options={[{ value: "", label: "Любая" }, ...Object.entries(FRESHNESS).map(([value, item]) => ({ value, label: item.label }))]} /></label>
          <label className="field"><span className="field__label">Сортировка</span><Select aria-label="Сортировка" value={sort} onChange={(value) => changeFilter(setSort, SORTS.some((item) => item.value === value) ? value as SortKey : "active")} options={SORTS} /></label>
          {filtered && <Button className="sessions-filterbar__reset" variant="plain" size="s" onClick={reset}>Сбросить фильтры</Button>}
        </GlassSurface>

        {sessions.length === 0 ? <EmptyState title="Активных сессий нет" hint="Никто не вошёл в систему с действующим сеансом." /> : visible.length === 0 ? <EmptyState title="Под фильтры ничего не попало" hint="Снимите часть условий, чтобы увидеть остальные сеансы." action={<Button onClick={reset}>Сбросить фильтры</Button>} />
        : <Card className="sessions-list" padded={false} title="Сотрудники и устройства" subtitle={filtered ? `Показано ${visible.length} из ${sessions.length} сеансов · ${groups.length} ${plural(groups.length, "сотрудник", "сотрудника", "сотрудников")}` : `${groups.length} ${plural(groups.length, "сотрудник", "сотрудника", "сотрудников")} · ${visible.length} ${plural(visible.length, "сеанс", "сеанса", "сеансов")}`}
          action={<div className="sessions-list__actions">
            {role && <Button size="s" disabled={revoke.isPending || roleSessions.length === 0} onClick={() => confirm(sessionTarget(sessions, "role", `Все сеансы роли «${ROLE_LABELS[role]}»`, { role: role as Role }))}>Завершить сеансы роли «{ROLE_LABELS[role]}» ({roleSessions.length})</Button>}
            {filtered && <Button size="s" disabled={revoke.isPending} onClick={() => confirm(sessionTarget(visible, "selected", "Завершить все показанные сеансы", { ids: visible.map((session) => session.id) }))}>Завершить показанные ({visible.length})</Button>}
          </div>}>
          <div className="sessions-list__select"><label className="sessions-check"><input className="sessions-checkbox" type="checkbox" checked={allVisibleSelected} ref={(input) => { if (input) input.indeterminate = chosen.length > 0 && !allVisibleSelected; }} onChange={(event) => setSelected(event.target.checked ? visible.map((session) => session.id) : [])} disabled={revoke.isPending} />Выбрать все показанные ({visible.length})</label></div>
          <div className="sessions-people">{groups.map(person)}</div>
        </Card>}

        {chosen.length > 0 && <GlassSurface variant="prominent" className="sessions-selection" role="region" aria-label="Выбранные сеансы">
          <span role="status">Выбрано: {chosen.length} {plural(chosen.length, "сеанс", "сеанса", "сеансов")} · {new Set(chosen.map((session) => session.user_id)).size} {plural(new Set(chosen.map((session) => session.user_id)).size, "сотрудник", "сотрудника", "сотрудников")}</span>
          <div className="sessions-selection__actions"><Button size="s" variant="plain" disabled={revoke.isPending} onClick={() => setSelected([])}>Снять выбор</Button><Button size="s" variant="destructive" disabled={revoke.isPending} onClick={() => confirm(sessionTarget(visible, "selected", "Завершить выбранные сеансы", { ids: chosen.map((session) => session.id) }))}>Завершить ({chosen.length})</Button></div>
        </GlassSurface>}

        {sessions.length > 0 && <Card className="sessions-danger" title="Завершить все сеансы" subtitle="Все сотрудники выйдут на всех устройствах и войдут заново со своими учётными данными. Ваш текущий сеанс по умолчанию сохраняется."
          action={<Button variant="destructive" disabled={revoke.isPending} onClick={() => confirm(sessionTarget(sessions, "all", "Завершить все сеансы"))}>Завершить все ({sessions.length})</Button>}><p className="sessions-refresh-note">Список обновляется каждые 30 секунд и при возвращении на страницу. Завершение сеанса требует повторного входа; аккаунт и устройство не блокируются.</p></Card>}
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
        <ul className="sessions-confirm-list">{summary.sessions.slice(0, 30).map((session) => <li key={session.id}><strong>{session.full_name}</strong><span>{session.login} · {ROLE_LABELS[session.role]} · {deviceName(session.device)} · {session.ip_address ?? "IP не записан"}{session.current ? " · Текущий сеанс" : ""}</span></li>)}</ul>
        {summary.count > 30 && <p className="secondary">И ещё {summary.count - 30} сеансов.</p>}
        <p className="workflow-note">Будут завершены только сеансы из этого подтверждения. Новые входы не затрагиваются.</p>
        {revoke.isError && <ErrorState error={revoke.error} />}
      </Sheet>}
    </div>
  );
}
