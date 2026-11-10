/* ============================================================
   ui.js — Renderizado de pantallas y HUD
   Expone el global `ui` con:
     ui.showScreen(id)   — muestra SÓLO la pantalla #screen-{id}
                           (id 'hud' controla #hud). Ids válidos:
                           'title' | 'mode' | 'hero' | 'map' | 'pause' | 'gameover' | 'hud'
     ui.setHeroCards(heroes) — pinta las tarjetas de selección de héroe
     ui.showGameOver(stats)  — rellena #screen-gameover y lo muestra
   ============================================================ */

const ui = (() => {
  const SCREENS = ['title', 'mode', 'hero', 'map', 'pause', 'gameover', 'hud'];

  function screenEl(id) {
    return document.getElementById(id === 'hud' ? 'hud' : 'screen-' + id);
  }

  /** Muestra sólo la pantalla indicada; oculta el resto. */
  function showScreen(id) {
    if (SCREENS.indexOf(id) === -1) {
      console.warn('ui.showScreen: pantalla desconocida "' + id + '". Ids válidos: ' + SCREENS.join(', '));
      return;
    }
    SCREENS.forEach((s) => {
      const el = screenEl(s);
      if (el) el.classList.toggle('visible', s === id);
    });
  }

  /**
   * Pinta las tarjetas de héroe en #hero-cards.
   * heroes: [{ id, name, epithet, desc, stats: { fuerza, velocidad, defensa } }] (stats 0–100)
   * La selección se marca con la clase .selected; el clic lo gestiona main.js.
   */
  function setHeroCards(heroes) {
    const wrap = document.getElementById('hero-cards');
    if (!wrap) return;
    wrap.innerHTML = '';
    heroes.forEach((hero) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'card hero-card';
      card.dataset.heroId = hero.id;
      card.setAttribute('role', 'option');
      card.setAttribute('aria-selected', 'false');

      const stat = (label, value) => {
        const v = Math.max(0, Math.min(100, Number(value) || 0));
        return '<div class="stat-row"><span>' + label + '</span>' +
          '<div class="stat-track"><div class="stat-fill" style="width:' + v + '%"></div></div></div>';
      };

      card.innerHTML =
        '<span class="card-kanji" aria-hidden="true">' + (hero.kanji || '武') + '</span>' +
        '<span class="card-title">' + hero.name + '</span>' +
        '<span class="card-desc"><em>' + (hero.epithet || '') + '</em><br>' + (hero.desc || '') + '</span>' +
        '<span class="hero-stats">' +
          stat('Fuerza', hero.stats && hero.stats.fuerza) +
          stat('Velocidad', hero.stats && hero.stats.velocidad) +
          stat('Defensa', hero.stats && hero.stats.defensa) +
        '</span>';

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
  }

  /** Rellena y muestra la pantalla de fin de partida. */
  function showGameOver(stats) {
    const s = stats || {};
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(value == null ? 0 : value);
    };
    set('go-wave', s.wave);
    set('go-kills', s.kills);
    set('go-score', s.score);
    set('go-best', s.best);
    showScreen('gameover');
  }

  /** Resetea los indicadores del HUD a sus valores iniciales. */
  function resetHud() {
    const hp = document.getElementById('hud-hp-fill');
    const qi = document.getElementById('hud-qi-fill');
    const wave = document.getElementById('hud-wave');
    const score = document.getElementById('hud-score');
    if (hp) hp.style.width = '100%';
    if (qi) qi.style.width = '50%';
    if (wave) wave.textContent = '1';
    if (score) score.textContent = '0';
  }

  return { showScreen, setHeroCards, selectHeroCard, showGameOver, resetHud };
})();
