/**
 * Собственный набор иконок Puls.
 *
 * Один стиль на всё приложение: контур 1.75px, скруглённые концы, единая
 * оптическая плотность. Смешивать несколько библиотек нельзя - разнобой
 * в толщине линий виден сразу.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 20, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const HomeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5.5 9.5V20h13V9.5" />
    <path d="M9.5 20v-5.5h5V20" />
  </Icon>
);

export const QrIcon = (p: IconProps) => (
  <Icon {...p}><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><path d="M15 15h3v3h3M15 21h3M21 12v3M12 3v3M3 12h3M12 12h3M12 18v3"/></Icon>
);

export const TrophyIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
    <path d="M7 6H4.5v1.5A3.5 3.5 0 0 0 8 11" />
    <path d="M17 6h2.5v1.5A3.5 3.5 0 0 1 16 11" />
    <path d="M12 14v3" />
    <path d="M8.5 20h7" />
    <path d="M10 17h4l.7 3h-5.4z" />
  </Icon>
);

export const StoreIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7.5 5.5 4h13L20 7.5" />
    <path d="M4 7.5h16v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-4-2z" />
    <path d="M5.5 12v8h13v-8" />
  </Icon>
);

export const UsersIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 20v-1a5.5 5.5 0 0 1 11 0v1" />
    <path d="M16 5.3a3.2 3.2 0 0 1 0 5.4" />
    <path d="M17.5 14.4A5.5 5.5 0 0 1 20.5 19v1" />
  </Icon>
);

export const InboxIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 13.5 6 5h12l2.5 8.5" />
    <path d="M3.5 13.5h4l1 2.5h7l1-2.5h4V19H3.5z" />
  </Icon>
);

export const UserIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M4.5 20v-1a7.5 7.5 0 0 1 15 0v1" />
  </Icon>
);

export const CoinIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5v9M9.7 9.8h3.5a1.9 1.9 0 0 1 0 3.8h-3a1.9 1.9 0 0 0 0 3.8h3.6" />
  </Icon>
);

export const ArrowUpIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 19V5" />
    <path d="m6 11 6-6 6 6" />
  </Icon>
);

export const ArrowUpRightIcon = (p: IconProps) => (
  <Icon {...p}><path d="M6 18 18 6M6 6h12v12" /></Icon>
);

export const ArrowDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14" />
    <path d="m6 13 6 6 6-6" />
  </Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </Icon>
);

export const AlertIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5v5.5" />
    <path d="M12 16.3h.01" />
  </Icon>
);

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </Icon>
);

export const FilterIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 6h16" />
    <path d="M7 12h10" />
    <path d="M10 18h4" />
  </Icon>
);

export const DownloadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 4v10" />
    <path d="m8 11 4 4 4-4" />
    <path d="M5 19h14" />
  </Icon>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m9.5 5 7 7-7 7" />
  </Icon>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m14.5 5-7 7 7 7" />
  </Icon>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 9.5 7 7 7-7" />
  </Icon>
);

export const SparkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.4l-1.9-5.6L4.5 10.9 10.1 9z" />
  </Icon>
);

/* Лента удачи: подарок с бантом — тот же образ, что у кнопки «Что может
   выпасть», и не повторяет ни звезду обучения, ни витрину магазина. */
export const GiftIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="7.5" width="17" height="4.5" rx="1.5" />
    <path d="M5.5 12v7a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5v-7M12 7.5v13" />
    <path d="M12 7.5C10.6 4.2 7 3.8 7 5.8c0 1.2 1.4 1.7 5 1.7zm0 0c1.4-3.3 5-3.7 5-1.7 0 1.2-1.4 1.7-5 1.7z" />
  </Icon>
);

/* Звук ленты: динамик с волнами и он же перечёркнутый. */
export const SoundIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 9.5h3l4.5-3.5v12L7 14.5H4z" />
    <path d="M15 9.5a3.5 3.5 0 0 1 0 5M17.5 7a7 7 0 0 1 0 10" />
  </Icon>
);

export const SoundOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 9.5h3l4.5-3.5v12L7 14.5H4z" />
    <path d="m15.5 9.5 5 5m0-5-5 5" />
  </Icon>
);

export const MedalIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="14.5" r="5" />
    <path d="M9 9.6 6.5 3.5h11L15 9.6" />
  </Icon>
);

export const LogoutIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 5.5h4.5V19H14" />
    <path d="M10 12h8" />
    <path d="m13 9-3 3 3 3" />
    <path d="M5.5 5.5V19" />
  </Icon>
);

export const SunIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
  </Icon>
);

export const MoonIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.5 8.5 0 1 0 10.2 10.2z" />
  </Icon>
);

export const DisplayIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="5" width="18" height="12" rx="2.5" />
    <path d="M9 21h6" />
    <path d="M12 17v4" />
  </Icon>
);

export const PhoneIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
    <path d="M11 18.5h2" />
  </Icon>
);

export const MenuIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);

export const PulsMark = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M2.5 13.5h5l2-5.5 3.2 9 2.8-11 2.3 7.5h3.7"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/* Показать и скрыть пароль: открытый и перечёркнутый глаз. */
export const EyeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);

export const EyeOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9.9 5.7A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16.4 16.4 0 0 1-2.6 3.4M6.6 6.9C3.9 8.6 2.5 12 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.7-1.3" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3.5 3.5l17 17" />
  </Icon>
);

export const LockIcon = (p: IconProps) => (
  <Icon {...p}><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></Icon>
);

export const CameraIcon = (p: IconProps) => (
  <Icon {...p}><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.3l1.4-2h5.6l1.4 2h1.3A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5Z" /><circle cx="12" cy="12.5" r="3.5" /></Icon>
);

export const KeyboardIcon = (p: IconProps) => (
  <Icon {...p}><rect x="2.5" y="6" width="19" height="12" rx="3" /><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M8 14h8" /></Icon>
);

export const ClockIcon = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Icon>
);

export const ShieldIcon = (p: IconProps) => (
  <Icon {...p}><path d="M12 3 5 6v5.5c0 4.3 3 8 7 9.5 4-1.5 7-5.2 7-9.5V6Z" /><path d="m9 12 2 2 4-4" /></Icon>
);

export const TelegramIcon = (p: IconProps) => (
  <Icon {...p}><path d="m21 3-4 18-6-6-4 4v-7L3 9 21 3Z" /><path d="m7 12 9-5-5 8" /></Icon>
);
