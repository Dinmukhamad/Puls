/* ══════════════════════════════════════════════════════════════
   КЛАВИАТУРА ДЛЯ ПОЛОС ВКЛАДОК

   ТЗ (раздел «Кнопки и формы», стр. 6) требует у вкладок состояния
   active/hover/focus и корректные роли. Роли расставлены на шести
   полосах, но обходились они только табом: стрелки не работали, и
   каждая вкладка была отдельной остановкой в обходе — на экране
   «Коины» это семь остановок подряд до содержимого.

   Здесь общий обработчик для любого [role="tablist"]:
     · Tab заходит в полосу один раз — на активную вкладку;
     · стрелки перемещают фокус по вкладкам, Home и End — к краям;
     · переключение по Enter или пробелу, то есть намеренно.

   Активация не привязана к перемещению фокуса намеренно: вкладки здесь
   меняют адрес и загружают данные, и «проматывание» стрелками
   запускало бы лишние запросы.
══════════════════════════════════════════════════════════════ */

function tablistTabs(list) {
  return [...list.querySelectorAll('[role="tab"]')]
    .filter(tab => tab.offsetParent !== null && !tab.disabled);
}

/** Одна остановка в обходе: активная вкладка, остальные — только стрелками. */
function tablistSyncRoving(list) {
  const tabs = tablistTabs(list);
  if (!tabs.length) return;
  const active = tabs.find(tab => tab.getAttribute('aria-selected') === 'true') || tabs[0];
  tabs.forEach(tab => { tab.tabIndex = tab === active ? 0 : -1; });
}

function tablistFocus(list, index) {
  const tabs = tablistTabs(list);
  if (!tabs.length) return;
  const next = tabs[(index + tabs.length) % tabs.length];
  tabs.forEach(tab => { tab.tabIndex = tab === next ? 0 : -1; });
  next.focus();
  next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function initTablistKeyboard() {
  if (initTablistKeyboard._bound) return;
  initTablistKeyboard._bound = true;

  document.addEventListener('keydown', event => {
    const tab = event.target.closest?.('[role="tab"]');
    const list = tab?.closest('[role="tablist"]');
    if (!tab || !list) return;

    const tabs = tablistTabs(list);
    const at = tabs.indexOf(tab);
    if (at === -1) return;

    // Вертикальные полосы в приложении не используются, но обрабатываем обе
    // пары стрелок: раскладка полосы может измениться на узком экране.
    const back = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';

    if (back || forward) {
      event.preventDefault();
      tablistFocus(list, at + (forward ? 1 : -1));
      return;
    }
    if (event.key === 'Home') { event.preventDefault(); tablistFocus(list, 0); return; }
    if (event.key === 'End') { event.preventDefault(); tablistFocus(list, tabs.length - 1); return; }
    if (event.key === 'Enter' || event.key === ' ') {
      // Кнопки сами обрабатывают Enter и пробел; ссылкам нужен пробел.
      if (tab.tagName !== 'BUTTON' && event.key === ' ') {
        event.preventDefault();
        tab.click();
      }
    }
  });

  // Полосы перерисовываются вместе с экранами, поэтому обход пересчитываем
  // после каждой отрисовки, а не один раз при загрузке.
  const observer = new MutationObserver(() => {
    document.querySelectorAll('[role="tablist"]').forEach(tablistSyncRoving);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  document.querySelectorAll('[role="tablist"]').forEach(tablistSyncRoving);
}
