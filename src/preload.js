// Injected into every page the main window loads (YouTube and Google sign-in).
// Adds the hover drag bar and the compact-mode flag. Runs in an isolated world.
const { ipcRenderer } = require('electron');

const BAR_ID = 'ytfloat-dragbar';

function makeButton(label, title, action) {
  const b = document.createElement('button');
  b.className = 'ytfloat-btn';
  b.textContent = label;
  b.title = title;
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    ipcRenderer.send('bar-action', action);
  });
  return b;
}

function ensureBar() {
  if (!document.body || document.getElementById(BAR_ID)) return;
  const bar = document.createElement('div');
  bar.id = BAR_ID;
  const buttons = document.createElement('div');
  buttons.className = 'ytfloat-buttons';
  buttons.append(
    makeButton('‹', 'Back', 'back'),
    makeButton('⌂', 'Home', 'home'),
    makeButton('✕', 'Close', 'close'),
  );
  bar.append(buttons);
  document.body.append(bar);
}

// Main process polls the cursor and tells us when it's over the top strip.
ipcRenderer.on('bar-visible', (_e, visible) => {
  ensureBar();
  document.documentElement.toggleAttribute('data-ytfloat-bar', visible);
});

ipcRenderer.on('compact', (_e, on) => {
  document.documentElement.toggleAttribute('data-ytfloat-compact', on);
  // Let YouTube's player re-measure itself.
  setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
  setTimeout(() => window.dispatchEvent(new Event('resize')), 400);
});

window.addEventListener('DOMContentLoaded', () => {
  ensureBar();
  // YouTube is a SPA and occasionally rebuilds parts of the page; keep the bar present.
  setInterval(ensureBar, 2000);
});
