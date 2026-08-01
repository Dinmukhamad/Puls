/* Shared accessible modal and bottom-sheet controller. */
let UI_MODAL_RETURN_FOCUS = null;

function modalFocusableElements(container) {
  if (!container) return [];
  return [...container.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter(node => !node.hidden && node.getAttribute('aria-hidden') !== 'true');
}

function showModal(html, options = {}) {
  let overlay = document.getElementById('modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'modal-overlay';
    overlay.className = 'modal-overlay';
    overlay.hidden = true;
    document.body.appendChild(overlay);
  }

  UI_MODAL_RETURN_FOCUS = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  const forced = Boolean(options.force);
  const extraClass = options.className
    ? String(options.className).replace(/[^a-zA-Z0-9_\- ]/g, '')
    : '';
  overlay.dataset.force = forced ? 'true' : 'false';
  overlay.innerHTML = `
    <div class="modal ${forced ? 'modal-forced' : ''} ${extraClass}" role="${options.role || 'dialog'}" aria-modal="true">
      ${html}
      ${forced ? '' : '<button class="modal-close" type="button" aria-label="Закрыть окно" data-modal-close>×</button>'}
    </div>`;
  overlay.hidden = false;
  document.body.classList.add('modal-open');

  const dialog = overlay.querySelector('.modal');
  const title = dialog?.querySelector('.modal-title, h1, h2, h3');
  if (dialog && title) {
    if (!title.id) title.id = `modal-title-${Date.now()}`;
    dialog.setAttribute('aria-labelledby', title.id);
  }
  overlay.onclick = event => {
    if (event.target === overlay && !forced) closeModal();
  };
  overlay.querySelector('[data-modal-close]')?.addEventListener('click', () => closeModal());
  requestAnimationFrame(() => {
    const focusable = modalFocusableElements(dialog);
    (focusable[0] || dialog)?.focus?.({ preventScroll: true });
    if (!focusable.length) dialog?.setAttribute('tabindex', '-1');
  });
}

function closeModal(force = false) {
  const overlay = document.getElementById('modal-overlay');
  if (!overlay || overlay.hidden) return;
  if (overlay.dataset.force === 'true' && !force) return;
  overlay.hidden = true;
  overlay.innerHTML = '';
  document.body.classList.remove('modal-open');
  if (typeof uiCancelPendingConfirm === 'function') uiCancelPendingConfirm();
  const returnFocus = UI_MODAL_RETURN_FOCUS;
  UI_MODAL_RETURN_FOCUS = null;
  if (returnFocus?.isConnected) requestAnimationFrame(() => returnFocus.focus({ preventScroll: true }));
}

document.addEventListener('keydown', event => {
  const overlay = document.getElementById('modal-overlay');
  if (!overlay || overlay.hidden) return;
  if (event.key === 'Escape' && overlay.dataset.force !== 'true') {
    event.preventDefault();
    closeModal();
    return;
  }
  if (event.key !== 'Tab') return;
  const dialog = overlay.querySelector('.modal');
  const focusable = modalFocusableElements(dialog);
  if (!focusable.length) {
    event.preventDefault();
    dialog?.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});
