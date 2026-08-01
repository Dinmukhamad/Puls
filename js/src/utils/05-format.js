/* Общие утилиты интерфейса.
   Раньше жили в конце js/src/views/coins/30-admin-coins-groups-operators.view.js
   и работали только потому, что сборка склеивает всё в одну область видимости.
   Форматирование и проверки ролей: esc, fmtDate, roleLabel, isAdmin и т.д.
   esc() вызывается 661 раз по проекту — её место здесь, а не во вьюхе коинов. */

/* ══════════════════════════════════════
   HELPERS
══════════════════════════════════════ */
function esc(s) {
  return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function fmtDate(dt) {
  return dt ? uiDate(dt) : '';
}
function fmtDateTime(dt) {
  return dt ? uiDateTime(dt) : '';
}
function roleLabel(r) {
  return { operator:'Оператор', supervisor:'Супервайзер', manager:'Руководитель', admin:'Администратор' }[r] || r || '';
}
function statusLabel(s) {
  return uiStatusLabel(s);
}
function isAdmin(role) { return ['supervisor','manager','admin'].includes(role); }
function canManageGroups(role = STATE.user?.role) { return ['manager','admin'].includes(role); }
function canManageOperators() {
  const role = STATE.user?.role;
  return ['manager','admin'].includes(role) || (role === 'supervisor' && STATE.user?.can_manage_operators);
}
