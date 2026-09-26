// Tiny JSON settings store in the app's userData folder.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  bounds: null,
  alwaysOnTop: true,
  opacity: 1,
  lockAspect: true,
  compact: false,
  showInDock: false,
};

const file = () => path.join(app.getPath('userData'), 'settings.json');

let data = null;
let saveTimer = null;

function load() {
  try {
    data = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
  } catch {
    data = { ...DEFAULTS };
  }
  return data;
}

function get(key) {
  if (!data) load();
  return data[key];
}

function set(key, value) {
  if (!data) load();
  data[key] = value;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 300);
}

function flush() {
  clearTimeout(saveTimer);
  if (!data) return;
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Failed to save settings:', err);
  }
}

module.exports = { get, set, flush };
