/* Инициализация темы до первой отрисовки — без вспышки светлого фона.
   Приоритет: явный выбор пользователя > системная настройка > светлая. */
(function initTheme() {
  var stored = null;
  try { stored = localStorage.getItem('pulse-theme'); } catch (e) { /* приватный режим */ }

  var theme = stored;
  if (theme !== 'light' && theme !== 'dark') {
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    theme = prefersDark ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', theme);

  // Пока пользователь не выбрал тему вручную — следуем за системой.
  if (!stored && window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
      try { if (localStorage.getItem('pulse-theme')) return; } catch (err) { /* игнор */ }
      document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
    });
  }
})();
