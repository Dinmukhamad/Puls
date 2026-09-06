import { useId, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { auth } from "../api/endpoints";
import { useAccess } from "../auth/AccessContext";
import { useAuth } from "../auth/AuthContext";
import { DisplayIcon, LogoutIcon, MoonIcon, SunIcon } from "../components/icons";
import { Avatar, Badge, Button, Card } from "../components/ui";
import { useTheme, type ThemePreference } from "../theme/ThemeContext";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { PwaInstallCard } from "../pwa/PwaProvider";
import { ROLE_LABELS, dateOnly } from "../utils/format";
import "./profile.css";

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: (props: { size?: number }) => JSX.Element }[] = [
  { value: "system", label: "Система", icon: DisplayIcon },
  { value: "light", label: "Светлая", icon: SunIcon },
  { value: "dark", label: "Тёмная", icon: MoonIcon },
];

export function ProfilePage() {
  const { user, logout, atLeast } = useAuth();
  const { can, isDeveloper } = useAccess();
  const { preference, setPreference } = useTheme();
  const [securityOpen, setSecurityOpen] = useState(false);
  if (!user) return null;
  const fields = [
    { label: "Логин", value: user.login },
    { label: "Роль", value: ROLE_LABELS[user.role] },
    ...(user.email ? [{ label: "Электронная почта", value: user.email }] : []),
    ...(user.group ? [{ label: "Группа", value: user.group.name }] : []),
    ...(user.hired_on ? [{ label: "В компании с", value: dateOnly(user.hired_on) }] : []),
  ];
  return <div className="stack profile-page">
    <header className="page-head"><div><h1 className="page-title">Мой профиль</h1><p className="page-subtitle">Данные аккаунта и настройки Puls</p></div><Button icon={<LogoutIcon size={18} />} onClick={logout}>Выйти</Button></header>
    <Card className="profile-identity"><div className="profile-head"><Avatar name={user.full_name} id={user.id} size={56} /><div className="profile-head__text"><h2 className="profile-head__name">{user.full_name}</h2><p className="profile-head__meta">{isDeveloper ? "Разработчик Puls" : ROLE_LABELS[user.role]}{user.group ? ` · ${user.group.name}` : ""}</p></div><Badge tone={user.is_active ? "success" : "neutral"} dot>{user.is_active ? "Активен" : "Отключён"}</Badge></div></Card>
    <div className="profile-settings-grid">
      <Card title="Данные аккаунта" action={can("team") && atLeast("head") ? <Link to={`/admin/users/${user.id}`}>Изменить данные</Link> : undefined}><dl className="profile-data-grid">{fields.map((field) => <div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl></Card>
      <Card title="Внешний вид" subtitle="Выберите тему или используйте настройки системы">
        <div className="theme-options" role="radiogroup" aria-label="Тема оформления">
              {THEME_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={preference === option.value}
                  tabIndex={preference === option.value ? 0 : -1}
                  className={
                    preference === option.value ? "theme-option is-active" : "theme-option"
                  }
                  onClick={() => setPreference(option.value)}
                  onKeyDown={(event) => {
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
                  }}
                >
                  <option.icon size={22} />
                  {option.label}
                </button>
              ))}
            </div>
      </Card>
      <Card title="Пароль" subtitle="Измените пароль для входа в свой аккаунт"><Button onClick={() => setSecurityOpen(true)}>Изменить пароль</Button></Card>
      <PwaInstallCard />
    </div>
    {securityOpen && <PasswordSheet onClose={() => setSecurityOpen(false)} />}
  </div>;
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

