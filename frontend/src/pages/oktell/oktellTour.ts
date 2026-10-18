/**
 * Pulsar's walk through Oktell in the order the team teaches it: «Телефон», «Кабинет», «Сообщения»,
 * «Журнал», then the statuses that decide whether calls come in, a driver's callback through the
 * park's code and the three-minute limit of «Перезвон». The operator does every step himself.
 */
import type { CoachStep } from "../crm/coachTours";

const ROOT = "[data-coach=oktell]", WORK = "[data-coach=oktell-workspace]", PHONE = "[data-coach=oktell-phone]";
const SCREEN = (id: string) => `${ROOT}[data-screen=${id}]`, NAV = (id: string) => `[data-coach=oktell-nav-${id}]`;
const JOINED = "[data-coach=oktell-center][data-joined=true]", AUTOMATIC = "[data-coach=oktell-automatic]", SETTINGS = "[data-coach=oktell-phone-settings]";

export const OKTELL_TOUR: CoachStep[] = [
  { target: "[data-coach=oktell-login]", advanceWhen: WORK, action: "Войди", title: "Привет! Это Oktell 👋", text: "В Oktell принимают и делают звонки. Войди с учебными данными: нажми «Демо-вход», затем «Войти»." },
  { target: NAV("phone"), advanceWhen: PHONE, action: "Нажми", title: "Раздел «Телефон»", text: "После входа первым открывается «Телефон». Сейчас он закрыт — нажми сюда." },
  { target: PHONE, title: "Телефон", text: "Здесь все операторы на линии, а сверху поле «имя или номер»: через него звонят коллегам и водителям." },
  { target: "[data-coach=oktell-people]", title: "Красный и чёрный", text: "Красным отмечен оператор, который сейчас на звонке. Обычным чёрным — оператор без звонка: он свободен." },
  { target: "[data-coach=oktell-hangup]", when: `${ROOT}[data-call=active]`, advanceWhen: `${ROOT}[data-call=none]`, action: "Нажми", title: "Сначала заверши звонок", text: "У тебя идёт учебный звонок. Заверши его, и пойдём дальше." },
  { target: NAV("cabinet"), advanceWhen: SCREEN("cabinet"), action: "Нажми", title: "Раздел «Кабинет»", text: "В «Кабинете» начинают работу. Нажми сюда." },
  { target: "[data-coach=oktell-join]", advanceWhen: JOINED, action: "Нажми", title: "Войти в call-центр", text: "Нажми «Войти в call-центр»: только после этого тебе начнут поступать звонки." },
  { target: "[data-coach=oktell-center]", title: "Пошёл отсчёт", text: "Таймер «В call-центре» идёт — звонки поступают. Нажмёшь «Выйти из call-центра» — звонки поступать перестанут." },
  { target: NAV("messages"), title: "Раздел «Сообщения»", text: "Здесь можно писать сообщения коллегам. Раздел необязательный: пользуйся, когда нужно." },
  { target: NAV("journal"), title: "Раздел «Журнал»", text: "В журнале все твои звонки, и любой из них можно прослушать самому. Покажу это в конце." },
  { target: "[data-coach=oktell-status]", advanceWhen: "[data-coach=oktell-statuses]", action: "Нажми", title: "Самое главное — статусы", text: "Эта кнопка открывает режимы и статусы: от них зависит, поступают ли тебе звонки. Нажми сюда." },
  { target: AUTOMATIC, title: "Автоматический режим", text: "«Автоматический режим» должен быть включён всегда. Если он не включён, звонки тебе не поступают." },
  { target: AUTOMATIC, when: `${AUTOMATIC}[data-current=false]`, advanceWhen: `${AUTOMATIC}[data-current=true]`, action: "Нажми", title: "Включи его", text: "Сейчас автоматический режим не выбран. Нажми на него — он станет жирным." },
  { target: SETTINGS, action: "Отметь", title: "Веб-телефон и Автоответ", text: "Эти два флажка тоже включены всегда: «Веб-телефон» — звонки через браузер и гарнитуру, «Автоответ» — звонок принимается сам." },
  { target: SETTINGS, when: `${SETTINGS}[data-ready=false]`, advanceWhen: `${SETTINGS}[data-ready=true]`, action: "Отметь", title: "Включи оба флажка", text: "Отметь и «Веб-телефон», и «Автоответ»: они должны быть включены всегда." },
  { target: "[data-coach=oktell-manual]", title: "Ручной режим", text: "«Ручной режим» значит, что звонки тебе не поступают: ты сам звонишь кому нужно." },
  { target: "[data-coach=oktell-pauses]", title: "Статусы паузы", text: "В паузе звонки не поступают. «Тех.причина» — проблема с компьютером, «Перезвон» — перезваниваешь, «Тренинг» — у тебя тренинг, «Перерыв» — перерыв." },
  // A callback in practice: «Перезвон», the park's code and the driver's number, back to work.
  { target: "[data-coach=oktell-pause-callback]", advanceWhen: `${ROOT}[data-pause=callback]`, action: "Нажми", title: "Перезвоним водителю", text: "Сначала поставь «Перезвон», чтобы тебе не поступали звонки. Сидеть в нём можно не больше 3 минут." },
  { target: NAV("phone"), when: WORK, advanceWhen: PHONE, action: "Нажми", title: "Открой «Телефон»", text: "«Перезвон» стоит. Теперь открой «Телефон» — отсюда звонят водителю." },
  { target: "[data-coach=oktell-dial]", when: WORK, advanceWhen: "[data-coach=oktell-dial-card][data-valid=true]", action: "Впиши", title: "Код парка и номер", text: "В поле «имя или номер» впиши код таксопарка, затем номер водителя с 7, без плюса. Код iTaxi — 0880: 088077075053636." },
  { target: "[data-coach=oktell-dial-call]", when: WORK, advanceWhen: `${ROOT}[data-call=active]`, allow: "[data-coach=oktell-dial]", action: "Нажми", title: "Позвони", text: "0880 — это iTaxi, дальше номер водителя. Всё верно? Нажми «Позвонить»." },
  { target: "[data-coach=oktell-hangup]", when: WORK, advanceWhen: `${ROOT}[data-call=none]`, action: "Нажми", title: "Идёт звонок", text: "Это учебный звонок, звука нет. Когда договоришь с водителем, нажми «Завершить звонок»." },
  { target: NAV("cabinet"), when: WORK, advanceWhen: SCREEN("cabinet"), action: "Нажми", title: "Сразу вернись к работе", text: "Перезвонил — сразу снимай «Перезвон». Открой «Кабинет»." },
  { target: "[data-coach=oktell-resume]", when: WORK, advanceWhen: `${ROOT}[data-pause=none]`, action: "Нажми", title: "Не дольше 3 минут", text: "Таймер показывает, сколько ты в «Перезвоне». Больше 3 минут — Oktell сам выкинет тебя. Нажми «Вернуться к работе»." },
  // Only when the three minutes ran out during the walk: log in and join again.
  { target: "[data-coach=oktell-login]", when: "[data-coach=oktell-kicked]", advanceWhen: WORK, action: "Войди", title: "Oktell выкинул тебя", text: "«Перезвон» длился больше 3 минут — так будет и на работе. Войди снова и после перезвона сразу возвращайся." },
  { target: NAV("cabinet"), when: "[data-coach=oktell-center][data-joined=false]", advanceWhen: SCREEN("cabinet"), action: "Нажми", title: "Снова в call-центр", text: "После нового входа ты не в call-центре. Открой «Кабинет»." },
  { target: "[data-coach=oktell-join]", advanceWhen: JOINED, action: "Нажми", title: "Войди в call-центр", text: "Нажми «Войти в call-центр», чтобы звонки снова поступали." },
  { target: NAV("journal"), when: `${ROOT}[data-journal=calls]`, advanceWhen: SCREEN("journal"), action: "Нажми", title: "Прослушай свой звонок", text: "Твой звонок водителю уже в журнале. Открой «Журнал»." },
  { target: "[data-coach=oktell-play]", when: "[data-coach=oktell-play]", advanceWhen: "[data-coach=oktell-player]", action: "Нажми ▶", title: "Запись разговора", text: "Нажми ▶ у звонка — так ты сам прослушиваешь свои разговоры. В учебной копии записи без звука." },
  { target: "[data-coach=oktell-status]", title: "Готово! Запомни главное", text: "Автоматический режим, веб-телефон и автоответ — всегда. Перезвон — через код парка, до 3 минут. Теперь водители будут звонить сами: отвечай голосом." },
];
