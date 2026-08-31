(function initTheme() {
  // Пока выбора не было, идём за системной настройкой: раньше экран входа
  // всегда открывался белым, хотя тёмная палитра в токенах уже описана,
  // а переключатель темы лежит в меню и до входа недоступен.
  let stored = null;
  try { stored = localStorage.getItem('pulse-theme'); } catch (e) { /* приватный режим */ }
  const prefersDark = typeof matchMedia === 'function'
    && matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = stored || (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
})();
