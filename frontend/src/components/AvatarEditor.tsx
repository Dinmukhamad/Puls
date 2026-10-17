import { useEffect, useId, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent, type KeyboardEvent, type PointerEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { avatars, avatarQueryKey, type AvatarData } from "../api/avatars";
import { useAuth } from "../auth/AuthContext";
import { AVATAR_OUTPUT, MAX_SOURCE_BYTES, ZOOM_MAX, clampFrame, displayed, drawRect, type Frame } from "./avatarCrop";
import { CameraIcon } from "./icons";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";
import { Avatar, Button } from "./ui";
import "./avatar-editor.css";

/** The stage's side in CSS pixels; avatar-editor.css draws it at the same size. */
const STAGE = 240;

interface Picked { url: string; image: HTMLImageElement; name: string }

/** The framed square as a small file the server accepts: WebP where the browser can write it, JPEG elsewhere. */
async function framed(picked: Picked, frame: Frame): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = AVATAR_OUTPUT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Браузер не смог подготовить фото. Попробуйте другой браузер.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, AVATAR_OUTPUT, AVATAR_OUTPUT);
  context.imageSmoothingQuality = "high";
  const rect = drawRect(frame, STAGE);
  context.drawImage(picked.image, rect.x, rect.y, rect.w, rect.h);
  const encode = (type: string, quality: number) => new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality));
  let blob = await encode("image/webp", .9);
  if (!blob || blob.type !== "image/webp") blob = await encode("image/jpeg", .92);
  if (!blob) throw new Error("Браузер не смог подготовить фото. Попробуйте другой браузер.");
  return new File([blob], blob.type === "image/webp" ? "avatar.webp" : "avatar.jpg", { type: blob.type });
}

/**
 * The profile photo (docs/AVATARS.md): choose any photo — from the button, by dropping it on the circle or by tapping the
 * empty circle — move it and zoom in until the right part is in the circle, then save. The browser sends only that
 * square, so a full-size phone photo works as well as a small picture.
 */
export function AvatarEditor({ userId, name, staff = false, onClose }: {
  userId: number;
  name: string;
  staff?: boolean;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const formId = useId(), inputId = useId(), hintId = useId(), errorId = useId(), zoomId = useId();
  const input = useRef<HTMLInputElement>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; frame: Frame } | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [opening, setOpening] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const queryKey = avatarQueryKey(user?.id ?? 0, userId);
  const current = useQuery({ queryKey, queryFn: ({ signal }) => avatars.get(userId, signal), enabled: Boolean(user) });

  useEffect(() => () => { if (picked) URL.revokeObjectURL(picked.url); }, [picked]);

  const mutation = useMutation<AvatarData, Error, { action: "save" } | { action: "remove" }>({
    mutationFn: async (change) => {
      if (change.action === "remove") return avatars.remove(staff ? userId : null);
      if (!picked || !frame) throw new Error("Сначала выберите фото.");
      return avatars.save(staff ? userId : null, await framed(picked, frame));
    },
    onMutate: () => queryClient.cancelQueries({ queryKey, exact: true }),
    onSuccess: (data, change) => {
      queryClient.setQueryData(queryKey, data);
      toast.success(change.action === "remove" ? "Фото удалено" : "Фото профиля сохранено");
      onClose();
    },
  });
  const pending = mutation.isPending;
  const error = validation || (mutation.error instanceof Error ? mutation.error.message : null);

  async function open(file: File | undefined) {
    if (!file || pending) return;
    setValidation(null);
    mutation.reset();
    if (file.type && !file.type.startsWith("image/")) { setValidation("Это не изображение. Выберите фото."); return; }
    if (!file.size || file.size > MAX_SOURCE_BYTES) { setValidation("Фото пустое или больше 40 МБ. Выберите другое."); return; }
    setOpening(true);
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.decoding = "async";
      image.src = url;
      await image.decode();
      if (!image.naturalWidth || !image.naturalHeight) throw new Error("empty");
      setPicked({ url, image, name: file.name });
      setFrame({ width: image.naturalWidth, height: image.naturalHeight, zoom: 1, x: 0, y: 0 });
    } catch {
      URL.revokeObjectURL(url);
      setValidation("Не удалось открыть это фото. Выберите JPG, PNG или WebP.");
    } finally {
      setOpening(false);
    }
  }

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    void open(file);
  }

  function move(next: Partial<Frame>) {
    setFrame(value => value && clampFrame({ ...value, ...next }, STAGE));
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!frame || pending) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, frame };
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start || start.pointer !== event.pointerId) return;
    setFrame(clampFrame({ ...start.frame, x: start.frame.x + event.clientX - start.x, y: start.frame.y + event.clientY - start.y }, STAGE));
  }
  function onPointerUp() { drag.current = null; }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!frame) return;
    const step = event.shiftKey ? 32 : 8;
    const moves: Record<string, Partial<Frame>> = { ArrowLeft: { x: frame.x - step }, ArrowRight: { x: frame.x + step }, ArrowUp: { y: frame.y - step }, ArrowDown: { y: frame.y + step }, "+": { zoom: frame.zoom + .1 }, "=": { zoom: frame.zoom + .1 }, "-": { zoom: frame.zoom - .1 } };
    if (!(event.key in moves)) return;
    event.preventDefault();
    move(moves[event.key]);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDropping(false);
    void open(event.dataTransfer.files[0]);
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!picked || !frame || pending || !current.isSuccess) return;
    setValidation(null);
    mutation.mutate({ action: "save" });
  }

  const size = frame && displayed(frame, STAGE);
  return <Sheet
    title={staff ? "Фото сотрудника" : "Фото профиля"}
    subtitle={staff ? name : "Выберите фото, по которому вас узнают коллеги."}
    size="s"
    onClose={() => { if (!pending) onClose(); }}
    footer={<div className="avatar-editor__footer">
      {current.data?.image && !picked && <Button variant="destructive" disabled={pending} onClick={() => {
        setValidation(null);
        mutation.mutate({ action: "remove" });
      }}>{pending && mutation.variables?.action === "remove" ? "Удаляем…" : "Удалить фото"}</Button>}
      <div className="avatar-editor__actions">
        <Button disabled={pending} onClick={onClose}>Отмена</Button>
        <Button variant="primary" type="submit" form={formId} disabled={pending || !picked || !current.isSuccess}>
          {pending && mutation.variables?.action === "save" ? "Сохраняем…" : "Сохранить"}
        </Button>
      </div>
    </div>}
  >
    <form id={formId} className="avatar-editor" onSubmit={save} aria-busy={pending || opening}>
      <div className={`avatar-editor__stage${picked ? " is-framing" : ""}${dropping ? " is-dropping" : ""}`}
        role={picked ? "img" : undefined} aria-label={picked ? "Кадр фото: перетащите, чтобы выбрать, что попадёт в круг" : undefined}
        tabIndex={picked ? 0 : undefined} onKeyDown={onKeyDown}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onWheel={event => { if (frame) move({ zoom: frame.zoom - event.deltaY / 500 }); }}
        onDragOver={event => { event.preventDefault(); setDropping(true); }} onDragLeave={() => setDropping(false)} onDrop={onDrop}>
        {picked && frame && size
          ? <img src={picked.url} alt="" draggable={false} style={{ width: size.w, height: size.h, transform: `translate(calc(-50% + ${frame.x}px), calc(-50% + ${frame.y}px))` }} />
          : <button type="button" className="avatar-editor__empty" disabled={pending || opening} aria-describedby={hintId} onClick={() => input.current?.click()}>
            <Avatar name={name} id={userId} size={STAGE} src={current.data?.image ?? undefined} photo={false} />
            <span className="avatar-editor__veil"><CameraIcon size={22} />{opening ? "Открываем…" : current.data?.image ? "Заменить фото" : "Выбрать фото"}</span>
          </button>}
      </div>
      {picked && frame && <label className="avatar-editor__zoom" htmlFor={zoomId}>
        <span>Масштаб</span>
        <input id={zoomId} type="range" min={1} max={ZOOM_MAX} step={.01} value={frame.zoom} disabled={pending} onChange={event => move({ zoom: Number(event.target.value) })} />
      </label>}
      <p id={hintId} className="avatar-editor__hint">{picked
        ? "Перетащите фото, чтобы выбрать, что попадёт в круг. Сохранится только этот кадр."
        : "Подойдёт любое фото с телефона или компьютера. Его можно перетащить на круг."}</p>
      <div className="avatar-editor__picker">
        <input ref={input} id={inputId} className="avatar-editor__input" type="file" accept="image/*" disabled={pending || opening} onChange={choose} aria-describedby={`${hintId}${error ? ` ${errorId}` : ""}`} aria-invalid={Boolean(validation)} />
        <label htmlFor={inputId} className={`btn btn--secondary btn--m avatar-editor__choose${pending || opening ? " avatar-editor__choose--disabled" : ""}`}><CameraIcon size={17} />{picked ? "Другое фото" : "Выбрать фото"}</label>
      </div>
      {current.isPending && <p className="avatar-editor__hint" role="status">Загружаем текущее фото…</p>}
      {current.isError && <div className="avatar-editor__error" role="alert"><p>Не удалось загрузить текущее фото.</p><Button size="s" disabled={current.isFetching || pending} onClick={() => void current.refetch()}>Повторить</Button></div>}
      {error && <p id={errorId} className="field__error" role="alert">{error}</p>}
    </form>
  </Sheet>;
}
