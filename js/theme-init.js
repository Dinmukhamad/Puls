(function initThemeBeforePaint() {
  const savedTheme = localStorage.getItem('pulse-theme');
  const systemTheme = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const theme = savedTheme === 'dark' || savedTheme === 'light' ? savedTheme : systemTheme;
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.dataset.themeSource = savedTheme ? 'manual' : 'system';

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#000000' : '#F2F2F7';
})();
