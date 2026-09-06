import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { configuration, configurationError, type StoreItemInput } from "../api/configuration";
import type { ShopItemOut } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { GlassSurface } from "../components/GlassSurface";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { Badge, Button, Card, EmptyState, ErrorState, KPI, Pagination, RowsSkeleton } from "../components/ui";
import { coins } from "../utils/format";
import "./configuration.css";

export function StoreAdminPage() {
  const { atLeast } = useAuth();
  const [params, setParams] = useSearchParams();
  const [editor, setEditor] = useState<ShopItemOut | "new" | null>(null);
  const [archive, setArchive] = useState<ShopItemOut | null>(null);
  const query = useQuery({ queryKey: ["configuration-store"], queryFn: configuration.store });
  const search = params.get("search") ?? "";
  const status = ["all", "active", "archived"].includes(params.get("status") ?? "") ? params.get("status")! : "active";
  const page = Math.max(1, Math.trunc(Number(params.get("page"))) || 1);
  const size = 12;
  const items = query.data?.filter((item) => `${item.title} ${item.code} ${item.description ?? ""}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()) && (status === "all" || item.is_active === (status === "active"))) ?? [];
  const pages = Math.max(1, Math.ceil(items.length / size));
  const currentPage = Math.min(page, pages);
  const visible = items.slice((currentPage - 1) * size, currentPage * size);
  function filter(key: string, value: string) {
    setParams((current) => {
      const next = new URLSearchParams(current); next.set(key, value);
      if (key !== "page") next.delete("page"); return next;
    }, { replace: key === "search" });
  }
  return <div className="stack configuration-page">
    <div className="page-head"><div><h1 className="page-title">Каталог магазина</h1><p className="page-subtitle">Бонусы, стоимость и правила выдачи</p></div><div className="page-head__actions"><Link className="btn btn--secondary btn--m" to="/admin/requests">Заявки на выдачу</Link>{atLeast("head") && <Button variant="primary" onClick={() => setEditor("new")}>Добавить бонус</Button>}</div></div>
    {query.data && <div className="kpi-grid"><KPI label="Активных бонусов" value={query.data.filter((x) => x.is_active).length} /><KPI label="В архиве" value={query.data.filter((x) => !x.is_active).length} /><KPI label="С одобрением" value={query.data.filter((x) => x.is_active && x.requires_approval).length} /><KPI label="Без лимита выдач" value={query.data.filter((x) => x.is_active && x.stock_limit === null).length} /></div>}
    <GlassSurface variant="regular" className="configuration-filters"><label className="field configuration-search"><span className="field__label">Поиск по каталогу</span><input type="search" className="input" placeholder="Название, описание или код" value={search} onChange={(e) => filter("search", e.target.value)} /></label><label className="field"><span className="field__label">Статус</span><select className="input" value={status} onChange={(e) => filter("status", e.target.value)}><option value="active">Активные</option><option value="archived">Архив</option><option value="all">Все бонусы</option></select></label></GlassSurface>
    {query.isLoading && <RowsSkeleton />}{query.isError && <ErrorState error={new Error(configurationError(query.error))} onRetry={() => query.refetch()} />}
    {query.isSuccess && visible.length === 0 && <EmptyState title="Бонусы не найдены" hint="Измените фильтры или добавьте новый бонус." />}
    <div className="configuration-cards">{visible.map((item) => <Card key={item.id} title={item.title} subtitle={item.code} action={<Badge tone={item.is_active ? "success" : "neutral"}>{item.is_active ? "В каталоге" : "В архиве"}</Badge>} className="configuration-item">
      <div className="configuration-price">{coins(item.price)} <span>коинов</span></div>
      {item.description && <p className="configuration-description">{item.description}</p>}
      <dl className="configuration-properties"><dt>Всего выдач</dt><dd>{item.stock_limit ?? "Без лимита"}</dd><dt>На сотрудника в месяц</dt><dd>{item.per_user_monthly_limit ?? "Без лимита"}</dd><dt>Одобрение</dt><dd>{item.requires_approval ? "Руководителем" : "Автоматически"}</dd></dl>
      {atLeast("head") && <div className="configuration-actions"><Button onClick={() => setEditor(item)}>Изменить</Button><Button variant="plain" onClick={() => setArchive(item)}>{item.is_active ? "В архив" : "Восстановить"}</Button></div>}
    </Card>)}</div>
    {query.isSuccess && <Pagination page={currentPage} size={size} total={items.length} onChange={(p) => filter("page", String(p))} />}
    {editor && <StoreItemEditor item={editor === "new" ? undefined : editor} onClose={() => setEditor(null)} />}
    {archive && <StoreArchive item={archive} onClose={() => setArchive(null)} />}
  </div>;
}

function StoreItemEditor({ item, onClose }: { item?: ShopItemOut; onClose: () => void }) {
  const [code, setCode] = useState(item?.code ?? "");
  const [title, setTitle] = useState(item?.title ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [price, setPrice] = useState(item ? String(item.price) : "");
  const [stock, setStock] = useState(item?.stock_limit != null ? String(item.stock_limit) : "");
  const [monthly, setMonthly] = useState(item?.per_user_monthly_limit != null ? String(item.per_user_monthly_limit) : "");
  const [approval, setApproval] = useState(item?.requires_approval ?? true);
  const [active, setActive] = useState(item?.is_active ?? true);
  const [sort, setSort] = useState(String(item?.sort_order ?? 100));
  const client = useQueryClient(); const toast = useToast();
  const save = useMutation({ mutationFn: () => {
    const data: StoreItemInput = { code: code.trim(), title: title.trim(), description: description.trim() || null, price: Number(price), stock_limit: stock === "" ? null : Number(stock), per_user_monthly_limit: monthly === "" ? null : Number(monthly), requires_approval: approval, is_active: active, sort_order: Number(sort) };
    if (item) { const { code: immutableCode, ...changes } = data; void immutableCode; return configuration.updateItem(item.id, changes); }
    return configuration.createItem(data);
  }, onSuccess: () => { void client.invalidateQueries({ queryKey: ["configuration-store"] }); void client.invalidateQueries({ queryKey: ["shop-catalog"] }); void client.invalidateQueries({ queryKey: ["shop"] }); toast.success("Бонус сохранён"); onClose(); } });
  function submit(e: FormEvent) { e.preventDefault(); if (!save.isPending) save.mutate(); }
  return <Sheet title={item ? "Изменить бонус" : "Новый бонус"} subtitle={item ? "Цена поданных заявок сохранится" : "Настройте условия покупки и выдачи"} onClose={() => { if (!save.isPending) onClose(); }} footer={<><Button disabled={save.isPending} onClick={onClose}>Отмена</Button><Button type="submit" form="store-item-form" variant="primary" disabled={save.isPending}>{save.isPending ? "Сохраняем…" : "Сохранить бонус"}</Button></>}>
    <form id="store-item-form" onSubmit={submit} className="stack">
      {save.isError && <p className="configuration-error" role="alert">{configurationError(save.error)}</p>}
      <label className="field"><span className="field__label">Название</span><input className="input" required maxLength={255} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label className="field"><span className="field__label">Код бонуса</span><input className="input" required maxLength={64} value={code} disabled={!!item} onChange={(e) => setCode(e.target.value)} /><span className="muted micro">Уникальный постоянный код, например coffee_break.</span></label>
      <label className="field"><span className="field__label">Описание и условия выдачи</span><textarea className="input" rows={3} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <div className="configuration-form-grid"><label className="field"><span className="field__label">Цена в коинах</span><input className="input" type="number" required min={1} step={1} value={price} onChange={(e) => setPrice(e.target.value)} /></label><label className="field"><span className="field__label">Порядок в каталоге</span><input className="input" type="number" required step={1} value={sort} onChange={(e) => setSort(e.target.value)} /></label></div>
      <div className="configuration-form-grid"><label className="field"><span className="field__label">Общий лимит выдач</span><input className="input" type="number" min={0} step={1} placeholder="Без лимита" value={stock} onChange={(e) => setStock(e.target.value)} /><span className="muted micro">За всё время, включая уже выданные бонусы. Пусто — без лимита.</span></label><label className="field"><span className="field__label">На сотрудника в месяц</span><input className="input" type="number" min={1} step={1} placeholder="Без лимита" value={monthly} onChange={(e) => setMonthly(e.target.value)} /></label></div>
      <label className="configuration-toggle"><input type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)} /><span><strong>Требовать одобрение</strong><span>Заявку проверит руководитель перед списанием коинов.</span></span></label>
      {!item && <label className="configuration-toggle"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /><span><strong>Показать в каталоге</strong><span>Сотрудники смогут подать заявку сразу после сохранения.</span></span></label>}
    </form>
  </Sheet>;
}

function StoreArchive({ item, onClose }: { item: ShopItemOut; onClose: () => void }) {
  const client = useQueryClient(); const toast = useToast();
  const save = useMutation({ mutationFn: () => configuration.updateItem(item.id, { is_active: !item.is_active }), onSuccess: () => {
    void client.invalidateQueries({ queryKey: ["configuration-store"] }); void client.invalidateQueries({ queryKey: ["shop-catalog"] }); void client.invalidateQueries({ queryKey: ["shop"] }); toast.success(item.is_active ? "Бонус убран в архив" : "Бонус возвращён в каталог"); onClose();
  } });
  return <Sheet title={item.is_active ? "Архивировать бонус?" : "Вернуть бонус в каталог?"} onClose={() => { if (!save.isPending) onClose(); }} footer={<><Button onClick={onClose} disabled={save.isPending}>Отмена</Button><Button variant={item.is_active ? "destructive" : "primary"} disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Сохраняем…" : item.is_active ? "Архивировать" : "Восстановить"}</Button></>}><div className="stack"><strong>{item.title}</strong><p>{item.is_active ? "Новые покупки станут недоступны. Поданные заявки и история выдач сохранятся." : "Бонус снова появится в магазине с сохранённой ценой и лимитами."}</p>{save.isError && <p className="configuration-error" role="alert">{configurationError(save.error)}</p>}</div></Sheet>;
}
