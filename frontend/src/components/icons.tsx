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

export const SparkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.4l-1.9-5.6L4.5 10.9 10.1 9z" />
  </Icon>
);

/* Колесо WOW: обод, спицы и стрелка сверху — узнаётся с одного взгляда
   и не повторяет ни звезду обучения, ни витрину магазина. */
export const WheelIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="13" r="8" />
    <path d="M12 5v16M4 13h16M6.3 7.3l11.4 11.4M17.7 7.3 6.3 18.7" />
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
