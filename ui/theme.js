/* Apply before the first paint. This preference is shared by all workspaces. */
(function () {
  'use strict';
  if (typeof document === 'undefined') return;
  const key = 'bedazzle-theme';
  let saved;
  // Cookies are shared across loopback ports, so a new server port keeps the choice.
  saved = document.cookie.split('; ').find(value => value.startsWith(key + '='))?.slice(key.length + 1);
  if (saved !== 'dark' && saved !== 'light') {
    try { saved = localStorage.getItem(key); } catch (_) { /* Storage can be disabled. */ }
  }
  const system = matchMedia('(prefers-color-scheme: dark)');
  function apply(theme) {
    document.documentElement.dataset.theme = theme;
    const button = document.getElementById('theme-toggle');
    if (!button) return;
    const dark = theme === 'dark';
    button.setAttribute('aria-pressed', String(dark));
    button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    button.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
  }
  apply(saved === 'dark' || saved === 'light' ? saved : system.matches ? 'dark' : 'light');
  document.addEventListener('DOMContentLoaded', () => {
    apply(document.documentElement.dataset.theme);
    document.getElementById('theme-toggle').addEventListener('click', () => {
      saved = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      apply(saved);
      try { localStorage.setItem(key, saved); } catch (_) { /* Keep the session usable. */ }
      document.cookie = key + '=' + saved + '; Path=/; Max-Age=31536000; SameSite=Strict';
    });
  });
  system.addEventListener('change', () => { if (saved !== 'dark' && saved !== 'light') apply(system.matches ? 'dark' : 'light'); });
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    saved = event.key === null ? null : event.newValue;
    apply(saved === 'dark' || saved === 'light' ? saved : system.matches ? 'dark' : 'light');
  });
})();
