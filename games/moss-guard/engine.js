(() => {
  const TAU = Math.PI * 2;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function createGame(config, random = Math.random) {
    const state = {
      width: 960,
      height: 540,
      phase: 'ready',
      player: null,
      enemies: [],
      particles: [],
      waveIndex: 0,
      score: 0,
      spawned: 0,
      spawnTimer: 0,
      recoverTimer: null,
      banner: '',
      bannerTime: 0,
      swing: null,
      time: 0
    };

    function resetPlayer() {
      state.player = {
        x: state.width / 2,
        y: state.height / 2,
        angle: -Math.PI / 2,
        radius: 18,
        hp: config.health,
        hurtTimer: 0,
        attackTimer: 0,
        walking: false
      };
    }

    function resize(width, height) {
      if (!Number.isFinite(width) || !Number.isFinite(height) || width < 150 || height < 150) return;
      const xScale = width / state.width;
      const yScale = height / state.height;
      for (const piece of [state.player, ...state.enemies, ...state.particles]) {
        piece.x *= xScale;
        piece.y *= yScale;
      }
      if (state.swing) {
        state.swing.x *= xScale;
        state.swing.y *= yScale;
      }
      state.width = width;
      state.height = height;
    }

    function announce(message, duration = 1.6) {
      state.banner = message;
      state.bannerTime = duration;
    }

    function enterWave(index) {
      state.waveIndex = index;
      state.spawned = 0;
      state.spawnTimer = 0.65;
      state.recoverTimer = null;
      announce('第 ' + (index + 1) + ' 波');
    }

    function start() {
      resetPlayer();
      state.phase = 'playing';
      state.enemies = [];
      state.particles = [];
      state.swing = null;
      state.score = 0;
      state.time = 0;
      enterWave(0);
    }

    function pause() {
      if (state.phase === 'playing') state.phase = 'paused';
    }

    function resume() {
      if (state.phase === 'paused') state.phase = 'playing';
    }

    function spawnEnemy(wave) {
      const margin = 32;
      const { width, height, player } = state;
      const horizontal = () => margin + random() * (width - margin * 2);
      const vertical = () => margin + random() * (height - margin * 2);
      const locations = [
        { x: horizontal(), y: margin },
        { x: width - margin, y: vertical() },
        { x: horizontal(), y: height - margin },
        { x: margin, y: vertical() }
      ].map(position => ({
        ...position,
        distance: Math.hypot(position.x - player.x, position.y - player.y)
      }));
      const safe = locations.filter(position => position.distance > 175);
      const position = safe.length
        ? safe[Math.floor(random() * safe.length)]
        : locations.reduce((best, candidate) => candidate.distance > best.distance ? candidate : best);
      const large = state.waveIndex > 0 && (state.spawned + 1) % 3 === 0;
      state.enemies.push({
        x: position.x,
        y: position.y,
        radius: large ? 24 : 18,
        hp: large ? 2 : 1,
        maxHp: large ? 2 : 1,
        speed: wave.speed * (large ? 0.85 : 0.88 + random() * 0.23),
        knockX: 0,
        knockY: 0,
        hurtTimer: 0,
        age: 0,
        wobble: random() * TAU
      });
      state.spawned += 1;
    }

    function burst(x, y, color, amount) {
      for (let i = 0; i < amount; i++) {
        const angle = random() * TAU;
        const speed = 25 + random() * 100;
        const life = 0.22 + random() * 0.35;
        state.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, color, life, maxLife: life });
      }
    }

    function attack(aim) {
      const { player, enemies } = state;
      if (state.phase !== 'playing' || player.attackTimer > 0) return false;
      if (aim && Number.isFinite(aim.x) && Number.isFinite(aim.y)) {
        player.angle = Math.atan2(aim.y - player.y, aim.x - player.x);
      } else {
        let nearest = null;
        let distance = config.attack.reach + 33;
        for (const enemy of enemies) {
          const candidate = Math.hypot(enemy.x - player.x, enemy.y - player.y);
          if (candidate < distance) {
            nearest = enemy;
            distance = candidate;
          }
        }
        if (nearest) player.angle = Math.atan2(nearest.y - player.y, nearest.x - player.x);
      }

      player.attackTimer = config.attack.cooldown;
      state.swing = { x: player.x, y: player.y, angle: player.angle, time: 0.24, duration: 0.24 };
      for (const enemy of enemies) {
        const dx = enemy.x - player.x;
        const dy = enemy.y - player.y;
        const direction = Math.atan2(dy, dx);
        const difference = direction - player.angle;
        const angle = Math.abs(Math.atan2(Math.sin(difference), Math.cos(difference)));
        if (Math.hypot(dx, dy) > config.attack.reach + enemy.radius || angle > config.attack.halfAngle) continue;
        enemy.hp -= 1;
        enemy.hurtTimer = 0.18;
        enemy.knockX = Math.cos(direction) * 245;
        enemy.knockY = Math.sin(direction) * 245;
        burst(enemy.x, enemy.y, enemy.hp > 0 ? '#f6d384' : '#c9e98e', enemy.hp > 0 ? 5 : 10);
        if (enemy.hp === 0) state.score += enemy.maxHp > 1 ? 180 : 100;
      }
      state.enemies = enemies.filter(enemy => enemy.hp > 0);
      return true;
    }

    function keepInside(piece) {
      const margin = piece.radius + 9;
      piece.x = clamp(piece.x, margin, state.width - margin);
      piece.y = clamp(piece.y, margin, state.height - margin);
    }

    function moveEnemies(dt) {
      const { player, enemies } = state;
      for (const enemy of enemies) {
        enemy.age += dt;
        enemy.hurtTimer = Math.max(0, enemy.hurtTimer - dt);
        const dx = player.x - enemy.x;
        const dy = player.y - enemy.y;
        const distance = Math.hypot(dx, dy);
        const directionX = distance > 0 ? dx / distance : 1;
        const directionY = distance > 0 ? dy / distance : 0;

        if (enemy.age > 0.27) {
          enemy.x += (directionX * enemy.speed + enemy.knockX) * dt;
          enemy.y += (directionY * enemy.speed + enemy.knockY) * dt;
        }
        const damping = Math.exp(-8 * dt);
        enemy.knockX *= damping;
        enemy.knockY *= damping;
        keepInside(enemy);

        if (enemy.age > 0.27 && distance < enemy.radius + player.radius && player.hurtTimer <= 0) {
          player.hp -= 1;
          player.hurtTimer = 1.05;
          player.x += directionX * 23;
          player.y += directionY * 23;
          keepInside(player);
          burst(player.x, player.y, '#ffad87', 9);
          if (player.hp === 0) {
            state.phase = 'lost';
            return;
          }
        }
      }

      for (let i = 0; i < enemies.length; i++) {
        for (let j = i + 1; j < enemies.length; j++) {
          const a = enemies[i];
          const b = enemies[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distance = Math.hypot(dx, dy);
          const overlap = (a.radius + b.radius) * 0.83 - distance;
          if (overlap <= 0) continue;
          const pushX = (distance > 0 ? dx / distance : 1) * overlap / 2;
          const pushY = (distance > 0 ? dy / distance : 0) * overlap / 2;
          a.x -= pushX;
          a.y -= pushY;
          b.x += pushX;
          b.y += pushY;
          keepInside(a);
          keepInside(b);
        }
      }
    }

    function advanceWave(dt) {
      const wave = config.waves[state.waveIndex];
      if (state.spawned < wave.count) {
        state.spawnTimer -= dt;
        if (state.spawnTimer <= 0) {
          spawnEnemy(wave);
          state.spawnTimer = wave.spacing;
        }
        return;
      }
      if (state.enemies.length) return;
      if (state.waveIndex === config.waves.length - 1) {
        state.phase = 'won';
        return;
      }
      if (state.recoverTimer === null) {
        state.recoverTimer = 1.8;
        const canRecover = state.player.hp < config.health;
        if (canRecover) state.player.hp += 1;
        announce(canRecover ? '守住了！回复 1 格生命' : '守住了！准备迎接下一波', 1.7);
      }
      state.recoverTimer -= dt;
      if (state.recoverTimer <= 0) enterWave(state.waveIndex + 1);
    }

    function step(seconds, input) {
      if (state.phase !== 'playing' || !Number.isFinite(seconds) || seconds <= 0) return;
      const dt = Math.min(seconds, 0.05);
      const { player } = state;
      state.time += dt;
      state.bannerTime = Math.max(0, state.bannerTime - dt);
      player.hurtTimer = Math.max(0, player.hurtTimer - dt);
      player.attackTimer = Math.max(0, player.attackTimer - dt);
      if (state.swing) {
        state.swing.time -= dt;
        if (state.swing.time <= 0) state.swing = null;
      }

      const x = Number(Boolean(input.right)) - Number(Boolean(input.left));
      const y = Number(Boolean(input.down)) - Number(Boolean(input.up));
      const magnitude = Math.hypot(x, y);
      player.walking = Boolean(magnitude);
      if (magnitude) {
        player.x += x / magnitude * config.speed * dt;
        player.y += y / magnitude * config.speed * dt;
        player.angle = Math.atan2(y, x);
        keepInside(player);
      }
      if (input.attack) attack(input.aim);

      moveEnemies(dt);
      if (state.phase === 'playing') advanceWave(dt);

      for (const particle of state.particles) {
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.life -= dt;
      }
      state.particles = state.particles.filter(particle => particle.life > 0);
    }

    resetPlayer();
    return { state, start, pause, resume, attack, resize, step };
  }

  globalThis.createMossGuard = createGame;
})();
