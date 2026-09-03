import { Globe, Monitor, TriangleAlert } from 'lucide-react';
import { useStore } from '../../store';
import { fmtDateTime } from '../../lib/format';
import { Badge, Button, EmptyState, PageHeader, Panel, TableShell, Td, Th } from '../ui/primitives';

/**
 * Сессии. Смысл раздела — заметить чужой вход и оборвать его, не меняя
 * пароль всей линии. Поэтому «вне сети офиса» помечается явно: это не
 * нарушение само по себе, но именно там стоит смотреть в первую очередь.
 */
export function SessionsView(): JSX.Element {
  const { state, dispatch } = useStore();
  const external = state.sessions.filter((s) => !s.ip.startsWith('10.'));

  return (
    <>
      <PageHeader
        title="Сессии"
        hint="Активные входы и устройства. Завершение сессии не меняет пароль и не затрагивает остальных."
        action={
          external.length > 0 ? (
            <Badge tone="caution">
              <TriangleAlert size={11} /> {external.length} вне сети офиса
            </Badge>
          ) : (
            <Badge tone="affirm">Все входы из офисной сети</Badge>
          )
        }
      />

      <Panel padded={false}>
        {state.sessions.length === 0 ? (
          <EmptyState
            title="Активных сессий нет"
            detail="Все входы завершены. Это состояние безопасности, а не отсутствие данных."
          />
        ) : (
          <div className="p-4">
            <TableShell>
              <thead>
                <tr>
                  <Th>Сотрудник</Th>
                  <Th>Устройство</Th>
                  <Th>Адрес</Th>
                  <Th>Расположение</Th>
                  <Th>Последняя активность</Th>
                  <Th align="right">Действие</Th>
                </tr>
              </thead>
              <tbody>
                {state.sessions.map((session) => {
                  const outside = !session.ip.startsWith('10.');
                  return (
                    <tr key={session.id} className="transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/60">
                      <Td>
                        {session.operatorName}
                        {session.current ? (
                          <span className="ml-2 text-[11px] text-zinc-400 dark:text-zinc-600">текущая</span>
                        ) : null}
                      </Td>
                      <Td>
                        <span className="flex items-center gap-1.5">
                          <Monitor size={13} className="shrink-0 text-zinc-400" />
                          {session.device}
                        </span>
                      </Td>
                      <Td mono>{session.ip}</Td>
                      <Td>
                        <span className="flex items-center gap-1.5">
                          {outside ? (
                            <Globe size={13} className="shrink-0 text-caution" />
                          ) : (
                            <Globe size={13} className="shrink-0 text-zinc-400" />
                          )}
                          <span className={outside ? 'text-caution' : undefined}>{session.location}</span>
                        </span>
                      </Td>
                      <Td mono tone="muted" className="whitespace-nowrap">
                        {fmtDateTime(session.lastSeen)}
                      </Td>
                      <Td align="right">
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={session.current}
                          title={session.current ? 'Нельзя завершить сессию, из которой работаете' : undefined}
                          onClick={() => dispatch({ type: 'revokeSession', sessionId: session.id })}
                        >
                          Завершить
                        </Button>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </TableShell>
          </div>
        )}
      </Panel>
    </>
  );
}
