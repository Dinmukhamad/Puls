import { useQuery } from "@tanstack/react-query";

import { cabinet } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { DisplayIcon, LogoutIcon, MoonIcon, SunIcon } from "../components/icons";
import { Avatar, Badge, Button, Card, CoinAmount, Skeleton } from "../components/ui";
import { useTheme, type ThemePreference } from "../theme/ThemeContext";
import { ROLE_LABELS, coins, dateOnly } from "../utils/format";

const THEME_OPTIONS: {
  value: ThemePreference;
  label: string;
  icon: (props: { size?: number }) => JSX.Element;
}[] = [
  { value: "system", label: "Система", icon: DisplayIcon },
  { value: "light", label: "Светлая", icon: SunIcon },
  { value: "dark", label: "Тёмная", icon: MoonIcon },
];

export function ProfilePage() {
  const { user, logout } = useAuth();
  const { preference, setPreference } = useTheme();
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: () => cabinet.dashboard() });

  if (!user) return null;

  return (
    <div className="stack">
      <div className="page-head">
        <h1 className="page-title">Профиль</h1>
      </div>

      <Card>
        <div className="profile-head">
          <Avatar name={user.full_name} id={user.id} size={64} />
          <div className="profile-head__text">
            <p className="profile-head__name">{user.full_name}</p>
            <p className="profile-head__meta">
              {ROLE_LABELS[user.role]}
              {user.group ? ` · ${user.group.name}` : ""}
            </p>
            <div className="row" style={{ marginTop: "var(--sp-2)" }}>
              <Badge tone={user.is_active ? "success" : "neutral"} dot>
                {user.is_active ? "Активен" : "Отключён"}
              </Badge>
              {dashboard.data && (
                <Badge tone="neutral">
                  Баланс {coins(dashboard.data.balance.balance)}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid--1-1">
        <Card title="Аккаунт">
          <div className="grouped">
            <div className="grouped__row">
              <span className="grouped__label">Логин</span>
              <span className="grouped__value">{user.login}</span>
            </div>
            <div className="grouped__row">
              <span className="grouped__label">Электронная почта</span>
              <span className="grouped__value">{user.email ?? "—"}</span>
            </div>
            <div className="grouped__row">
              <span className="grouped__label">Роль</span>
              <span className="grouped__value">{ROLE_LABELS[user.role]}</span>
            </div>
            <div className="grouped__row">
              <span className="grouped__label">Группа</span>
              <span className="grouped__value">{user.group?.name ?? "—"}</span>
            </div>
            <div className="grouped__row">
              <span className="grouped__label">В компании с</span>
              <span className="grouped__value">
                {user.hired_on ? dateOnly(user.hired_on) : "—"}
              </span>
            </div>
          </div>
        </Card>

        <div className="stack stack--tight">
          <Card title="Внешний вид" subtitle="По умолчанию тема следует за системой">
            <div className="theme-options" role="radiogroup" aria-label="Тема оформления">
              {THEME_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={preference === option.value}
                  className={
                    preference === option.value ? "theme-option is-active" : "theme-option"
                  }
                  onClick={() => setPreference(option.value)}
                >
                  <option.icon size={22} />
                  {option.label}
                </button>
              ))}
            </div>
          </Card>

          <Card title="Мои коины">
            {dashboard.isLoading && <Skeleton height={64} radius="var(--radius-m)" />}
            {dashboard.data && (
              <div className="grouped">
                <div className="grouped__row">
                  <span className="grouped__label">Баланс</span>
                  <span className="grouped__value">
                    <CoinAmount value={dashboard.data.balance.balance} />
                  </span>
                </div>
                <div className="grouped__row">
                  <span className="grouped__label">В резерве</span>
                  <span className="grouped__value">
                    {coins(dashboard.data.balance.reserved)}
                  </span>
                </div>
                <div className="grouped__row">
                  <span className="grouped__label">Всего начислено</span>
                  <span className="grouped__value">
                    {coins(dashboard.data.balance.total_earned)}
                  </span>
                </div>
                <div className="grouped__row">
                  <span className="grouped__label">Всего потрачено</span>
                  <span className="grouped__value">
                    {coins(dashboard.data.balance.total_spent)}
                  </span>
                </div>
              </div>
            )}
          </Card>

          <Card title="Система">
            <Button variant="destructive" block icon={<LogoutIcon size={18} />} onClick={logout}>
              Выйти из аккаунта
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
