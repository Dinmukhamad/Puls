import { useId, useRef, useState, type ReactNode } from "react";
import { DownloadIcon } from "./icons";
import "./file-drop.css";

/**
 * Files in the site's style instead of the browser's «Choose Files»: drop them on the zone or press «Выбрать файл».
 * The chosen names are listed under the button; the zone says what it is doing while the files are read.
 */
export function FileDrop({ accept, multiple = false, disabled = false, title, hint, busy, files, onFiles, button }: {
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  title: ReactNode;
  hint?: ReactNode;
  /** Shown instead of the title while the files are read. */
  busy?: ReactNode;
  files?: readonly File[];
  onFiles: (files: File[]) => void;
  button?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const pick = (list: FileList | null) => { const chosen = Array.from(list ?? []); if (chosen.length && !disabled) onFiles(multiple ? chosen : chosen.slice(0, 1)); };
  return <div className={`file-drop${over ? " is-over" : ""}${disabled ? " is-disabled" : ""}`} aria-busy={Boolean(busy) || undefined}
    onDragOver={event => { event.preventDefault(); if (!disabled) setOver(true); }} onDragLeave={() => setOver(false)}
    onDrop={event => { event.preventDefault(); setOver(false); pick(event.dataTransfer.files); }}>
    <span className="file-drop__icon" aria-hidden="true"><DownloadIcon size={22} /></span>
    <strong className="file-drop__title" aria-live="polite">{busy || title}</strong>
    {hint && <span className="file-drop__hint">{hint}</span>}
    <input ref={input} id={id} className="file-drop__input" type="file" accept={accept} multiple={multiple} disabled={disabled}
      onChange={event => { pick(event.target.files); event.target.value = ""; }} />
    <label htmlFor={id} className="btn btn--secondary btn--m file-drop__button">{button ?? (multiple ? "Выбрать файлы" : "Выбрать файл")}</label>
    {!!files?.length && <ul className="file-drop__files" aria-label="Выбранные файлы">{files.map(file => <li key={`${file.name}:${file.size}`}>{file.name}</li>)}</ul>}
  </div>;
}
