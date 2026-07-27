(function initTheme() {
  const theme = localStorage.getItem('pulse-theme') || 'light';
  document.documentElement.setAttribute('data-theme', theme);
})();
