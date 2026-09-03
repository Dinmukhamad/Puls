import { useEffect, useMemo, useState } from 'react';
import { Check, Timer, X } from 'lucide-react';
import { useStore } from '../../store';
import { fmtClock } from '../../lib/format';
import { Modal } from '../ui/Modal';
import { Button, Progress, cx } from '../ui/primitives';
import type { KnowledgeTest } from '../../types';

/**
 * Прохождение теста. Таймер идёт по-настоящему и по истечении сам
 * завершает попытку с тем результатом, который успели набрать: иначе
 * ограничение по времени было бы декоративным.
 */
export function TestRunner({
  test,
  onClose,
}: {
  test: KnowledgeTest | null;
  onClose: () => void;
}): JSX.Element | null {
  const { dispatch } = useStore();
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [seconds, setSeconds] = useState(0);
  const [result, setResult] = useState<{ percent: number; passed: boolean } | null>(null);

  useEffect(() => {
    if (!test) return;
    setIndex(0);
    setAnswers({});
    setResult(null);
    setSeconds(test.minutes * 60);
  }, [test]);

  const score = useMemo(() => {
    if (!test) return 0;
    const correct = test.questions.filter((q) => answers[q.id] === q.correctOptionId).length;
    return Math.round((correct / test.questions.length) * 100);
  }, [test, answers]);

  useEffect(() => {
    if (!test || result) return undefined;
    if (seconds <= 0) {
      const passed = score >= test.passPercent;
      setResult({ percent: score, passed });
      dispatch({ type: 'finishTest', testId: test.id, scorePercent: score });
      return undefined;
    }
    const timer = window.setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [seconds, test, result, score, dispatch]);

  if (!test) return null;

  const question = test.questions[index];
  const answered = Object.keys(answers).length;
  const last = index === test.questions.length - 1;

  const finish = (): void => {
    const passed = score >= test.passPercent;
    setResult({ percent: score, passed });
    dispatch({ type: 'finishTest', testId: test.id, scorePercent: score });
  };

  return (
    <Modal
      open
      onClose={onClose}
      width="lg"
      title={test.title}
      description={result ? undefined : `${test.topic} · проходной балл ${test.passPercent}%`}
      footer={
        result ? (
          <Button variant="primary" onClick={onClose}>Закрыть</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>Прервать</Button>
            {last ? (
              <Button variant="primary" disabled={answered < test.questions.length} onClick={finish}>
                Завершить тест
              </Button>
            ) : (
              <Button
                variant="primary"
                disabled={!answers[question.id]}
                onClick={() => setIndex((i) => i + 1)}
              >
                Дальше
              </Button>
            )}
          </>
        )
      }
    >
      {result ? (
        <div className="py-4 text-center">
          <span
            className={cx(
              'mx-auto flex h-14 w-14 items-center justify-center rounded-full',
              result.passed
                ? 'bg-affirm/10 text-affirm-dim dark:text-affirm'
                : 'bg-caution/10 text-caution',
            )}
          >
            {result.passed ? <Check size={26} /> : <X size={26} />}
          </span>
          <p className="mt-4 font-mono tnum text-[34px] leading-none text-zinc-900 dark:text-zinc-50">
            {result.percent}%
          </p>
          <p className="mt-2 text-[14px] text-zinc-600 dark:text-zinc-400">
            {result.passed
              ? `Тест сдан. Начислено ${test.rewardCoins} коинов${test.rewardTickets ? ` и ${test.rewardTickets} билет WOW` : ''}.`
              : `Проходной балл ${test.passPercent}%. Попытку можно повторить в любой момент.`}
          </p>
        </div>
      ) : (
        <>
          <div className="mb-5 flex items-center justify-between gap-4">
            <span className="font-mono tnum text-[12.5px] text-zinc-500 dark:text-zinc-400">
              Вопрос {index + 1} из {test.questions.length}
            </span>
            <span
              className={cx(
                'inline-flex items-center gap-1.5 font-mono tnum text-[13px]',
                seconds <= 30 ? 'text-caution' : 'text-zinc-500 dark:text-zinc-400',
              )}
            >
              <Timer size={13} />
              {fmtClock(seconds)}
            </span>
          </div>

          <Progress value={index} max={test.questions.length} />

          <p className="mt-6 text-[15px] leading-relaxed text-zinc-900 dark:text-zinc-100">{question.text}</p>

          <div className="mt-4 space-y-2" role="radiogroup" aria-label={question.text}>
            {question.options.map((option) => {
              const picked = answers[question.id] === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={picked}
                  onClick={() => setAnswers((a) => ({ ...a, [question.id]: option.id }))}
                  className={cx(
                    'flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left text-[13.5px] transition-colors',
                    picked
                      ? 'border-zinc-400 bg-zinc-50 text-zinc-900 dark:border-zinc-600 dark:bg-raised dark:text-zinc-50'
                      : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900',
                  )}
                >
                  <span
                    className={cx(
                      'mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2',
                      picked ? 'border-zinc-900 bg-zinc-900 dark:border-zinc-100 dark:bg-zinc-100' : 'border-zinc-300 dark:border-zinc-600',
                    )}
                  />
                  {option.text}
                </button>
              );
            })}
          </div>
        </>
      )}
    </Modal>
  );
}
