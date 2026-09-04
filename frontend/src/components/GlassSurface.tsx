import type { CSSProperties, ReactNode } from "react";

export type GlassVariant = "subtle" | "regular" | "prominent";

/**
 * Единственное место, где в проекте появляется backdrop-filter.
 *
 * Стекло - функциональный слой над содержимым: навигация, плавающие панели,
 * шторки и модальные окна. Обычные карточки и таблицы его не используют,
 * иначе интерфейс превращается в набор полупрозрачных пятен.
 *
 * Когда браузер не умеет blur или пользователь уменьшил прозрачность,
 * поверхность становится непрозрачной - это решает CSS, см. app.css.
 */
export function GlassSurface({
  variant = "regular",
  className = "",
  children,
  style,
  as: Tag = "div",
}: {
  variant?: GlassVariant;
  className?: string;
  children: ReactNode;
  style?: CSSProperties;
  as?: "div" | "aside" | "nav" | "header" | "section";
}) {
  return (
    <Tag className={`glass glass--${variant} ${className}`.trim()} style={style}>
      {children}
    </Tag>
  );
}
