(() => {
  const config = globalThis.MOSS_GUARD_CONFIG;
  const game = globalThis.createMossGuard(config);
  const { state } = game;
  const $ = id => document.getElementById(id);
  const canvas = $('field');
  const ctx = canvas.getContext('2d');
  const play = $('play');
  const pauseButton = $('pause-button');
  const dialog = $('asset-dialog');
  const ui = {
    overlay: $('overlay'),
    title: $('overlay-title'),
    copy: $('overlay-copy'),
    banner: $('wave-banner'),
    score: $('score'),
    best: $('best-score'),
    hearts: $('hearts'),
    wave: $('wave'),
    message: $('game-message'),
    assetMessage: $('asset-message')
  };

  const assets = Object.fromEntries(Object.entries(config.assets).map(([kind, slot]) => [kind, {
    ...slot, kind, image: null, defaultImage: null, url: slot.source, objectUrl: null,
    custom: false, name: '默认素材', change: 0, busy: false
  }]));
  const activeKeys = new Set();
  const directionPointers = new Map();
  const attackPointers = new Set();
  const transientDirections = new Map();
  const keyMap = {
    KeyW: 'up', ArrowUp: 'up',
    KeyS: 'down', ArrowDown: 'down',
    KeyA: 'left', ArrowLeft: 'left',
    KeyD: 'right', ArrowRight: 'right'
  };
  const attackKeys = new Set(['Space', 'KeyJ']);
  const touchDirections = Array.from(document.querySelectorAll('[data-direction]'));
  const touchAttack = $('touch-attack');
  const fadeMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let tapAttack = false;
  let best = readBest();
  let activePhase = null;
  let lastFrame = null;
  let lastHealth = null;
  let lastBanner = null;
  let databasePromise = null;

  function readBest() {
    try {
      const value = Number(localStorage.getItem('moss-guard-best-v1'));
      return Number.isSafeInteger(value) && value > 0 ? value : 0;
    } catch {
      return 0;
    }
  }

  function recordBest() {
    if (state.score <= best) return;
    best = state.score;
    try {
      localStorage.setItem('moss-guard-best-v1', String(best));
    } catch {
      // The current session can still keep a score.
    }
  }

  function resizeCanvas() {
    const { width, height } = canvas.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    const worldWidth = width < 550 ? Math.max(430, Math.round(width * 1.43)) : 960;
    game.resize(worldWidth, Math.round(worldWidth * height / width));

    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    ctx.setTransform(canvas.width / state.width, 0, 0, canvas.height / state.height, 0, 0);
    paint();
  }

  function clearInputs() {
    activeKeys.clear();
    directionPointers.clear();
    attackPointers.clear();
    transientDirections.clear();
    tapAttack = false;
    paintTouchButtons();
  }

  function collectInput(now) {
    const input = { attack: tapAttack || attackPointers.size > 0 };
    tapAttack = false;
    for (const key of activeKeys) {
      const direction = keyMap[key];
      if (direction) input[direction] = true;
      else if (attackKeys.has(key)) input.attack = true;
    }
    for (const direction of directionPointers.values()) input[direction] = true;
    for (const [direction, expires] of transientDirections) {
      if (now < expires) input[direction] = true;
      else transientDirections.delete(direction);
    }
    return input;
  }

  function paintTouchButtons() {
    const directions = new Set(directionPointers.values());
    for (const button of touchDirections) {
      button.setAttribute('aria-pressed', String(directions.has(button.dataset.direction)));
    }
    touchAttack.setAttribute('aria-pressed', String(attackPointers.size > 0));
  }

  function updateHud() {
    recordBest();
    if (ui.best.textContent !== String(best)) ui.best.textContent = best;
    if (ui.score.textContent !== String(state.score)) ui.score.textContent = state.score;
    const wave = (state.waveIndex + 1) + ' / ' + config.waves.length;
    if (ui.wave.textContent !== wave) ui.wave.textContent = wave;
    if (lastHealth !== state.player.hp) {
      lastHealth = state.player.hp;
      ui.hearts.setAttribute('aria-label', '生命 ' + state.player.hp + ' / ' + config.health);
      ui.hearts.innerHTML = Array.from({ length: config.health }, (_, index) =>
        `<span class="heart${index < state.player.hp ? ' live' : ''}" aria-hidden="true">♥</span>`
      ).join('');
    }
    const banner = state.phase === 'playing' && state.bannerTime > 0 ? state.banner : '';
    if (banner !== lastBanner) {
      lastBanner = banner;
      ui.banner.hidden = !banner;
      ui.banner.textContent = banner;
      if (banner) ui.message.textContent = banner;
    }
    if (activePhase !== state.phase) {
      activePhase = state.phase;
      updateOverlay();
    }
  }

  function updateOverlay() {
    const phase = state.phase;
    pauseButton.disabled = phase !== 'playing' && phase !== 'paused';
    pauseButton.textContent = phase === 'paused' ? '继续' : '暂停';
    ui.overlay.hidden = phase === 'playing';

    const text = {
      ready: ['准备迎战', '在苔林里移动，等怪物靠近，再用灯刃把它们击退。', '开始游戏'],
      paused: ['已暂停', '灯火还亮着。准备好就继续。', '继续游戏'],
      won: ['守卫成功', '三波怪物都已击退。你的得分是 ' + state.score + '。', '再玩一局'],
      lost: ['灯火熄灭了', '你的得分是 ' + state.score + '。试试边移动边找机会回身攻击。', '再试一次']
    }[phase];

    if (!text) return;
    const [title, copy, label] = text;
    ui.title.textContent = title;
    ui.copy.textContent = copy;
    play.textContent = label;
    if (phase !== 'ready') ui.message.textContent = title + '。' + copy;
    if ((phase === 'won' || phase === 'lost') && !dialog.open) play.focus({ preventScroll: true });
  }

  function startOrResume() {
    clearInputs();
    if (state.phase === 'paused') game.resume();
    else game.start();
    updateHud();
  }

  function togglePause() {
    if (dialog.open || (state.phase !== 'playing' && state.phase !== 'paused')) return;
    clearInputs();
    if (state.phase === 'paused') game.resume();
    else game.pause();
    updateHud();
  }

  function shade(x, y, radius) {
    ctx.fillStyle = '#0716115c';
    ctx.beginPath();
    ctx.ellipse(x, y, radius, radius * 0.49, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function cover(image, width, height) {
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const w = image.naturalWidth * scale;
    const h = image.naturalHeight * scale;
    ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
  }

  function sprite(image, x, bottom, maxWidth, maxHeight, flip = false) {
    if (!image) return false;
    const scale = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    ctx.save();
    ctx.translate(x, bottom);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(image, -width / 2, -height, width, height);
    ctx.restore();
    return true;
  }

  function paintEnemy(enemy) {
    const { x, y, radius } = enemy;
    const wobble = fadeMotion.matches ? 0 : Math.sin(state.time * 8 + enemy.wobble) * 2;
    shade(x, y + 9, radius + 4);
    if (enemy.age < 0.27) {
      ctx.strokeStyle = '#d0e4ac';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, radius * (0.6 + enemy.age * 2.2), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.save();
    if (enemy.hurtTimer > 0) ctx.filter = 'brightness(1.45)';
    if (!sprite(assets.slime.image, x, y + radius * 0.9 + wobble, radius * 2.8, radius * 2.6)) {
      ctx.beginPath();
      ctx.ellipse(x, y + wobble, radius, radius * 0.81, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#80ac52';
      ctx.fill();
      ctx.fillStyle = '#fff1ba';
      ctx.fillRect(x - 8, y - 4 + wobble, 4, 6);
      ctx.fillRect(x + 4, y - 4 + wobble, 4, 6);
    }
    ctx.restore();
    if (enemy.maxHp > 1) {
      ctx.fillStyle = '#142921';
      ctx.fillRect(x - 12, y - radius - 5, 24, 4);
      ctx.fillStyle = '#e4bd76';
      ctx.fillRect(x - 12, y - radius - 5, 24 * enemy.hp / enemy.maxHp, 4);
    }
  }

  function paintPlayer() {
    const { x, y, angle, hurtTimer, attackTimer, walking } = state.player;
    const bob = !fadeMotion.matches && walking ? Math.sin(state.time * 22) * 2.4 : 0;
    shade(x, y + 10, 20);
    const halo = ctx.createRadialGradient(x, y, 5, x, y, 60);
    halo.addColorStop(0, '#f8cc6e64');
    halo.addColorStop(1, '#f8cc6e00');
    ctx.fillStyle = halo;
    ctx.fillRect(x - 60, y - 60, 120, 120);
    ctx.save();
    if (hurtTimer > 0 && !fadeMotion.matches && Math.floor(hurtTimer * 14) % 2) ctx.globalAlpha = 0.54;
    if (!sprite(assets.guardian.image, x, y + 14 + bob, 58, 66, Math.cos(angle) < 0)) {
      ctx.fillStyle = '#f0bc65';
      ctx.beginPath();
      ctx.moveTo(x, y - 22);
      ctx.lineTo(x + 16, y + 8);
      ctx.lineTo(x - 16, y + 8);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    ctx.strokeStyle = attackTimer > 0 ? '#d2b778aa' : '#fae3a7';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y + 4, 25, angle - 0.26, angle + 0.26);
    ctx.stroke();
  }

  function paintEffects() {
    const swing = state.swing;
    if (swing) {
      const alpha = swing.time / swing.duration;
      const radius = config.attack.reach * (0.74 + (1 - alpha) * 0.26);
      const start = swing.angle - config.attack.halfAngle;
      const end = swing.angle + config.attack.halfAngle;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.moveTo(swing.x, swing.y);
      ctx.arc(swing.x, swing.y, radius, start, end);
      ctx.closePath();
      ctx.fillStyle = '#ffe5a527';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(swing.x, swing.y, radius, start, end);
      ctx.lineCap = 'round';
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#ffdc86';
      ctx.stroke();
      ctx.restore();
    }
    if (!fadeMotion.matches) {
      ctx.save();
      for (const particle of state.particles) {
        ctx.globalAlpha = particle.life / particle.maxLife;
        ctx.fillStyle = particle.color;
        ctx.fillRect(particle.x - 1.5, particle.y - 1.5, 3, 3);
      }
      ctx.restore();
    }
  }

  function paint() {
    const { width, height, phase } = state;
    const arena = assets.arena.image;
    ctx.fillStyle = '#476249';
    ctx.fillRect(0, 0, width, height);
    if (arena) cover(arena, width, height);

    const vignette = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.18,
      width / 2, height / 2, Math.max(width, height) * 0.61);
    vignette.addColorStop(0, '#09292200');
    vignette.addColorStop(1, '#091b15a8');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
    if (phase === 'ready') return;
    const pieces = [
      ...state.enemies.map(enemy => ({ y: enemy.y, draw: () => paintEnemy(enemy) })),
      { y: state.player.y, draw: paintPlayer }
    ];
    pieces.sort((first, second) => first.y - second.y).forEach(({ draw }) => draw());
    paintEffects();
  }

  function frame(now) {
    const delta = lastFrame === null ? 0 : (now - lastFrame) / 1000;
    lastFrame = now;
    if (state.phase === 'playing') {
      game.step(delta, collectInput(now));
      updateHud();
      paint();
    }
    window.requestAnimationFrame(frame);
  }

  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('无法访问浏览器存储。'));
        return;
      }
      const request = indexedDB.open('moss-guard-assets', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('images');
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          databasePromise = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('请关闭另一个打开此游戏的旧页面。'));
    }).catch(error => {
      databasePromise = null;
      throw error;
    });
    return databasePromise;
  }

  async function accessStorage(mode, action) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('images', mode);
      const request = action(transaction.objectStore('images'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error || request.error);
      transaction.onabort = () => reject(transaction.error || new Error('存储事务中断。'));
    });
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('这张图片无法读取。'));
      image.src = url;
    });
  }

  async function prepareUpload(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const image = await loadImage(url);
      if (image.naturalWidth > 4096 || image.naturalHeight > 4096) {
        throw new Error('像素尺寸超过 4096 × 4096。');
      }
      return { image, url };
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }

  function renderAsset(slot) {
    const controls = slot.controls;
    controls.preview.src = slot.url;
    controls.note.textContent = slot.name;
    controls.note.title = slot.name;
    controls.upload.disabled = slot.busy;
    controls.restore.disabled = !slot.custom || slot.busy;

    if (slot.kind === 'guardian') $('guardian-portrait').src = slot.url;
  }

  function applyAsset(slot, image, url, blobUrl, custom, name) {
    const oldUrl = slot.objectUrl;
    Object.assign(slot, { image, url, objectUrl: blobUrl, custom, name });
    renderAsset(slot);
    paint();
    if (oldUrl && oldUrl !== blobUrl) URL.revokeObjectURL(oldUrl);
  }

  async function restoreSavedAsset(slot) {
    const change = slot.change;
    try {
      const image = await loadImage(slot.source);
      slot.defaultImage = image;
      if (slot.change === change && !slot.custom) applyAsset(slot, image, slot.source, null, false, '默认素材');
    } catch {
      // The game still displays a simple illustration when a default image is missing.
    }
    try {
      const saved = await accessStorage('readonly', store => store.get(slot.kind));
      if (!saved?.blob || slot.change !== change) return;
      const { image, url } = await prepareUpload(saved.blob);
      if (slot.change !== change) {
        URL.revokeObjectURL(url);
        return;
      }
      applyAsset(slot, image, url, url, true, saved.name || '自定义素材');
    } catch {
      // Storage may be unavailable in private sessions.
    }
  }

  function showAssetMessage(slot, message) {
    ui.assetMessage.textContent = slot.label + '：' + message;
  }

  async function chooseAsset(slot, file) {
    if (!file || slot.busy) return;
    if (!['image/png', 'image/webp', 'image/jpeg'].includes(file.type)) {
      showAssetMessage(slot, '请选择 PNG、WebP 或 JPG 图片。');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      showAssetMessage(slot, '图片大于 8 MB，请选一张更小的图片。');
      return;
    }

    slot.busy = true;
    renderAsset(slot);
    showAssetMessage(slot, '正在读取图片。');
    try {
      const { image, url } = await prepareUpload(file);
      slot.change += 1;
      applyAsset(slot, image, url, url, true, file.name);
      try {
        await accessStorage('readwrite', store => store.put({ blob: file, name: file.name }, slot.kind));
        showAssetMessage(slot, '已替换并保存在当前浏览器。');
      } catch {
        showAssetMessage(slot, '已替换，这个浏览器暂时无法保存，刷新后需要重新选择。');
      }
    } catch (error) {
      showAssetMessage(slot, error.message);
    } finally {
      slot.busy = false;
      renderAsset(slot);
    }
  }

  async function restoreAsset(slot) {
    if (!slot.custom || slot.busy) return;
    slot.busy = true;
    slot.change += 1;
    applyAsset(slot, slot.defaultImage, slot.source, null, false, '默认素材');
    try {
      await accessStorage('readwrite', store => store.delete(slot.kind));
      showAssetMessage(slot, '已恢复默认素材。');
    } catch {
      showAssetMessage(slot, '本次已恢复默认，浏览器暂时无法保存这次更改。');
    } finally {
      slot.busy = false;
      renderAsset(slot);
    }
  }

  function makeAssetCard(slot) {
    const card = document.createElement('section');
    card.className = 'asset-card';
    card.innerHTML = `
      <h3>${slot.label}</h3>
      <img class="asset-preview" data-kind="${slot.kind}" alt="">
      <p></p>
      <input type="file" accept="image/png,image/webp,image/jpeg" aria-label="选择${slot.label}图片" hidden>
      <button class="button upload" type="button" aria-label="更换${slot.label}图片">更换图片</button>
      <button class="button restore" type="button" aria-label="恢复默认${slot.label}">恢复默认</button>`;
    const input = card.querySelector('input');
    slot.controls = {
      preview: card.querySelector('img'),
      note: card.querySelector('p'),
      upload: card.querySelector('.upload'),
      restore: card.querySelector('.restore')
    };
    slot.controls.upload.addEventListener('click', () => input.click());
    slot.controls.restore.addEventListener('click', () => restoreAsset(slot));
    input.addEventListener('change', () => {
      const [file] = input.files;
      input.value = '';
      chooseAsset(slot, file);
    });
    $('asset-slots').append(card);
    renderAsset(slot);
    return restoreSavedAsset(slot);
  }

  window.addEventListener('keydown', event => {
    if (dialog.open || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.code === 'KeyP' || event.code === 'Escape') {
      if (state.phase === 'playing' || state.phase === 'paused') {
        event.preventDefault();
        if (!event.repeat) togglePause();
      }
      return;
    }
    if (state.phase !== 'playing' || (!keyMap[event.code] && !attackKeys.has(event.code))) return;
    event.preventDefault();
    activeKeys.add(event.code);
  });
  window.addEventListener('keyup', event => activeKeys.delete(event.code));
  window.addEventListener('blur', () => {
    clearInputs();
    game.pause();
    updateHud();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearInputs();
      game.pause();
      updateHud();
    }
  });

  canvas.addEventListener('pointerdown', event => {
    if (state.phase !== 'playing' || event.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    game.attack({
      x: (event.clientX - rect.left) * state.width / rect.width,
      y: (event.clientY - rect.top) * state.height / rect.height
    });
  });
  const releaseTouch = event => {
    directionPointers.delete(event.pointerId);
    attackPointers.delete(event.pointerId);
    paintTouchButtons();
  };
  for (const button of [...touchDirections, touchAttack]) {
    button.addEventListener('pointerdown', event => {
      if (state.phase !== 'playing' || event.button !== 0) return;
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      if (button === touchAttack) attackPointers.add(event.pointerId);
      else directionPointers.set(event.pointerId, button.dataset.direction);
      paintTouchButtons();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      button.addEventListener(type, releaseTouch);
    }
    button.addEventListener('click', event => {
      if (event.detail !== 0 || state.phase !== 'playing') return;
      if (button === touchAttack) tapAttack = true;
      else transientDirections.set(button.dataset.direction, performance.now() + 110);
    });
  }

  play.addEventListener('click', startOrResume);
  pauseButton.addEventListener('click', togglePause);
  $('assets-button').addEventListener('click', () => {
    clearInputs();
    game.pause();
    updateHud();
    ui.assetMessage.textContent = '';
    dialog.showModal();
  });
  $('close-assets').addEventListener('click', () => dialog.close());
  $('done-assets').addEventListener('click', () => dialog.close());

  for (const slot of Object.values(assets)) makeAssetCard(slot);
  paintTouchButtons();
  updateHud();
  new ResizeObserver(resizeCanvas).observe($('arena'));
  resizeCanvas();
  window.requestAnimationFrame(frame);
})();
