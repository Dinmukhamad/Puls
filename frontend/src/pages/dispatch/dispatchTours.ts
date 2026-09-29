/** Pulsar's walks through the training «Диспетчерская»: the tour of the cabinet and «Покажи, как» for every call. */
import type { CoachStep } from "../crm/coachTours";
import type { FleetCall, FleetDriver, FleetPark } from "../../api/dispatch";

const PAGE = (page: string) => `.fleet[data-page=${page}]`;
const DRIVER = (id: string) => `.fleet-driver[data-driver="${id}"]`;

export const FLEET_TOUR: CoachStep[] = [
  { target: "[data-coach=rail-people]", advanceWhen: "[data-coach=flyout]", autoClick: true, action: "Нажми", title: "Привет! Это Диспетчерская 👋", text: "Слева меню кабинета: о парке, исполнители, автомобили и помощь. Нажми на иконку — откроется список разделов." },
  { target: "[data-coach=flyout]", title: "Разделы", text: "Здесь «Исполнители», «На карте», «Условия сотрудничества» и «Инвентарь». Серые пункты в обучении не нужны." },
  { target: "[data-coach=menu-contractors]", advanceWhen: `${PAGE("contractors")} [data-coach=drivers-table]`, autoClick: true, action: "Нажми", title: "Исполнители", text: "Откроем «Исполнителей» — здесь ищут водителей и курьеров парка." },
  { target: "[data-coach=fleet-park]", title: "Парк и город", text: "Справа вверху — парк и город. Кабинет показывает только выбранный парк, поэтому сначала уточни у водителя его парк и город." },
  { target: "[data-coach=fleet-search]", title: "Поиск исполнителя", text: "Лупа открывает поиск по имени, номеру ВУ, телефону или госномеру — только в выбранном парке." },
  { target: "[data-coach=drivers-table]", title: "Список исполнителей", text: "ФИО и статус, телефон, баланс и лимит. Над списком — сегменты: новые, активные, отток и архив." },
  { target: "[data-coach=driver-row]", advanceWhen: "[data-coach=preview]", autoClick: true, action: "Нажми", title: "Короткая карточка", text: "Нажми на исполнителя — справа откроется короткая карточка." },
  { target: "[data-coach=preview]", title: "Коротко об исполнителе", text: "Телефон, ВУ, автомобиль, условия работы, баланс и инвентарь. Весь аккаунт открывается по имени." },
  { target: "[data-coach=preview-name]", advanceWhen: "[data-coach=summary]", autoClick: true, action: "Нажми", title: "Аккаунт", text: "Нажми на имя — откроется аккаунт исполнителя." },
  { target: "[data-coach=summary]", title: "Шапка аккаунта", text: "Работает ли исполнитель, статус, баланс и лимит на вывод, рейтинг, диагностика, приоритет и термокороб." },
  { target: "[data-coach=diagnostics]", title: "Диагностика", text: "Здесь видно, что мешает водителю выйти на линию: сигнал GPS, ограничение доступа и другое." },
  { target: "[data-coach=priority]", title: "Приоритет", text: "Баллы приоритета: за что они уже начислены и что ещё можно получить, например за брендинг." },
  { target: "[data-coach=driver-tabs]", title: "Вкладки аккаунта", text: "Детали, Автомобиль, Заработок, Ведомость, Заказы, Бонусы, История баланса, GPS и Фотоконтроль. «Историю изменений» и «Документы» не используем." },
  { target: "[data-coach=tab-car]", title: "Автомобиль и тарифы", text: "Во вкладке «Автомобиль» — машина, тарифы и оклейка. После любых изменений нажимай «Сохранить»." },
  { target: "[data-coach=summary]", title: "Теперь звонки ☎", text: "В моей панели ждут звонки водителей. Я сыграю водителя, а ты помоги ему здесь. «Покажи, как» проведёт по шагам." },
];

function parkSteps(park: FleetPark): CoachStep[] {
  const here = `[data-coach=fleet-park][data-park="${park.id}"]`;
  return [
    { target: "[data-coach=fleet-park]", skipWhen: here, advanceWhen: `[data-coach=park-menu], ${here}`, autoClick: true, action: "Нажми", title: "Парк водителя", text: `Водитель из парка «${park.name}», ${park.city}. Открой список парков справа вверху.` },
    { target: `[data-coach=park-option][data-park="${park.id}"]`, skipWhen: here, advanceWhen: here, autoClick: true, action: "Выбери", title: "Выбери парк и город", text: "Выбери парк и город водителя: поиск и разделы покажут только исполнителей этого парка." },
  ];
}

function findSteps(driver: FleetDriver, what: string, hint: string): CoachStep[] {
  const opened = DRIVER(driver.id), preview = `[data-coach=preview][data-driver="${driver.id}"]`;
  return [
    { target: "[data-coach=fleet-search]", skipWhen: `${opened}, [data-coach=search-input], ${preview}`, advanceWhen: "[data-coach=search-input]", autoClick: true, action: "Нажми", title: "Поиск", text: "Нажми на лупу рядом с парком — откроется поиск." },
    { target: "[data-coach=search-input]", skipWhen: `${opened}, ${preview}`, advanceWhen: `[data-coach=search-result][data-driver="${driver.id}"]`, action: "Впиши", title: "Что ищем", text: `Впиши ${what}. Хватит трёх букв или цифр.` },
    { target: `[data-coach=search-result][data-driver="${driver.id}"]`, skipWhen: `${opened}, ${preview}`, advanceWhen: preview, autoClick: true, action: "Нажми", title: "Нужный аккаунт", text: hint },
    { target: `${preview} [data-coach=preview-name]`, skipWhen: opened, advanceWhen: opened, autoClick: true, action: "Нажми", title: "Аккаунт водителя", text: "Нажми на имя водителя — откроется его аккаунт." },
  ];
}

const tab = (driver: FleetDriver, id: string, marker: string, title: string, text: string): CoachStep =>
  ({ target: `[data-coach=tab-${id}]`, skipWhen: `${DRIVER(driver.id)} [data-coach=${marker}]`, advanceWhen: `${DRIVER(driver.id)} [data-coach=${marker}]`, autoClick: true, action: "Нажми", title, text });
const menu = (group: string, page: string, title: string, text: string): CoachStep[] => [
  { target: `[data-coach=rail-${group}]`, skipWhen: PAGE(page), advanceWhen: `[data-coach=menu-${page}], ${PAGE(page)}`, autoClick: true, action: "Нажми", title, text },
  { target: `[data-coach=menu-${page}]`, skipWhen: PAGE(page), advanceWhen: PAGE(page), autoClick: true, action: "Нажми", title, text: "Выбери раздел в меню." },
];
const diagnostics: CoachStep[] = [
  { target: "[data-coach=diagnostics]", advanceWhen: "[data-coach=diagnostics-panel]", autoClick: true, action: "Нажми", title: "Диагностика", text: "Нажми «Диагностика» в шапке аккаунта: там написано, что мешает выйти на линию." },
  { target: "[data-coach=diagnostics-panel]", title: "Причина", text: "Прочитай причину. Потом закрой панель крестиком и ответь водителю в моей панели." },
];
const limit: CoachStep[] = [
  { target: "[data-coach=withdraw-limit]", advanceWhen: PAGE("antifraud"), autoClick: true, action: "Нажми", title: "Серая сумма", text: "Серая сумма с замком — лимит на вывод: её водитель вывести не может. Нажми на неё." },
  { target: "[data-coach=antifraud-table]", title: "Правило антифрода", text: "Смотри столбец «Правило». «Не сданы закрывающие документы» — лимит снимет только Яндекс после проверки документов." },
  { target: "[data-coach=antifraud-order]", when: `${PAGE("antifraud")} [data-coach=antifraud-order]`, advanceWhen: PAGE("order"), autoClick: true, action: "Нажми", title: "Номер заказа", text: "Для правил «Продолжительность поездки» и «Стоимость поездки» открой заказ: важен его тариф." },
  { target: "[data-coach=order-tariff]", when: PAGE("order"), title: "Тариф заказа", text: "Не «Межгород» — лимит снимает отдел ООЗ по запросу из CRM. «Межгород» — такой лимит ООЗ не снимает." },
  { target: "[data-coach=order-transactions]", when: PAGE("order"), title: "Транзакции", text: "«Транзакции» показывают все операции именно по этому заказу. Теперь ответь водителю в моей панели." },
];

/** «Покажи, как» for one call; targets use the call's own park and driver. */
export function callTour(call: FleetCall, driver: FleetDriver, park: FleetPark): CoachStep[] {
  const surname = `фамилию «${driver.last_name}»`;
  switch (call.id) {
    case "provider": return [...parkSteps(park), ...findSteps(driver, `номер ВУ ${driver.license}`, "Выбери аккаунт, который «Работает»: у водителя есть ещё архивный."),
      tab(driver, "details", "provider", "Детали", "Провайдер ЭДО — во вкладке «Детали»."),
      { target: "[data-coach=provider]", advanceWhen: "[data-coach=details-save]", action: "Выбери", title: "Провайдер ЭДО", text: "Провайдер должен быть «Sapar». Если стоит другой — выбери Sapar в списке." },
      { target: "[data-coach=details-save]", action: "Нажми", title: "Сохрани", text: "Нажми «Сохранить» — без этого провайдер не сменится." }];
    case "gps": return [...parkSteps(park), ...findSteps(driver, `телефон ${driver.phone.slice(2)}`, "Нажми на водителя в результатах."), ...diagnostics];
    case "car": return [...parkSteps(park), ...findSteps(driver, surname, "Нажми на водителя в результатах."),
      tab(driver, "car", "tariffs", "Автомобиль", "Тарифы и оклейка — во вкладке «Автомобиль»."),
      { target: "[data-coach=tariff-add]", action: "Выбери", title: "Добавь тариф", text: "В списке «Добавить» выбери «Комфорт». Остальные тарифы водителя не убирай." },
      { target: "[data-coach=wrap]", action: "Отметь", title: "Оклейка", text: "Отметь «Оклейка»: это брендинг на машине, реклама только самого Яндекса." },
      { target: "[data-coach=fleet-car-save]", action: "Нажми", title: "Сохрани", text: "Нажми «Сохранить». Крестик у «Оклейки» значит: фотоконтроль брендинга ещё не пройден, галочка — пройден." }];
    case "thermobox": return [...parkSteps(park), ...menu("people", "inventory", "Инвентарь", "Инвентарь — в меню исполнителей. Открой его."),
      { target: "[data-coach=inventory-add]", skipWhen: "[data-coach=inventory-dialog]", advanceWhen: "[data-coach=inventory-dialog]", autoClick: true, action: "Нажми", title: "Выдать инвентарь", text: "Нажми жёлтый «+» — откроется выдача." },
      { target: "[data-coach=inventory-type]", advanceWhen: "[data-coach=inventory-code]", action: "Выбери", title: "Тип инвентаря", text: "Яндекс Еда — жёлтый термокороб, Яндекс Доставка — чёрный. Курьер просит жёлтый." },
      { target: "[data-coach=inventory-code]", action: "Впиши", title: "Код курьера", text: "Попроси у меня код в панели звонка: у курьера он в Яндекс Про → Профиль → Инвентарь. Код живёт 2 минуты." },
      { target: "[data-coach=inventory-number]", action: "Впиши", title: "Номер на термокоробе", text: "Напиши номер на термокоробе, например EP0812, и впиши его сюда." },
      { target: "[data-coach=inventory-save]", action: "Нажми", title: "Сохрани", text: "Нажми «Сохранить» — выдача появится в списке. Потом курьер проходит фотоконтроль термокороба." }];
    case "support": return [...parkSteps(park), ...findSteps(driver, `номер ВУ ${driver.license}`, "Нажми на водителя в результатах."), ...diagnostics.slice(0, 1),
      { target: "[data-coach=diagnostics-panel]", title: "Ограничение", text: "Такое ограничение может снять только поддержка Яндекса. Напишем им обращение." },
      ...menu("help", "support", "Техподдержка", "Обращения в поддержку Яндекса — в разделе «Помощь»."),
      { target: "[data-coach=support-add]", skipWhen: "[data-coach=ticket-form]", advanceWhen: "[data-coach=ticket-form]", autoClick: true, action: "Нажми", title: "Новое обращение", text: "Нажми «+». Парк справа вверху уже должен быть парком водителя." },
      { target: "[data-coach=support-private]", title: "Доступ", text: "«Доступ: мне и моей роли» оставь выключенным — так обращение увидят коллеги." },
      { target: "[data-coach=support-theme]", advanceWhen: "[data-coach=support-subtheme]", action: "Выбери", title: "Тема", text: "Тема — «Вопросы об исполнителе»." },
      { target: "[data-coach=support-subtheme]", advanceWhen: "[data-coach=support-license]", action: "Выбери", title: "Подтема", text: "Рейтинг, приоритет, тарифы — «Рейтинг и показатели». Здесь ограничили доступ — «Ограничение доступа к сервису»." },
      { target: "[data-coach=support-license]", action: "Впиши", title: "Номер в/у", text: `Номер ВУ возьми в аккаунте водителя: ${driver.license}.` },
      { target: "[data-coach=support-text]", action: "Напиши", title: "Текст обращения", text: "Начни с «ДД! Прошу проверить…» и коротко опиши, что случилось у водителя." },
      { target: "[data-coach=support-files]", title: "Файлы", text: "Если нужно, приложи файлы — до восьми штук." },
      { target: "[data-coach=support-send]", action: "Нажми", title: "Отправь", text: "Нажми «Отправить». Ответ поддержки придёт в «Мои обращения»." }];
    default: return [...parkSteps(park), ...findSteps(driver, surname, "Нажми на водителя в результатах."), ...limit];
  }
}
