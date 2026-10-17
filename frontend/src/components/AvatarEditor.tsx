import { useEffect, useId, useState, type ChangeEvent, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { avatars, avatarQueryKey, type AvatarData } from "../api/avatars";
import { useAuth } from "../auth/AuthContext";
import { CameraIcon } from "./icons";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";
import { Avatar, Button } from "./ui";
import "./avatar-editor.css";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function AvatarEditor({ userId, name, staff = false, onClose }: {
  userId: number;
  name: string;
  staff?: boolean;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const formId = useId();
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | undefined>();
  const [validation, setValidation] = useState<string | null>(null);
  const queryKey = avatarQueryKey(user?.id ?? 0, userId);
  const current = useQuery({
    queryKey,
    queryFn: ({ signal }) => avatars.get(userId, signal),
    enabled: Boolean(user),
  });

  useEffect(() => {
    if (!file) {
      setPreview(undefined);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  const mutation = useMutation<AvatarData, Error, { action: "save"; file: File } | { action: "remove" }>({
    mutationFn: (change) => change.action === "save"
      ? avatars.save(staff ? userId : null, change.file)
      : avatars.remove(staff ? userId : null),
    onMutate: () => queryClient.cancelQueries({ queryKey, exact: true }),
    onSuccess: (data, change) => {
      queryClient.setQueryData(queryKey, data);
      toast.success(change.action === "remove" ? "Фото удалено" : "Фото профиля сохранено");
      onClose();
    },
  });
  const pending = mutation.isPending;
  const error = validation || (mutation.error instanceof Error ? mutation.error.message : null);

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    event.target.value = "";
    setValidation(null);
    mutation.reset();
    if (!IMAGE_TYPES.has(selected.type)) {
      setFile(null);
      setValidation("Выберите изображение JPEG, PNG или WebP.");
      return;
    }
    if (!selected.size || selected.size > MAX_IMAGE_BYTES) {
      setFile(null);
      setValidation("Фото должно быть не больше 5 МБ и не быть пустым.");
      return;
    }
    setFile(selected);
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!file || pending || !current.isSuccess) return;
    setValidation(null);
    mutation.mutate({ action: "save", file });
  }

  return <Sheet
    title={staff ? "Фото сотрудника" : "Фото профиля"}
    subtitle={staff ? name : "Выберите фото, по которому вас узнают коллеги."}
    size="s"
    onClose={() => { if (!pending) onClose(); }}
    footer={<div className="avatar-editor__footer">
      {current.data?.image && <Button variant="destructive" disabled={pending} onClick={() => {
        setValidation(null);
        mutation.mutate({ action: "remove" });
      }}>{pending && mutation.variables?.action === "remove" ? "Удаляем…" : "Удалить фото"}</Button>}
      <div className="avatar-editor__actions">
        <Button disabled={pending} onClick={onClose}>Отмена</Button>
        <Button variant="primary" type="submit" form={formId} disabled={pending || !file || !current.isSuccess}>
          {pending && mutation.variables?.action === "save" ? "Сохраняем…" : "Сохранить"}
        </Button>
      </div>
    </div>}
  >
    <form id={formId} className="avatar-editor" onSubmit={save} aria-busy={pending}>
      <div className="avatar-editor__preview">
        <Avatar name={name} id={userId} size={144} src={preview ?? current.data?.image ?? undefined} />
        <p aria-live="polite">{file ? "Предпросмотр нового фото" : "Текущее фото"}</p>
      </div>
      <div className="avatar-editor__picker">
        <input id={inputId} className="avatar-editor__input" type="file" accept="image/jpeg,image/png,image/webp" disabled={pending} onChange={choose} aria-describedby={`${hintId}${error ? ` ${errorId}` : ""}`} aria-invalid={Boolean(validation)} />
        <label htmlFor={inputId} className={`btn btn--secondary btn--m avatar-editor__choose${pending ? " avatar-editor__choose--disabled" : ""}`}><CameraIcon size={17} />{file ? "Выбрать другое фото" : "Выбрать фото"}</label>
        {file && <span className="avatar-editor__filename" title={file.name}>{file.name}</span>}
        <p id={hintId} className="avatar-editor__hint">JPEG, PNG или WebP, до 5 МБ. Фото обрежется до квадрата по центру. Изменения появятся после сохранения.</p>
      </div>
      {current.isPending && <p className="avatar-editor__hint" role="status">Загружаем текущее фото…</p>}
      {current.isError && <div className="avatar-editor__error" role="alert"><p>Не удалось загрузить текущее фото.</p><Button size="s" disabled={current.isFetching || pending} onClick={() => void current.refetch()}>Повторить</Button></div>}
      {error && <p id={errorId} className="field__error" role="alert">{error}</p>}
    </form>
  </Sheet>;
}
