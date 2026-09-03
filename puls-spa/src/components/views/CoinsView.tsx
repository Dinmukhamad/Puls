import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useStore } from '../../store';
import { fmtCoins, fmtDateTime, fmtNumber } from '../../lib/format';
import { Modal } from '../ui/Modal';
import { Badge, Button, PageHeader, Panel, TableShell, Td, Th, cx } from '../ui/primitives';
import type { LedgerSource } from '../../types';

const SOURCE_LABEL: Record<LedgerSource, string> = {
  period: 'Период',
  mission: 'Миссии',
  wheel: 'Колесо',
  shop: 'Магазин',
  bonus: 'Премия',
  test: 'Тесты',
  raffle: 'Розыгрыш',
};

const SOURCE_ORDER: LedgerSource[] = ['period', 'mission', 'test', 'wheel', 'raffle', 'shop', 'bonus'];

/**
 * Журнал операций и ручное премирование.
 *
 * Знак суммы несёт смысл сам по себе, поэтому цвет здесь почти не нужен:
 * списание видно по минусу, а не по красному фону строки. Раскрашивать
 * каждую строку значило бы сделать журнал нечитаемым.
 */
export function CoinsView(): JSX.Element {
  const { state } = useStore();
  const [source, setSource] = useState<LedgerSource | 'all'>('all');
  const [awarding, setAwarding] = useState(false);

  const rows = useMemo(
    () => (source === 'all' ? state.ledger : state.ledger.filter((e) => e.source === source)),
    [state.ledger, source],
  );

  const credited = state.ledger.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0);
  const debited = state.ledger.filter((e) => e.amount < 0).reduce((s, e) => s + e.amount, 0);

  return (
    <>
      <PageHeader
        title="Бухгалтерия коинов"
        hint="Все движения по кошелькам операторов. Начисления руководителя попадают сюда сразу."
        action={
          <Button variant="primary" onClick={() => setAwarding(true)}>
            <Plus size={15} /> Премировать
          </Button>
        }
      />

      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <Panel>
          <p className="text-[13px] text-zinc-500 dark:text-zinc-400">Начислено</p>
          <p className="mt-1.5 font-mono tnum text-[22px] leading-none text-zinc-900 dark:text-zinc-50">
            {fmtCoins(credited, true)}
          </p>
        </Panel>
        <Panel>
          <p className="text-[13px] text-zinc-500 dark:text-zinc-400">Списано</p>
          <p className="mt-1.5 font-mono tnum text-[22px] leading-none text-zinc-900 dark:text-zinc-50">
            {fmtCoins(debited)}
          </p>
        </Panel>
        <Panel>
          <p className="text-[13px] text-zinc-500 dark:text-zinc-400">Операций в журнале</p>
          <p className="mt-1.5 font-mono tnum text-[22px] leading-none text-zinc-900 dark:text-zinc-50">
            {state.ledger.length}
          </p>
        </Panel>
      </div>

      <Panel padded={false}>
        <div className="flex flex-wrap items-center gap-1.5 p-4">
          <FilterChip active={source === 'all'} onClick={() => setSource('all')}>Все</FilterChip>
          {SOURCE_ORDER.map((s) => (
            <FilterChip key={s} active={source === s} onClick={() => setSource(s)}>
              {SOURCE_LABEL[s]}
            </FilterChip>
          ))}
          <span className="ml-auto font-mono tnum text-[12.5px] text-zinc-500 dark:text-zinc-400">
            {rows.length} из {state.ledger.length}
          </span>
        </div>

        <div className="px-4 pb-4">
          <TableShell>
            <thead>
              <tr>
                <Th>Когда</Th>
                <Th>Оператор</Th>
                <Th>Статья</Th>
                <Th>Комментарий</Th>
                <Th align="right">Сумма</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => (
                <tr key={entry.id} className="transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/60">
                  <Td mono tone="muted" className="whitespace-nowrap">
                    {fmtDateTime(entry.at)}
                  </Td>
                  <Td>{entry.operatorName}</Td>
                  <Td>
                    <Badge>{SOURCE_LABEL[entry.source]}</Badge>
                  </Td>
                  <Td tone="muted">{entry.comment}</Td>
                  <Td
                    align="right"
                    mono
                    className={cx(
                      'font-medium',
                      entry.amount < 0 ? 'text-zinc-500 dark:text-zinc-400' : 'text-zinc-900 dark:text-zinc-100',
                    )}
                  >
                    {fmtCoins(entry.amount, true)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
          {rows.length === 0 ? (
            <p className="py-8 text-center text-[13.5px] text-zinc-500 dark:text-zinc-400">
              По этой статье операций пока не было.
            </p>
          ) : null}
        </div>
      </Panel>

      <AwardModal open={awarding} onClose={() => setAwarding(false)} />
    </>
  );
}

function AwardModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const { state, dispatch } = useStore();
  const [operatorId, setOperatorId] = useState(state.operators[0]?.id ?? '');
  const [amount, setAmount] = useState(200);
  const [source, setSource] = useState<LedgerSource>('bonus');
  const [comment, setComment] = useState('');

  const target = state.operators.find((o) => o.id === operatorId);
  const valid = Boolean(target) && amount !== 0 && comment.trim().length > 0;

  const submit = (): void => {
    if (!valid || !target) return;
    dispatch({
      type: 'awardCoins',
      operatorId: target.id,
      amount,
      source,
      comment: comment.trim(),
    });
    setComment('');
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ручное начисление"
      description="Операция попадёт в журнал и сразу изменит баланс оператора."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button variant="primary" disabled={!valid} onClick={submit}>
            {amount < 0 ? 'Списать' : 'Начислить'} {fmtNumber(Math.abs(amount))}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Сотрудник">
          <select
            value={operatorId}
            onChange={(e) => setOperatorId(e.target.value)}
            className={FIELD_CLASS}
          >
            {state.operators.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} — баланс {o.coins}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Сумма" hint="Отрицательное значение означает списание">
          <input
            type="number"
            value={amount}
            step={10}
            onChange={(e) => setAmount(Number(e.target.value))}
            className={cx(FIELD_CLASS, 'font-mono tnum')}
          />
        </Field>

        <Field label="Статья начисления">
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as LedgerSource)}
            className={FIELD_CLASS}
          >
            {SOURCE_ORDER.map((s) => (
              <option key={s} value={s}>{SOURCE_LABEL[s]}</option>
            ))}
          </select>
        </Field>

        <Field label="Комментарий" hint="Обязателен: по нему потом объясняют начисление">
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="За что начисляем"
            className={FIELD_CLASS}
          />
        </Field>

        {target ? (
          <p className="rounded-lg border border-zinc-200 px-4 py-3 font-mono tnum text-[13px] text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
            {fmtNumber(target.coins)} {amount >= 0 ? '+' : '−'} {fmtNumber(Math.abs(amount))} ={' '}
            <span className="text-zinc-900 dark:text-zinc-50">
              {fmtNumber(Math.max(0, target.coins + amount))}
            </span>
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

const FIELD_CLASS =
  'h-9 w-full rounded-lg border border-zinc-200 bg-transparent px-3 text-[13.5px] text-zinc-900 ' +
  'outline-none focus:border-zinc-400 dark:border-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-600';

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] text-zinc-600 dark:text-zinc-400">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[12px] text-zinc-400 dark:text-zinc-600">{hint}</span> : null}
    </label>
  );
}

function FilterChip({
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
