import { Link, type LinkProps } from "react-router-dom";
import { useAccess } from "../auth/AccessContext";

/** Entity names remain readable when the linked module is unavailable; actions can disappear. */
export function AccessLink({ hideWhenDenied = false, ...props }: LinkProps & { hideWhenDenied?: boolean }) {
  const { canPath } = useAccess();
  const path = typeof props.to === "string" ? props.to : `${props.to.pathname ?? ""}${props.to.search ?? ""}`;
  if (!canPath(path)) return hideWhenDenied ? null : <span>{props.children}</span>;
  return <Link {...props} />;
}
