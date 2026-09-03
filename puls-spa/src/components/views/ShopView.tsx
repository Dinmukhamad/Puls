import { useMemo, useState } from 'react';
import { CalendarClock, Gift, Shirt } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { SHOP_ITEMS } from '../../mockData';
import { useStore } from '../../store';
import { fmtNumber } from '../../lib/format';
import { Modal } from '../ui/Modal';
import { Badge, Button, PageHeader, Panel, cx } from '../ui/primitives';
import type { ShopCategory, ShopItem } from '../../types';

const CATEGORY_META: Record<ShopCategory, { label: string; icon: LucideIcon }> = {
  schedule: { label: 'Привилегии графика', icon: CalendarClock },
  merch: { label: 'Мерч', icon: Shirt },
  certificate: { label: 'Сертификаты', icon: Gift },
};

const CATEGORY_ORDER: ShopCategory[] = ['schedule', 'merch', 'certificate'];

/**
 * Магазин. Единственное место, где коины уходят с баланса, поэтому здесь
 * важнее всего честность: цена видна до нажатия, недостаток средств
 * показан числом, а не заблокированной кнопкой без объяснения.
 */
export function ShopView(): JSX.Element {
  const { state, me } = useStore();
  const [category, setCategory] = useState<ShopCategory | 'all'>('all');
  const [confirming, setConfirming] = useState<ShopItem | null>(null);

  const items = useMemo(
    () => (category === 'all' ? SHOP_ITEMS : SHOP_ITEMS.filter((i) => i.category === category)),
    [category],
  );

  return (
    <>
      <PageHeader
        title="Магазин бонусов"
        hint="Списание проходит сразу и попадает в журнал операций."
        action={
          <Badge mono>
            <span aria-hidden="true" className="text-coin">●</span> {fmtNumber(me.coins)}
          </Badge>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Категория">
        <CategoryChip active={category === 'all'} onClick={() => setCategory('all')}>
          Все
        </CategoryChip>
        {CATEGORY_ORDER.map((c) => (
          <CategoryChip key={c} active={category === c} onClick={() => setCategory(c)}>
            {CATEGORY_META[c].label}
          </CategoryChip>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => {
          const bought = state.purchases[item.id] ?? 0;
          const left = item.stock === null ? null : item.stock - bought;
          const soldOut = left !== null && left <= 0;
          const affordable = me.coins >= item.price;
          const Icon = CATEGORY_META[item.category].icon;

          return (
            <Panel key={item.id} className={cx('flex flex-col', soldOut && 'opacity-60')}>
              <div className="flex items-start justify-between gap-3">
                <Icon size={17} className="mt-0.5 shrink-0 text-zinc-400 dark:text-zinc-600" strokeWidth={1.8} />
                <span className="font-mono tnum text-[15px] text-zinc-900 dark:text-zinc-50">
                  <span aria-hidden="true" className="mr-1 text-coin">●</span>
                  {fmtNumber(item.price)}
                </span>
              </div>

              <h3 className="mt-3 text-[15px] font-medium text-zinc-900 dark:text-zinc-50">{item.title}</h3>
              <p className="mt-1 flex-1 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                {item.description}
              </p>

              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="font-mono tnum text-[12px] text-zinc-400 dark:text-zinc-600">
                  {left === null ? 'без лимита' : soldOut ? 'разобрано' : `осталось ${left}`}
                </span>
                <Button
                  variant={affordable && !soldOut ? 'primary' : 'outline'}
                  size="sm"
                  disabled={soldOut || !affordable}
                  onClick={() => setConfirming(item)}
                  title={!affordable ? `Не хватает ${fmtNumber(item.price - me.coins)} коинов` : undefined}
                >
                  {soldOut ? 'Разобрано' : affordable ? 'Купить' : `−${fmtNumber(item.price - me.coins)}`}
                </Button>
              </div>
            </Panel>
          );
        })}
      </div>

      <PurchaseModal item={confirming} onClose={() => setConfirming(null)} />
    </>
  );
}

function PurchaseModal({ item, onClose }: { item: ShopItem | null; onClose: () => void }): JSX.Element | null {
  const { dispatch, me } = useStore();
  if (!item) return null;
  const after = me.coins - item.price;

  return (
    <Modal
      open
      onClose={onClose}
      title="Подтверждение покупки"
      description={item.title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button
            variant="primary"
            disabled={after < 0}
            onClick={() => {
              dispatch({ type: 'buyItem', itemId: item.id, title: item.title, price: item.price });
              onClose();
            }}
          >
            Списать {fmtNumber(item.price)}
          </Button>
        </>
      }
    >
      <p className="text-[13.5px] leading-relaxed text-zinc-600 dark:text-zinc-300">{item.description}</p>

      <dl className="mt-5 space-y-2.5 rounded-lg border border-zinc-200 p-4 text-[13px] dark:border-zinc-800">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-zinc-500 dark:text-zinc-400">Баланс сейчас</dt>
          <dd className="font-mono tnum text-zinc-700 dark:text-zinc-300">{fmtNumber(me.coins)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-zinc-500 dark:text-zinc-400">Стоимость</dt>
          <dd className="font-mono tnum text-caution">−{fmtNumber(item.price)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 border-t border-zinc-100 pt-2.5 dark:border-zinc-800">
          <dt className="text-zinc-600 dark:text-zinc-300">Останется</dt>
          <dd className="font-mono tnum text-[15px] text-zinc-900 dark:text-zinc-50">{fmtNumber(after)}</dd>
        </div>
      </dl>
    </Modal>
  );
}

function CategoryChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'h-8 rounded-lg px-3 text-[12.5px] transition-colors',
        active
          ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
          : 'border border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900',
      )}
    >
      {children}
    </button>
  );
}
