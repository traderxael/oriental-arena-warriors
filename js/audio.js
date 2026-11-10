/* ============================================================
   audio.js — SFX procedurales con Web Audio (sin archivos externos)

   Binding léxico global (patrón ui.js): `Audio.init()` en el primer
   gesto del usuario (pointerdown/keydown, se auto-enlaza al cargar)
   y `Audio.play(nombre)` para disparar un efecto. Todo va envuelto
   en try/catch: si el navegador bloquea AudioContext (autoplay,
   incógnito, política de gestos), el juego sigue en silencio.

   Interfaz pública:
     Audio.init()               — crea/reanuda el AudioContext (idempotente)
     Audio.play(name)           — 'slash' | 'hit' | 'dash' | 'special' |
                                  'enemyDie' | 'waveStart' | 'uiClick' |
                                  'gameOver' | 'hurt'
     Audio.MASTER_VOLUME        — 0.5 (volumen maestro)
     Audio.debug()              — { ready, failed, played: { nombre: n } }
                                  (depuración/verificación headless)
   ============================================================ */

const Audio = (() => {
  const MASTER_VOLUME = 0.5;

  let ctx = null;          // AudioContext (null hasta el primer gesto / init)
  let master = null;       // GainNode maestro → ctx.destination
  let noiseBuf = null;     // buffer de ruido blanco reutilizado
  let failed = false;      // true si AudioContext no está disponible: no reintentar en bucle
  const played = Object.create(null); // contador por nombre (depuración)

  /* ---------- Contexto ---------- */

  function init() {
    try {
      if (ctx) {
        if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
          ctx.resume().catch(() => { /* el gesto siguiente lo reintentará */ });
        }
        return true;
      }
      if (failed) return false;
      const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
      if (!AC) { failed = true; return false; }
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = MASTER_VOLUME;
      master.connect(ctx.destination);
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        ctx.resume().catch(() => { /* silencioso: otro gesto reintentará */ });
      }
      return true;
    } catch (_err) {
      ctx = null;
      master = null;
      failed = true;
      return false;
    }
  }

  /** ¿Listo para sonar? Intenta init perezosamente; false si está bloqueado. */
  function ensure() {
    if (ctx && master) return true;
    return init();
  }

  function getNoiseBuffer() {
    if (noiseBuf) return noiseBuf;
    const len = Math.floor(ctx.sampleRate * 1);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  /* ---------- Primitivas de síntesis ---------- */

  /** Envuelta de ganancia: ataque lineal + caída exponencial hasta ~0. */
  function envelope(peak, attack, decay, t0) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(Math.max(peak, 0.0002), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    g.connect(master);
    return g;
  }

  /** Oscilador con glissando opcional from→to. */
  function tone({ type = 'sine', from = 440, to = null, dur = 0.2, peak = 0.4, attack = 0.008, when = 0 } = {}) {
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(from, 1), t0);
    if (to != null && to !== from) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t0 + dur);
    }
    const g = envelope(peak, attack, dur, t0);
    osc.connect(g);
    osc.start(t0);
    osc.stop(t0 + attack + dur + 0.05);
  }

  /** Ráfaga de ruido filtrado con barrido de frecuencia. */
  function noise({ dur = 0.2, peak = 0.4, attack = 0.006, when = 0, type = 'bandpass', from = 1000, to = null, Q = 1.2 } = {}) {
    const t0 = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = getNoiseBuffer();
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = Q;
    filter.frequency.setValueAtTime(Math.max(from, 10), t0);
    if (to != null && to !== from) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(to, 10), t0 + dur);
    }
    const g = envelope(peak, attack, dur, t0);
    src.connect(filter);
    filter.connect(g);
    src.start(t0);
    src.stop(t0 + attack + dur + 0.05);
  }

  /* ---------- Mapa nombre → síntesis ---------- */

  const SFX = {
    // Tajo: ruido + bandpass barriendo hacia abajo, con brillo de filo
    slash() {
      noise({ dur: 0.16, peak: 0.5, from: 2400, to: 520, Q: 1.6 });
      tone({ type: 'triangle', from: 950, to: 430, dur: 0.11, peak: 0.16 });
    },
    // Impacto: seno descendente + chasquido de ruido
    hit() {
      tone({ type: 'sine', from: 430, to: 130, dur: 0.17, peak: 0.6 });
      noise({ dur: 0.06, peak: 0.25, from: 1800, to: 900, Q: 1.0 });
    },
    // Dash: whoosh ascendente de ruido filtrado
    dash() {
      noise({ dur: 0.2, peak: 0.34, from: 300, to: 1500, Q: 2.1 });
    },
    // Especial: doble golpe metálico + shimmer
    special() {
      tone({ type: 'square', from: 660, to: 660, dur: 0.09, peak: 0.2, attack: 0.004 });
      tone({ type: 'square', from: 990, to: 990, dur: 0.16, peak: 0.2, attack: 0.004, when: 0.09 });
      tone({ type: 'sine', from: 1320, to: 1980, dur: 0.34, peak: 0.12, when: 0.1 });
      noise({ dur: 0.4, peak: 0.18, from: 3200, to: 1100, Q: 0.9, when: 0.05 });
    },
    // Enemigo derrotado: golpe grave descendente
    enemyDie() {
      tone({ type: 'sine', from: 190, to: 55, dur: 0.4, peak: 0.55 });
      noise({ dur: 0.26, peak: 0.28, from: 900, to: 210, Q: 1.1, when: 0.02 });
    },
    // Banner de oleada: doble tambor (don-don) tipo taiko
    waveStart() {
      tone({ type: 'sine', from: 112, to: 47, dur: 0.5, peak: 0.72, attack: 0.004 });
      tone({ type: 'sine', from: 96, to: 44, dur: 0.42, peak: 0.5, attack: 0.004, when: 0.27 });
      noise({ dur: 0.07, peak: 0.26, from: 1500, to: 750, Q: 1.4, when: 0.015 });
      noise({ dur: 0.07, peak: 0.2, from: 1300, to: 700, Q: 1.4, when: 0.285 });
    },
    // Clic de UI: blip corto y discreto
    uiClick() {
      tone({ type: 'square', from: 1250, to: 1080, dur: 0.05, peak: 0.15, attack: 0.002 });
    },
    // Fin de partida: frase descendente menor (sol–mi♭–si♭)
    gameOver() {
      const notes = [392.0, 311.13, 233.08];
      notes.forEach((freq, i) => {
        tone({ type: 'triangle', from: freq, to: freq * 0.985, dur: 0.34, peak: 0.38, when: i * 0.32 });
      });
      tone({ type: 'sine', from: 116.54, to: 116.54, dur: 0.6, peak: 0.2, when: 0.96 });
    },
    // Daño recibido: thud áspero
    hurt() {
      tone({ type: 'sawtooth', from: 240, to: 105, dur: 0.16, peak: 0.38 });
      noise({ dur: 0.09, peak: 0.2, from: 1050, to: 420, Q: 1.0 });
    },
  };

  /** Reproduce un SFX por nombre. Nunca lanza: silencio total si está bloqueado. */
  function play(name) {
    try {
      if (!ensure()) return false;
      const fn = SFX[name];
      if (typeof fn !== 'function') {
        if (typeof console !== 'undefined') console.warn('Audio.play: SFX desconocido "' + name + '".');
        return false;
      }
      fn();
      played[name] = (played[name] || 0) + 1;
      return true;
    } catch (_err) {
      return false; // silencioso por diseño
    }
  }

  /** Depuración/verificación headless: estado + nº de disparos por SFX. */
  function debug() {
    return {
      ready: !!(ctx && master),
      failed,
      state: ctx ? ctx.state : 'none',
      masterVolume: MASTER_VOLUME,
      played: { ...played },
    };
  }

  // Init perezosamente en el primer gesto (pointerdown / keydown): los menús
  // son la fuente natural del gesto. Se auto-enlaza; main.js no necesita hacerlo.
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    const onGesture = () => { init(); };
    window.addEventListener('pointerdown', onGesture, { once: true });
    window.addEventListener('keydown', onGesture, { once: true });
  }

  return { init, play, MASTER_VOLUME, debug };
})();
