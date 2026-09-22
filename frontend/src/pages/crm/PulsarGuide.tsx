export const GUIDE_STEPS = [
  { title: "Привет, я Пульсар!", text: "Это учебная CRM. Здесь можно отработать оформление звонков и чатов. Все обращения сохраняются и видны коллегам. Начнём с нового обращения?", target: "welcome" },
  { title: "Сначала — данные водителя", text: "Заполните телефон, с которого обратился водитель, и номер В/У из диспетчерской. ID необязателен. Выберите таксопарк — появится список городов.", target: "contact" },
  { title: "У каждого обращения свой путь", text: "Выбирайте категории последовательно: следующая зависит от предыдущей. Для водителя укажите его тип, затем консультацию, жалобу или запрос. Серые варианты пока недоступны.", target: "categories" },
  { title: "Передайте коллегам весь контекст", text: "Прочитайте инструкцию выбранной категории. Для запроса в таксопарк добавьте в комментарий ссылку на водителя. Скриншот можно загрузить, перетащить или вставить Ctrl+V.", target: "evidence" },
  { title: "Сохраните результат", text: "«Формировать тикет» создаст запрос для учебной обработки. После сохранения обращение появится в общей истории. Тренер сможет менять статус тикета. Можно возвращаться к практике в любое время.", target: "save" },
];

export function PulsarFace() {
  return <svg className="pulsar-face" viewBox="0 0 80 80" role="img" aria-label="Пульсар"><path d="M40 6v10M35 6h10" stroke="#5772ef" strokeWidth="4" strokeLinecap="round"/><ellipse cx="40" cy="66" rx="24" ry="5" fill="#dce5ff"/><path d="M14 34C14 11 66 11 66 34v15C66 72 14 72 14 49Z" fill="#7287ff"/><rect x="21" y="28" width="38" height="27" rx="12" fill="#233661"/><ellipse cx="31" cy="39" rx="3" ry="5" fill="#8effe0"/><ellipse cx="49" cy="39" rx="3" ry="5" fill="#8effe0"/><path d="M35 48q5 5 10 0" fill="none" stroke="#8effe0" strokeWidth="2" strokeLinecap="round"/><path d="m13 43-6 5m60-5 6-6" stroke="#7287ff" strokeWidth="5" strokeLinecap="round"/></svg>;
}

export function PulsarGuide({ step, onNext, onPrevious, onClose }: { step: number; onNext: () => void; onPrevious: () => void; onClose: () => void }) {
  const current = GUIDE_STEPS[step];
  return <aside className="pulsar-guide" aria-label="Обучение с Пульсаром"><PulsarFace /><div><div className="pulsar-guide-heading"><strong>{current.title}</strong><span>{step + 1} / {GUIDE_STEPS.length}</span></div><p>{current.text}</p><div className="pulsar-guide-actions">{step > 0 && <button onClick={onPrevious}>Назад</button>}<button className="crm-primary" onClick={onNext}>{step === 0 ? "Начать знакомство" : step === GUIDE_STEPS.length - 1 ? "Понятно, приступаю" : "Дальше →"}</button><button onClick={onClose}>Скрыть подсказки</button></div></div></aside>;
}
