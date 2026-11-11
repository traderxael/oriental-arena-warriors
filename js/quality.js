/* ============================================================
   quality.js — Niveles de calidad gráficos

   Interfaz pública:
     Quality.level            — 'alta' | 'media' | 'baja'
     Quality.lockedByUrl      — true si ?quality= se fijó explícitamente (salvo ?autoguard=1)
     Quality.preset()         — { bloom, bloomScale, shadows, pixelRatio, shadow, petals }
     Quality.set(level)       — persiste (oaw_quality) y notifica
     Quality.downgrade()      — baja un nivel si puede (auto-guard)
     Quality.onChange(fn)     — fn(level, preset) al cambiar

   Prioridad: ?quality= en URL > localStorage > 'alta'.
   El auto-guard de main.js llama downgrade() si la media de frame
   supera 33 ms durante 120 frames seguidos.
   ============================================================ */

const LEVELS = ['baja', 'media', 'alta'];
const PRESETS = {
  alta: { bloom: true, bloomScale: 0.5, shadows: true, pixelRatio: 2, shadow: 2048, petals: 200 },
  media: { bloom: true, bloomScale: 0.25, shadows: true, pixelRatio: 1, shadow: 1024, petals: 120 },
  baja: { bloom: false, bloomScale: 0, shadows: false, pixelRatio: 1, shadow: 1024, petals: 60 },
};
const STORAGE_KEY = 'oaw_quality';

let lockedByUrl = false;

function readInitial() {
  try {
    const params = new URLSearchParams(window.location.search);
    const url = params.get('quality');
    const forceGuard = params.get('autoguard') === '1';
    if (url && PRESETS[url]) {
      lockedByUrl = !forceGuard;
      return url;
    }
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
  get lockedByUrl() {
    return lockedByUrl;
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
