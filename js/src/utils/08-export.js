/* Общие утилиты интерфейса.
   Раньше жили в конце js/src/views/coins/30-admin-coins-groups-operators.view.js
   и работали только потому, что сборка склеивает всё в одну область видимости.
   Выгрузки CSV/XLSX. */

/* ══════════════════════════════════════
   EXPORT
══════════════════════════════════════ */
function exportCSV() {
  window.open(api.exportUrl('/api/exports/operators', { format: 'csv' }), '_blank');
}
function exportOperatorsXLSX() {
  window.open(api.exportUrl('/api/exports/operators', { format: 'xlsx' }), '_blank');
}

function exportHistoryCSV() {
  const header = ['Дата','Оператор','Группа','Тип','Коины','Причина','Автор'];
  const rows = STATE.history.map(t => [
    fmtDate(t.created_at), t.operator_name, t.group_name, t.type,
    t.amount, t.comment, t.created_by_name||'Система',
  ]);
  downloadCSV([header, ...rows], 'pulse_history');
}

function downloadCSV(rows, name) {
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}
