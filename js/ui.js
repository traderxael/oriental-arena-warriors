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
    const wrap = document.getElementById('hero-cards');
    if (!wrap) return;
    wrap.textContent = '';
    heroes.forEach((hero) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'card hero-card';
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
