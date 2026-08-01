/* Общие утилиты интерфейса.
   Раньше жили в конце js/src/views/coins/30-admin-coins-groups-operators.view.js
   и работали только потому, что сборка склеивает всё в одну область видимости.
   Модальные окна: showModal, closeModal, updateModal. */

/* ══════════════════════════════════════
   MODALS
══════════════════════════════════════ */
function showModal(html, options = {}) {
  let overlay = document.getElementById('modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'modal-overlay';
    overlay.className = 'modal-overlay';
    document.body.appendChild(overlay);
  }
  const forced = Boolean(options.force);
  overlay.dataset.force = forced ? 'true' : 'false';
  const extraClass = options.className ? String(options.className).replace(/[^a-zA-Z0-9_\- ]/g, '') : '';
  overlay.innerHTML = `<div class="modal ${forced ? 'modal-forced' : ''} ${extraClass}">${html}${forced ? '' : '<button class="modal-close" onclick="closeModal()">✕</button>'}</div>`;
  overlay.style.display = 'flex';
  overlay.onclick = e => { if (e.target === overlay && !forced) closeModal(); };
}
function closeModal(force = false) {
  const o = document.getElementById('modal-overlay');
  if (o?.dataset.force === 'true' && !force) return;
  if (o) o.style.display = 'none';
  if (typeof uiCancelPendingConfirm === 'function') uiCancelPendingConfirm();
}

function updateModal(html) {
  // Обновляем содержимое открытого модального окна
  const overlay = document.getElementById('modal-overlay');
  const modal = overlay?.querySelector('.modal');
  if (modal) {
    modal.innerHTML = html + '<button class="modal-close" onclick="closeModal()">✕</button>';
  } else {
    showModal(html);
  }
}
