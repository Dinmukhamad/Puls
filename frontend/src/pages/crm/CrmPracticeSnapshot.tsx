import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fleet as fleetApi } from "../../api/dispatch";
import { crmTraining, crmTrainingKey, type CrmTrainingTask } from "../../api/crmTraining";
import { FLEET_QUERY } from "../dispatch/DispatchSite";
import { fleetLink } from "../dispatch/fleetNav";
import { CallDesktop, callSnapshot } from "./CrmCallWorkspace";
import { practiceReadiness, type PracticeForm } from "./crmCourseGuide";

/** The driver's card is on screen once its phone is filled in: the snapshot waits for it, at most a few seconds. */
async function drawn(read: () => HTMLDivElement | null) {
  for (let i = 0; i < 80; i++) {
    const node = read();
    if (node?.querySelector<HTMLInputElement>('[data-coach="driver-phone"] input')?.value) return node;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Не удалось открыть карточку водителя для скриншота. Повтори попытку.");
}

/**
 * The practice's screenshot, at the bottom of its appeal. While the appeal is incomplete it lists what is
 * missing; once complete it draws OKTEL and the driver's card unseen, saves that as the task's capture and
 * attaches it, so the operator only saves. A capture the task already has is attached as it is.
 */
export function CrmPracticeSnapshot({ task, form, path, attached, onAttach, userId }: {
  task: CrmTrainingTask; form: PracticeForm; path: string[]; attached: boolean; onAttach: (file: File) => void; userId?: number;
}) {
  const client = useQueryClient();
  const fleet = useQuery({ queryKey: FLEET_QUERY, queryFn: fleetApi.state });
  const checks = practiceReadiness(task, form, path);
  const ready = checks.every(check => check.ok);
  const [stage, setStage] = useState(false);
  const desktop = useRef<HTMLDivElement>(null), tried = useRef(false);
  const make = useMutation({
    mutationFn: async () => {
      let capture = task.capture ?? null;
      if (!capture) {
        setStage(true);
        await crmTraining.action(task.key, { action: "inspect", driver_id: task.driver.id });
        const node = await drawn(() => desktop.current);
        node.querySelector<HTMLElement>(".fleet-main")?.scrollTo({ top: 0 });
        const state = await crmTraining.capture(task.key, await callSnapshot(node));
        client.setQueryData(crmTrainingKey(userId), state);
        capture = state.tasks.find(item => item.key === task.key)?.capture ?? null;
        if (!capture) throw new Error("Скриншот не сохранился. Повтори попытку.");
      }
      const blob = await (await fetch(capture.data_url)).blob();
      onAttach(new File([blob], capture.name, { type: "image/png" }));
    },
    onSettled: () => setStage(false),
  });
  useEffect(() => {
    if (!ready || attached || tried.current) return;
    tried.current = true;
    make.mutate();
  }, [ready, attached, make]);
  const driver = fleet.data?.drivers.find(item => item.id === task.driver.id);
  const park = fleet.data?.parks.find(item => item.id === driver?.park);
  return <section className="crm-practice-snapshot" aria-live="polite" data-state={attached ? "attached" : ready ? "ready" : "waiting"}>
    <strong>Скриншот OKTEL и карточки водителя</strong>
    {attached && task.capture ? <>
      <img src={task.capture.data_url} alt="Скриншот: OKTEL с входящим номером и карточка водителя в Диспетчерской" />
      <p>✓ Скриншот добавлен в обращение. Проверь данные и нажми «Сохранить и отправить».</p>
    </> : make.isPending ? <p>Делаем скриншот двух окон…</p>
    : make.isError ? <p role="alert" className="crm-error">{make.error instanceof Error ? make.error.message : "Не удалось сделать скриншот."} <button type="button" className="crm-help-link" onClick={() => make.mutate()}>Повторить</button></p>
    : ready ? <button type="button" className="crm-secondary" onClick={() => make.mutate()}>Добавить скриншот</button>
    : <>
      <p>Появится здесь сам, когда обращение будет заполнено:</p>
      <ul>{checks.map(check => <li key={check.key} data-ok={check.ok}><span aria-hidden="true">{check.ok ? "✓" : "○"}</span>{check.label}{check.ok ? "" : " — ещё нет"}</li>)}</ul>
    </>}
    {stage && driver && <div className="crm-practice-stage" aria-hidden="true" ref={node => node?.setAttribute("inert", "")}>
      <CallDesktop desktopRef={desktop} task={task} parkName={park?.name ?? task.driver.park} address={fleetLink(driver, park)} route={{ page: "driver", id: driver.id, tab: "details" }} parkId={driver.park} go={() => {}}
        copy={<button type="button" className="crm-call-copy" tabIndex={-1}>⧉ Скопировать ссылку</button>} />
    </div>}
  </section>;
}
