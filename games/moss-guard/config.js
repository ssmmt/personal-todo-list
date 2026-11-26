// Replace these WebP files, or point each source at your own image.
globalThis.MOSS_GUARD_CONFIG = {
  assets: {
    guardian: { label: '角色', source: 'assets/guardian.webp' },
    slime: { label: '怪物', source: 'assets/slime.webp' },
    arena: { label: '地图', source: 'assets/arena.webp' }
  },
  health: 5,
  speed: 230,
  attack: { reach: 103, cooldown: 0.39, halfAngle: 1.08 },
  waves: [
    { count: 5, speed: 72, spacing: 0.85 },
    { count: 7, speed: 87, spacing: 0.65 },
    { count: 10, speed: 103, spacing: 0.53 }
  ]
};
