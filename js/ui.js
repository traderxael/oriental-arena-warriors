/* ============================================================
   ui.js — Renderizado de pantallas y HUD
   Expone el global `ui` con:
     ui.showScreen(id)   — muestra SÓLO la pantalla #screen-{id}
                           (id 'hud' controla #hud). Ids válidos:
                           'title' | 'mode' | 'hero' | 'map' | 'pause' | 'gameover' | 'hud'
     ui.setHeroCards(heroes) — pinta las tarjetas de selección de héroe
     ui.setHudMode(id)       — adapta el HUD al modo (hordas/supervivencia/duelo)
     ui.showGameOver(stats)  — rellena #screen-gameover y lo muestra
     ui.showBanner(texto)    — destello central (#banner-wave)
   ============================================================ */

const ui = (() => {
  const SCREENS = ['title', 'mode', 'hero', 'map', 'pause', 'gameover', 'hud'];
  let cachedHeroes = [];

  function screenEl(id) {
    return document.getElementById(id === 'hud' ? 'hud' : 'screen-' + id);
  }

  /**
   * Muestra sólo la pantalla indicada; oculta el resto.
   * Devuelve true si la pantalla existe y se mostró, false en caso contrario.
   */
  function showScreen(id) {
    if (SCREENS.indexOf(id) === -1) {
      console.warn('ui.showScreen: pantalla desconocida "' + id + '". Ids válidos: ' + SCREENS.join(', '));
      return false;
    }
    SCREENS.forEach((s) => {
      const el = screenEl(s);
      if (el) el.classList.toggle('visible', s === id);
    });
    return true;
  }

  /** Crea una fila de estadística (etiqueta + barra) usando sólo DOM/textContent. */
  function createStatRow(label, value) {
    const v = Math.max(0, Math.min(100, Number(value) || 0));
    const row = document.createElement('div');
    row.className = 'stat-row';

    const name = document.createElement('span');
    name.textContent = label;

    const track = document.createElement('div');
    track.className = 'stat-track';

    const fill = document.createElement('div');
    fill.className = 'stat-fill';
    fill.style.width = v + '%';

    track.appendChild(fill);
    row.appendChild(name);
    row.appendChild(track);
    return row;
  }

  /**
   * Pinta las tarjetas de héroe en #hero-cards.
   * heroes: [{ id, name, epithet, desc, kanji, story, theme, weapon,
   *             stats: { fuerza, velocidad, defensa } (0–100),
   *             special: { name, cooldown, desc } }]
   * La selección se marca con la clase .selected; el clic lo gestiona main.js.
   * Todo el contenido se inserta vía textContent/DOM API (sin innerHTML).
   */
  function setHeroCards(heroes) {
    cachedHeroes = Array.isArray(heroes) ? heroes : [];
    const wrap = document.getElementById('hero-cards');
    if (!wrap) return;
    wrap.textContent = '';
    cachedHeroes.forEach((hero, idx) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'card hero-card';
      card.style.setProperty('--stagger', String(idx));
      card.dataset.heroId = hero.id;
      card.setAttribute('role', 'option');
      card.setAttribute('aria-selected', 'false');

      const kanji = document.createElement('span');
      kanji.className = 'card-kanji';
      kanji.setAttribute('aria-hidden', 'true');
      kanji.textContent = hero.kanji || '武';

      const title = document.createElement('span');
      title.className = 'card-title';
      title.textContent = hero.name;

      const tags = document.createElement('span');
      tags.className = 'hero-tags';
      tags.textContent = [hero.theme, hero.weapon].filter(Boolean).join(' · ');

      const desc = document.createElement('span');
      desc.className = 'card-desc';
      const epithet = document.createElement('em');
      epithet.textContent = hero.epithet || '';
      desc.appendChild(epithet);
      desc.appendChild(document.createElement('br'));
      desc.appendChild(document.createTextNode(hero.desc || ''));

      const story = document.createElement('span');
      story.className = 'hero-story';
      const storyLabel = document.createElement('span');
      storyLabel.className = 'hero-story-label';
      storyLabel.textContent = 'Historia';
      story.appendChild(storyLabel);
      story.appendChild(document.createTextNode(hero.story || ''));

      const stats = document.createElement('span');
      stats.className = 'hero-stats';
      const s = hero.stats || {};
      stats.appendChild(createStatRow('Fuerza', s.fuerza));
      stats.appendChild(createStatRow('Velocidad', s.velocidad));
      stats.appendChild(createStatRow('Defensa', s.defensa));

      const special = document.createElement('span');
      special.className = 'hero-special';
      const sp = hero.special || {};
      const spName = document.createElement('span');
      spName.className = 'hero-special-name';
      spName.textContent = 'Q · ' + (sp.name || 'Especial') +
        (sp.cooldown != null ? ' (' + sp.cooldown + ' s)' : '');
      const spDesc = document.createElement('span');
      spDesc.className = 'hero-special-desc';
      spDesc.textContent = sp.desc || '';
      special.appendChild(spName);
      special.appendChild(spDesc);

      card.appendChild(kanji);
      card.appendChild(title);
      if (tags.textContent) card.appendChild(tags);
      card.appendChild(desc);
      if (hero.story) card.appendChild(story);
      card.appendChild(stats);
      card.appendChild(special);
      wrap.appendChild(card);
    });
  }

  /** Marca una tarjeta de héroe como seleccionada (quita la selección del resto). */
  function selectHeroCard(heroId) {
    document.querySelectorAll('#hero-cards .hero-card').forEach((card) => {
      const selected = card.dataset.heroId === heroId;
      card.classList.toggle('selected', selected);
      card.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
    const hero = cachedHeroes.find((h) => h.id === heroId);
    if (hero) {
      const nameEl = document.getElementById('hero-preview-name');
      const epithetEl = document.getElementById('hero-preview-epithet');
      if (nameEl) nameEl.textContent = hero.name || '';
      if (epithetEl) epithetEl.textContent = hero.epithet || '';
      const st = hero.stats || {};
      const setMetric = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(val);
      };
      setMetric('hpv-hp', st.hp != null ? st.hp : '—');
      setMetric('hpv-dmg', st.damage != null ? st.damage : '—');
      setMetric('hpv-rng', st.range != null ? st.range + ' m' : '—');
      setMetric('hpv-wpn', hero.weapon || '—');
    }
  }

  /** Formatea segundos como MM:SS (Tiempo en HUD y game over). */
  function formatTime(totalSeconds) {
    const t = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const m = Math.floor(t / 60);
    const s = t % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  const MODE_LABELS = { hordas: 'Hordas', supervivencia: 'Supervivencia', duelo: 'Duelo' };
  const BEST_LABELS = {
    hordas: 'Mejor puntuación · Hordas',
    supervivencia: 'Mejor puntuación · Supervivencia',
    duelo: 'Mejor puntuación · Duelo',
  };

  /** Muestra u oculta un elemento por id (clase .hidden). */
  function setHidden(id, hidden) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !!hidden);
  }

  /** Adapta el HUD al modo elegido: etiqueta, fila de oleada, buffs y barra de boss. */
  function setHudMode(id) {
    const mode = MODE_LABELS[id] ? id : 'hordas';
    const label = document.getElementById('hud-mode');
    if (label) label.textContent = MODE_LABELS[mode];
    setHidden('hud-wave-stat', mode === 'duelo');
    setHidden('hud-buffs', mode !== 'supervivencia');
    setHidden('hud-boss', mode !== 'duelo');
  }

  /** Rellena y muestra la pantalla de fin de partida (derrota o victoria, por modo). */
  function showGameOver(stats) {
    const s = stats || {};
    const mode = MODE_LABELS[s.mode] ? s.mode : 'hordas';
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(value == null ? 0 : value);
    };
    const seal = document.getElementById('go-seal');
    if (seal) {
      seal.textContent = s.won ? '勝' : '敗';
      seal.classList.toggle('victory', !!s.won);
    }
    const heading = document.querySelector('#screen-gameover .screen-heading');
    if (heading) {
      heading.textContent = s.won ? '¡Victoria!' : 'Has caído en la arena';
      heading.classList.toggle('victory', !!s.won);
    }
    set('go-mode', MODE_LABELS[mode]);
    set('go-wave', s.wave);
    set('go-kills', s.kills);
    set('go-time', formatTime(s.time));
    set('go-score', s.score);
    // Filas por modo: oleada (hordas/supervivencia), orbes (supervivencia), HP (duelo)
    setHidden('go-wave-row', mode === 'duelo');
    setHidden('go-pickups-row', mode !== 'supervivencia');
    setHidden('go-hp-row', mode !== 'duelo');
    set('go-pickups', s.pickups);
    set('go-hp', s.hpLeft);
    // Mejor: '—' si no hay récord guardado todavía
    const bestEl = document.getElementById('go-best');
    if (bestEl) bestEl.textContent = s.hasBest ? String(s.best) : '—';
    set('go-best-label', BEST_LABELS[mode]);
    const record = document.getElementById('go-record');
    if (record) record.classList.toggle('hidden', !s.isRecord);
    showScreen('gameover');
  }

  let bannerTimer = null;

  /** Muestra un destello central con el texto (p. ej. "OLEADA 3"); se oculta solo. */
  function showBanner(text) {
    const el = document.getElementById('banner-wave');
    if (!el) return;
    el.textContent = String(text == null ? '' : text);
    el.classList.remove('on');
    // Forzar reflow para reiniciar la animación si el banner ya estaba visible
    void el.offsetWidth;
    el.classList.add('on');
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => el.classList.remove('on'), 2400);
  }

  /** Resetea los indicadores del HUD a sus valores iniciales. */
  function resetHud() {
    const hp = document.getElementById('hud-hp-fill');
    const qi = document.getElementById('hud-qi-fill');
    const wave = document.getElementById('hud-wave');
    const score = document.getElementById('hud-score');
    const timer = document.getElementById('hud-timer');
    if (hp) hp.style.width = '100%';
    const hpBar = document.getElementById('hud-hp');
    if (hpBar) {
      hpBar.setAttribute('aria-valuenow', '100');
      hpBar.classList.remove('low-hp', 'heal-flash');
    }
    const hpText = document.getElementById('hud-hp-text');
    if (hpText) hpText.textContent = '100 / 100';
    if (qi) qi.style.width = '100%';
    const qiBar = document.getElementById('hud-qi');
    if (qiBar) qiBar.setAttribute('aria-valuenow', '100');
    if (wave) wave.textContent = '1';
    if (score) score.textContent = '0';
    if (timer) timer.textContent = '00:00';
    setHidden('hud-boss', true);
    setHidden('hud-buffs', true);
    const bossFill = document.getElementById('hud-boss-fill');
    if (bossFill) bossFill.style.width = '100%';
    const bossBar = document.getElementById('hud-boss-bar');
    if (bossBar) bossBar.setAttribute('aria-valuenow', '100');
    const bossHp = document.getElementById('hud-boss-hp');
    if (bossHp) bossHp.textContent = '600 / 600';
  }

  return { showScreen, setHeroCards, selectHeroCard, setHudMode, showGameOver, showBanner, resetHud };
})();
