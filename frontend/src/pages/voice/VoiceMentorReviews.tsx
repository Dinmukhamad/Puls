import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "../../api/client";
import type { VoiceAttempt } from "../../api/voiceTraining";
import { useAuth } from "../../auth/AuthContext";
import "./voice-mentor.css";

interface ReviewSummary {
  attempt_id: number; user_id: number; user_name: string; group_id: number | null;
  title: string; score: number; comment: string; requested_at: string; status: string;
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
  const queueKey = ["voice-mentor-reviews", user?.id] as const;
  const queue = useQuery({ queryKey: queueKey, queryFn: ({ signal }) => request<{ reviews: ReviewSummary[] }>(BASE, { signal }), retry: false, refetchOnWindowFocus: true });
  const detailKey = ["voice-mentor-review", user?.id, selected] as const;
  const detail = useQuery({ queryKey: detailKey, queryFn: ({ signal }) => request<ReviewDetail>(`${BASE}/${selected}`, { signal }), enabled: selected !== null, retry: false });
  const resolve = useMutation({
    mutationFn: ({ id, text }: { id: number; text: string }) => request<ReviewDetail>(`${BASE}/${id}/resolve`, { method: "POST", json: { comment: text }, timeoutMs: 20000 }),
    onSuccess: (value, variables) => {
      client.setQueryData(["voice-mentor-review", user?.id, variables.id], value);
      void client.invalidateQueries({ queryKey: queueKey });
      setComment("");
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (selected === null || comment.trim().length < 3 || resolve.isPending) return;
    resolve.mutate({ id: selected, text: comment.trim() });
  }
  const attempt = detail.data;
  const review = queue.data?.reviews.find(item => item.attempt_id === selected);
  return <section className="card voice-mentor" aria-labelledby="voice-mentor-title">
    <header><div><span className="voice-mentor__eyebrow">ДЛЯ НАСТАВНИКА</span><h2 id="voice-mentor-title">Спорные оценки</h2><p>Посмотрите реплики и ответьте оператору. Ответ сохранится в разборе его попытки.</p></div><button type="button" className="btn btn--secondary btn--s" onClick={() => void queue.refetch()} disabled={queue.isFetching}>Обновить</button></header>
    {queue.isPending && <p role="status">Загружаем обращения…</p>}
    {queue.isError && <p role="alert">{errorText(queue.error)}</p>}
    {queue.data?.reviews.length === 0 && <p className="voice-mentor__empty">Спорных оценок пока нет.</p>}
    {!!queue.data?.reviews.length && <div className="voice-mentor__layout"><ul className="voice-mentor__queue">{queue.data.reviews.map(item => <li key={item.attempt_id}><button type="button" aria-pressed={selected === item.attempt_id} disabled={resolve.isPending} onClick={() => { setSelected(item.attempt_id); setComment(""); resolve.reset(); }}><strong>{item.user_name}</strong><span>{item.title} · {item.score}%</span><small>{item.status === "reviewed" ? "Ответ наставника сохранён" : "Ждёт разбора"}</small><span className="voice-mentor__request">{item.comment}</span></button></li>)}</ul>
      <div className="voice-mentor__detail">
        {!selected && <p>Выберите оценку, чтобы посмотреть разговор.</p>}
        {selected && detail.isPending && <p role="status">Открываем разговор…</p>}
        {selected && detail.isError && <div role="alert"><p>{errorText(detail.error)}</p><button type="button" className="btn btn--secondary btn--s" onClick={() => void detail.refetch()}>Повторить загрузку</button></div>}
        {attempt && <><h3>{attempt.learner.name} · попытка №{attempt.id}</h3>{review && <blockquote><strong>Оператор:</strong> {review.comment}</blockquote>}
          <ul className="voice-mentor__criteria">{attempt.result?.criteria.map(criterion => <li key={criterion.key}><strong>{criterion.passed ? "✓" : "○"} {criterion.label}</strong><p>{criterion.feedback}</p>{criterion.quote && <blockquote>«{criterion.quote}»</blockquote>}</li>)}</ul>
          {!!attempt.result?.critical_errors.length && <div className="voice-mentor__critical"><strong>Критические ошибки</strong>{attempt.result.critical_errors.map((item, index) => <p key={index}>{item.text}<br />«{item.quote}»</p>)}</div>}
          <details><summary>Расшифровка разговора · {attempt.transcript.length} реплик</summary><ol className="voice-mentor__transcript">{attempt.transcript.map((item, index) => <li key={index}><strong>{item.role === "driver" ? "Водитель" : "Оператор"}</strong><p>{item.text}</p></li>)}</ol></details>
          {attempt.result?.review_status === "reviewed" ? <div className="voice-mentor__answer" role="status"><strong>Ответ наставника</strong><p>{attempt.result.mentor_comment}</p><small>Оператор увидит его в разборе попытки.</small></div> : <form onSubmit={submit}><label htmlFor="voice-mentor-comment">Ответ оператору</label><textarea id="voice-mentor-comment" className="input" value={comment} onChange={event => setComment(event.target.value)} minLength={3} maxLength={2000} rows={4} required disabled={resolve.isPending} placeholder="Объясните оценку и предложите, как улучшить ответ" /><button type="submit" className="btn btn--primary btn--m" disabled={comment.trim().length < 3 || resolve.isPending}>{resolve.isPending ? "Сохраняем ответ…" : "Сохранить ответ наставника"}</button></form>}
          {resolve.isError && <p role="alert">{errorText(resolve.error)}</p>}
        </>}
      </div>
    </div>}
  </section>;
}
