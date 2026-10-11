import type { ReactNode } from "react";
import "./city-admin.css";

/** A form's last row: what happened on the left, the buttons on the right. */
export function FormFooter({ status, children }: { status?: ReactNode; children: ReactNode }) {
  return <div className="city-admin-footer"><div className="city-admin-footer__status">{status}</div><div className="city-admin-footer__actions">{children}</div></div>;
}

/** The result of the last save in one line: an error first, then the confirmation, then a hint. */
export function FormStatus({ error, saved, note }: { error?: unknown; saved?: ReactNode; note?: ReactNode }) {
  if (error) return <p className="city-admin-status city-admin-status--error" role="alert">Не удалось сохранить: {error instanceof Error ? error.message : "попробуйте ещё раз"}</p>;
  if (saved) return <p className="city-admin-status city-admin-status--ok" role="status">{saved}</p>;
  return note ? <p className="city-admin-status">{note}</p> : null;
}

/** A yes/no setting drawn as the site's switch; the native checkbox stays for forms and assistive technology. */
export function Switch({ checked, disabled, onChange, children, hint }: { checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void; children: ReactNode; hint?: ReactNode }) {
  return <label className="city-admin-switch">
    <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} role="switch" />
    <span className="city-admin-switch__track" aria-hidden="true"><span /></span>
    <span className="city-admin-switch__text"><span>{children}</span>{hint && <small>{hint}</small>}</span>
  </label>;
}
