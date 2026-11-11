/* ============================================================
   quality.js — Niveles de calidad gráficos

   Interfaz pública:
     Quality.level            — 'alta' | 'media' | 'baja'
     Quality.preset()         — { bloom, pixelRatio, shadow, petals }
     Quality.set(level)       — persiste (oaw_quality) y notifica
     Quality.downgrade()      — baja un nivel si puede (auto-guard)
     Quality.onChange(fn)     — fn(level, preset) al cambiar

   Prioridad: ?quality= en URL > localStorage > 'alta'.
   El auto-guard de main.js llama downgrade() si la media de frame
   supera 33 ms durante 120 frames seguidos.
   ============================================================ */

const LEVELS = ['baja', 'media', 'alta'];
const PRESETS = {
  alta: { bloom: true, pixelRatio: 2, shadow: 2048, petals: 200 },
  media: { bloom: true, pixelRatio: 1, shadow: 1024, petals: 120 },
  baja: { bloom: false, pixelRatio: 1, shadow: 1024, petals: 60 },
};
const STORAGE_KEY = 'oaw_quality';

function readInitial() {
  try {
    const url = new URLSearchParams(window.location.search).get('quality');
    if (url && PRESETS[url]) return url;
  } catch (_err) { /* sin URL */ }
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && PRESETS[saved]) return saved;
  } catch (_err) { /* incógnito */ }
  return 'alta';
}

let level = readInitial();
const listeners = new Set();

function persist() {
  try {
    window.localStorage.setItem(STORAGE_KEY, level);
  } catch (_err) { /* incógnito: la sesión manda */ }
}

const Quality = {
  get level() {
    return level;
  },
  preset() {
    return PRESETS[level];
  },
  set(next) {
    if (!PRESETS[next] || next === level) return false;
    level = next;
    persist();
    for (const fn of listeners) fn(level, PRESETS[level]);
    return true;
  },
  downgrade() {
    const idx = LEVELS.indexOf(level);
    if (idx <= 0) return false;
    return Quality.set(LEVELS[idx - 1]);
  },
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

export { Quality };
export default Quality;

if (typeof window !== 'undefined') window.__quality = Quality;