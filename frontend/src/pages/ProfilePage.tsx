import { lazy, Suspense, useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { auth } from "../api/endpoints";
import { useAccess } from "../auth/AccessContext";
import { useAuth } from "../auth/AuthContext";
import { DisplayIcon, LogoutIcon, MoonIcon, SunIcon, UserIcon, LockIcon, DownloadIcon } from "../components/icons";
import { Avatar, Badge, Button } from "../components/ui";
import { AvatarEditor } from "../components/AvatarEditor";
import { useTheme, type ThemePreference } from "../theme/ThemeContext";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { PwaInstallCard } from "../pwa/PwaProvider";
import { ROLE_LABELS, dateOnly } from "../utils/format";
import "./profile.css";

const TelegramCard = lazy(() => import("../components/TelegramCard").then((module) => ({ default: module.TelegramCard })));

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: (props: { size?: number }) => JSX.Element }[] = [
  { value: "system", label: "Система", icon: DisplayIcon },
  { value: "light", label: "Светлая", icon: SunIcon },
  { value: "dark", label: "Тёмная", icon: MoonIcon },
];

export function ProfilePage() {
  const { user, logout } = useAuth();
  const { can, isDeveloper } = useAccess();
  const { preference, setPreference } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);
  const panel = location.hash.slice(1);
  const panelTriggers = useRef<Record<string, HTMLElement | null>>({});
  const open = (name: string) => navigate({ pathname: location.pathname, search: location.search, hash: `#${name}` }, { replace: true, preventScrollReset: true });
  const close = () => {
    const target = panelTriggers.current[panel];
    navigate({ pathname: location.pathname, search: location.search, hash: "" }, { replace: true, preventScrollReset: true });
    requestAnimationFrame(() => target?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true }));
  };
  if (!user) return null;
  const fields = [
    { label: "Имя", value: user.full_name },
    { label: "Логин", value: user.login },
    { label: "Роль", value: ROLE_LABELS[user.role] },
    { label: "Телефон", value: user.phone || "Не указан" },
    ...(user.email ? [{ label: "Электронная почта", value: user.email }] : []),
    ...(user.group ? [{ label: "Группа", value: user.group.name }] : []),
    ...(user.hired_on ? [{ label: "В компании с", value: dateOnly(user.hired_on) }] : []),
  ];
  return <div className="profile-page">
    <header className="profile-heading"><h1 className="page-title">Профиль</h1><p>Ваш аккаунт, связь и настройки</p></header>
    <section ref={node => { panelTriggers.current.details = node; }} className="profile-identity" aria-label="Ваш аккаунт">
      <Avatar name={user.full_name} id={user.id} size={52} />
      <div className="profile-identity__text"><h2>{user.full_name}</h2><p>{isDeveloper ? "Разработчик Puls" : ROLE_LABELS[user.role]}{user.group ? ` · ${user.group.name}` : ""}</p><Badge tone={user.is_active ? "success" : "neutral"} dot>{user.is_active ? "Аккаунт активен" : "Аккаунт отключён"}</Badge></div>
      <Button size="s" onClick={() => open("details")}>Мои данные</Button>
    </section>

    <div className="profile-columns">
    <section className="profile-section" aria-labelledby="profile-account-title">
      <h2 id="profile-account-title">Аккаунт и безопасность</h2>
      <div className="profile-settings">
        <div ref={node => { panelTriggers.current.avatar = node; }} className="profile-setting"><Avatar name={user.full_name} id={user.id} size={32} /><div className="profile-setting__text"><h3>Фото профиля</h3><p>Будет видно коллегам на сайте</p></div><Button size="s" aria-label="Изменить фото профиля" onClick={() => open("avatar")}>Изменить фото</Button></div>
        <div className="profile-setting"><span className="profile-setting__icon"><UserIcon /></span><div className="profile-setting__text"><h3>Данные сотрудника</h3><p>{[user.phone, user.email].filter(Boolean).join(" · ") || "Контакты не указаны"}</p></div></div>
        <div ref={node => { panelTriggers.current.login = node; }} className="profile-setting"><span className="profile-setting__icon"><UserIcon /></span><div className="profile-setting__text"><h3>Логин</h3><p>{user.login}</p></div><Button size="s" aria-label="Изменить логин" onClick={() => open("login")}>Изменить</Button></div>
        <div ref={node => { panelTriggers.current.password = node; }} className="profile-setting"><span className="profile-setting__icon"><LockIcon /></span><div className="profile-setting__text"><h3>Пароль</h3><p>Безопасность входа</p></div><Button size="s" aria-label="Изменить пароль" onClick={() => open("password")}>Изменить</Button></div>
      </div>
    </section>

    <section className="profile-section" aria-labelledby="profile-preferences-title">
      <h2 id="profile-preferences-title">Связь и настройки</h2>
      <div className="profile-settings">
        <Suspense fallback={<div className="profile-setting"><div className="profile-setting__text"><h3>Telegram</h3><p role="status">Проверяем подключение…</p></div></div>}><TelegramCard /></Suspense>
        <div className="profile-setting profile-setting--theme"><span className="profile-setting__icon"><DisplayIcon /></span><div className="profile-setting__text"><h3>Оформление</h3><p>{preference === "system" ? "Как на устройстве" : preference === "light" ? "Светлая тема" : "Тёмная тема"}</p></div>
          <div className="profile-theme" role="radiogroup" aria-label="Тема оформления">{THEME_OPTIONS.map((option) => <button key={option.value} type="button" role="radio" aria-label={option.label} title={option.label} aria-checked={preference === option.value} tabIndex={preference === option.value ? 0 : -1} onClick={() => setPreference(option.value)} onKeyDown={(event) => {
            const index = THEME_OPTIONS.indexOf(option);
            let next = index;
            if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % THEME_OPTIONS.length;
            else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index + THEME_OPTIONS.length - 1) % THEME_OPTIONS.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = THEME_OPTIONS.length - 1;
            else return;
            event.preventDefault();
            event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
            setPreference(THEME_OPTIONS[next].value);
          }}><option.icon size={17} /><span>{option.label}</span></button>)}</div>
        </div>
        <div ref={node => { panelTriggers.current["app-updates"] = node; }} className="profile-setting"><span className="profile-setting__icon"><DownloadIcon /></span><div className="profile-setting__text"><h3>Приложение Puls</h3><p>{user.role === "admin" ? "Установка и обновления" : "Быстрый доступ с устройства"}</p></div><Button size="s" aria-label="Открыть настройки приложения" onClick={() => open("app-updates")}>Открыть</Button></div>
      </div>
    </section>
    </div>

    <footer className="profile-footer"><div><strong>Выход из аккаунта</strong><p>Завершить сеанс на этом устройстве</p></div><Button size="s" variant="destructive" icon={<LogoutIcon size={16} />} disabled={leaving} onClick={() => { setLeaving(true); void logout(); }}>{leaving ? "Выходим…" : "Выйти из аккаунта"}</Button></footer>
    {panel === "details" && <Sheet title="Мои данные" size="s" onClose={close}><dl className="profile-details">{fields.map(field => <div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>{can("team") && user.role === "admin" ? <Link className="btn btn--secondary btn--s" to={`/admin/users/${user.id}`}>Изменить данные</Link> : <p className="profile-details__hint">Чтобы изменить имя или контакты, обратитесь к руководителю.</p>}</Sheet>}
    {panel === "avatar" && <AvatarEditor userId={user.id} name={user.full_name} onClose={close} />}
    {panel === "login" && <LoginSheet current={user.login} onClose={close} />}
    {panel === "password" && <PasswordSheet onClose={close} />}
    {panel === "app-updates" && <Sheet title="Приложение Puls" size="s" onClose={close}><PwaInstallCard embedded /></Sheet>}
  </div>;
}

function LoginSheet({ current, onClose }: { current: string; onClose: () => void }) {
  const formId = useId();
  const fieldId = useId();
  const passwordId = useId();
  const errorId = useId();
  const [value, setValue] = useState(current);
  const [currentPassword, setCurrentPassword] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const { applyProfile } = useAuth();
  const toast = useToast();

  const mutation = useMutation({
    mutationFn: () => auth.changeLogin(value.trim(), currentPassword),
    onSuccess: (profile) => {
      // Контекст держит профиль, иначе шапка осталась бы со старым логином.
      applyProfile(profile);
      toast.success(`Логин изменён на «${profile.login}». Входите с ним в следующий раз.`);
      onClose();
    },
  });

  const error = validationError || (mutation.error instanceof Error ? mutation.error.message : null);
  const trimmed = value.trim();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (mutation.isPending) return;
    setValidationError(null);
    if (trimmed === current) {
      setValidationError("Новый логин совпадает с текущим.");
      return;
    }
    mutation.mutate();
  }

  return (
    <Sheet
      title="Изменить логин"
      subtitle="Под новым логином вы будете входить в следующий раз."
      size="s"
      onClose={() => { if (!mutation.isPending) onClose(); }}
      footer={<>
        <Button disabled={mutation.isPending} onClick={onClose}>Отмена</Button>
        <Button type="submit" form={formId} variant="primary" disabled={mutation.isPending || !trimmed}>
          {mutation.isPending ? "Сохраняем…" : "Сохранить логин"}
        </Button>
      </>}
    >
      <form id={formId} onSubmit={submit} className="stack stack--tight" aria-describedby={error ? errorId : undefined}>
        <div className="field">
          <label className="field__label" htmlFor={fieldId}>Новый логин</label>
          <input
            id={fieldId}
            className="input"
            autoComplete="username"
            minLength={3}
            maxLength={150}
            required
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={mutation.isPending}
            aria-invalid={validationError ? true : undefined}
          />
          <span className="field__note">Латиница, цифры и символы . _ - @ Без пробелов.</span>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={passwordId}>Текущий пароль</label>
          <input
            id={passwordId}
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            disabled={mutation.isPending}
          />
          <span className="field__note">Подтверждает, что аккаунт меняете вы.</span>
        </div>
        {error && <p className="field__error" id={errorId} role="alert">{error}</p>}
      </form>
    </Sheet>
  );
}

function PasswordSheet({ onClose }: { onClose: () => void }) {
  const formId = useId();
  const currentId = useId();
  const newId = useId();
  const confirmId = useId();
  const errorId = useId();
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: () => auth.changePassword(currentPassword, password),
    onSuccess: (result) => {
      setCurrentPassword("");
      setPassword("");
      setConfirmation("");
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      toast.success(result.detail);
      onClose();
    },
  });
  const error = validationError || (mutation.error instanceof Error ? mutation.error.message : null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (mutation.isPending) return;
    setValidationError(null);
    if (password !== confirmation) {
      setValidationError("Новый пароль и подтверждение не совпадают.");
      return;
    }
    if (password === currentPassword) {
      setValidationError("Новый пароль должен отличаться от текущего.");
      return;
    }
    mutation.mutate();
  }

  return (
    <Sheet title="Изменить пароль" subtitle="После смены пароля остальные сеансы будут завершены." size="s" onClose={() => { if (!mutation.isPending) onClose(); }} footer={<>
      <Button disabled={mutation.isPending} onClick={onClose}>Отмена</Button>
      <Button type="submit" form={formId} variant="primary" disabled={mutation.isPending}>{mutation.isPending ? "Сохраняем…" : "Сохранить пароль"}</Button>
    </>}>
      <form id={formId} onSubmit={submit} className="stack stack--tight" aria-describedby={error ? errorId : undefined}>
        <div className="field">
          <label className="field__label" htmlFor={currentId}>Текущий пароль</label>
          <input id={currentId} className="input" type={showPassword ? "text" : "password"} autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} disabled={mutation.isPending} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={newId}>Новый пароль</label>
          <input id={newId} className="input" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} disabled={mutation.isPending} />
          <span className="field__note">Не менее 8 символов.</span>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={confirmId}>Повторите новый пароль</label>
          <input id={confirmId} className="input" type={showPassword ? "text" : "password"} autoComplete="new-password" required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={mutation.isPending} aria-invalid={validationError ? true : undefined} />
        </div>
        <Button size="s" aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Скрыть пароли" : "Показать пароли"}</Button>
        {error && <p className="field__error" id={errorId} role="alert">{error}</p>}
      </form>
    </Sheet>
  );
}
