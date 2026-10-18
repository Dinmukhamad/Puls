import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "../../api/client";
import { voiceKeys, voiceTraining, type VoiceAIStatus, type VoiceAttempt } from "../../api/voiceTraining";
import { useAuth } from "../../auth/AuthContext";
import "./voice-mentor.css";

interface ReviewSummary {
  attempt_id: number; user_id: number; user_name: string; group_id: number | null;
  title: string; score: number | null; comment: string; requested_at: string; status: string; manual?: boolean;
}
type ReviewDetail = VoiceAttempt & { learner: { id: number; name: string; group_id: number | null } };
const BASE = "/api/v1/learning/voice/reviews";
const errorText = (value: unknown) => value instanceof Error ? value.message : "Не удалось загрузить разбор. Повторите попытку.";

/** Internal mentor queue, limited by server role and the supervisor's own groups. */
export function VoiceMentorReviews() {
  const { user } = useAuth();
  const client = useQueryClient();
  const [selected, setSelected] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [score, setScore] = useState("");
  const queueKey = ["voice-mentor-reviews", user?.id] as const;
  const ai = useQuery({ queryKey: voiceKeys.ai(user?.id ?? "account"), queryFn: ({ signal }) => voiceTraining.aiStatus(signal), retry: false, staleTime: 60000 });
  const queue = useQuery({ queryKey: queueKey, queryFn: ({ signal }) => request<{ reviews: ReviewSummary[] }>(BASE, { signal }), retry: false, refetchOnWindowFocus: true });
  const detailKey = ["voice-mentor-review", user?.id, selected] as const;
  const detail = useQuery({ queryKey: detailKey, queryFn: ({ signal }) => request<ReviewDetail>(`${BASE}/${selected}`, { signal }), enabled: selected !== null, retry: false });
  const resolve = useMutation({
    mutationFn: ({ id, text, grade }: { id: number; text: string; grade: number | null }) => request<ReviewDetail>(`${BASE}/${id}/resolve`, { method: "POST", json: grade === null ? { comment: text } : { comment: text, score: grade }, timeoutMs: 20000 }),
    onSuccess: (value, variables) => {
      client.setQueryData(["voice-mentor-review", user?.id, variables.id], value);
      void client.invalidateQueries({ queryKey: queueKey });
      setComment(""); setScore("");
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (selected === null || comment.trim().length < 3 || resolve.isPending || (grading && !validScore)) return;
    resolve.mutate({ id: selected, text: comment.trim(), grade: grading ? Number(score) : null });
  }
  const attempt = detail.data;
  // A call from the scenario editor waits for its score; a disputed score needs only an answer.
  const grading = attempt?.result?.review_status === "awaiting_grade";
  const validScore = /^\d{1,3}$/.test(score) && Number(score) <= 100;
  const review = queue.data?.reviews.find(item => item.attempt_id === selected);
  return <section className="card voice-mentor" aria-labelledby="voice-mentor-title">
    <header><div><span className="voice-mentor__eyebrow">ДЛЯ НАСТАВНИКА</span><h2 id="voice-mentor-title">Оценка звонков</h2><p>Сюда попадают звонки из конструктора, которые ждут оценки, и спорные оценки. Ответ сохранится в разборе попытки оператора.</p>{ai.data && <p className="voice-mentor__ai" role="status">{aiLine(ai.data)}</p>}</div><button type="button" className="btn btn--secondary btn--s" onClick={() => void queue.refetch()} disabled={queue.isFetching}>Обновить</button></header>
    {queue.isPending && <p role="status">Загружаем обращения…</p>}
    {queue.isError && <p role="alert">{errorText(queue.error)}</p>}
    {queue.data?.reviews.length === 0 && <p className="voice-mentor__empty">Звонков на проверку и спорных оценок пока нет.</p>}
    {!!queue.data?.reviews.length && <div className="voice-mentor__layout"><ul className="voice-mentor__queue">{queue.data.reviews.map(item => <li key={item.attempt_id}><button type="button" aria-pressed={selected === item.attempt_id} disabled={resolve.isPending} onClick={() => { setSelected(item.attempt_id); setComment(""); setScore(""); resolve.reset(); }}><strong>{item.user_name}</strong><span>{item.title}{item.score !== null ? ` · ${item.score}%` : ""}</span><small>{item.status === "reviewed" ? "Ответ наставника сохранён" : item.status === "awaiting_grade" ? "Ждёт оценки" : "Спорная оценка: ждёт разбора"}</small>{item.comment && <span className="voice-mentor__request">{item.comment}</span>}</button></li>)}</ul>
      <div className="voice-mentor__detail">
        {!selected && <p>Выберите оценку, чтобы посмотреть разговор.</p>}
        {selected && detail.isPending && <p role="status">Открываем разговор…</p>}
        {selected && detail.isError && <div role="alert"><p>{errorText(detail.error)}</p><button type="button" className="btn btn--secondary btn--s" onClick={() => void detail.refetch()}>Повторить загрузку</button></div>}
        {attempt && <><h3>{attempt.learner.name} · попытка №{attempt.id}</h3>{review?.comment && <blockquote><strong>Оператор:</strong> {review.comment}</blockquote>}
          <ul className="voice-mentor__criteria">{attempt.result?.criteria.map(criterion => <li key={criterion.key}><strong>{criterion.passed ? "✓" : "○"} {criterion.label}</strong><p>{criterion.feedback}</p>{criterion.quote && <blockquote>«{criterion.quote}»</blockquote>}</li>)}</ul>
          {!!attempt.result?.critical_errors.length && <div className="voice-mentor__critical"><strong>Критические ошибки</strong>{attempt.result.critical_errors.map((item, index) => <p key={index}>{item.text}<br />«{item.quote}»</p>)}</div>}
          <details><summary>Расшифровка разговора · {attempt.transcript.length} реплик</summary><ol className="voice-mentor__transcript">{attempt.transcript.map((item, index) => <li key={index}><strong>{item.role === "driver" ? "Водитель" : "Оператор"}</strong><p>{item.text}</p></li>)}</ol></details>
          {attempt.result?.solution && <div className="voice-mentor__solution"><strong>Правильное решение по сценарию</strong><p>{attempt.result.solution}</p></div>}
          {attempt.result?.review_status === "reviewed" ? <div className="voice-mentor__answer" role="status"><strong>{attempt.result.manual ? `Оценка ${attempt.result.score}%` : "Ответ наставника"}</strong><p>{attempt.result.mentor_comment}</p><small>Оператор увидит это в разборе попытки.</small></div> : <form onSubmit={submit}>{grading && <><label htmlFor="voice-mentor-score">Оценка, от 0 до 100</label><input id="voice-mentor-score" className="input voice-mentor__score" inputMode="numeric" value={score} onChange={event => setScore(event.target.value.replace(/\D/g, "").slice(0, 3))} required disabled={resolve.isPending} placeholder="Например, 80" aria-invalid={score !== "" && !validScore} /></>}<label htmlFor="voice-mentor-comment">{grading ? "Комментарий оператору" : "Ответ оператору"}</label><textarea id="voice-mentor-comment" className="input" value={comment} onChange={event => setComment(event.target.value)} minLength={3} maxLength={2000} rows={4} required disabled={resolve.isPending} placeholder="Объясните оценку и предложите, как улучшить ответ" /><button type="submit" className="btn btn--primary btn--m" disabled={comment.trim().length < 3 || resolve.isPending || (grading && !validScore)}>{resolve.isPending ? "Сохраняем…" : grading ? "Поставить оценку" : "Сохранить ответ наставника"}</button></form>}
          {resolve.isError && <p role="alert">{errorText(resolve.error)}</p>}
        </>}
      </div>
    </div>}
  </section>;
}

/** One line for mentors about the AI: on and what it cost, off, or out of this month's budget. */
export function aiLine(status: VoiceAIStatus) {
  const money = (value: number) => `$${value.toFixed(value < 1 ? 2 : 0)}`;
  if (!status.configured) return "ИИ не подключён: водитель говорит заготовленными фразами и в сценариях из конструктора отвечает по ключевым словам, звонки из конструктора оцениваете вы.";
  if (!status.active) return `Лимит ИИ на месяц (${money(status.budget_usd)}) исчерпан: до конца месяца водитель говорит заготовленными фразами, звонки из конструктора оцениваете вы.`;
  return `ИИ (Claude) говорит за водителя во всех звонках и оценивает звонки из конструктора: ${money(status.spent_usd)} из ${money(status.budget_usd)} за месяц, обращений — ${status.calls}. Здесь — звонки, которые ИИ не оценил, и спорные оценки.`;
}
