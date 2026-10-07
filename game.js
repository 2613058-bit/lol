const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreValue = document.getElementById('scoreValue');
const enemyValue = document.getElementById('enemyValue');
const hpValue = document.getElementById('hpValue');
const opponentHpValue = document.getElementById('opponentHpValue');
const xpValue = document.getElementById('xpValue');
const skillValue = document.getElementById('skillValue');
const itemValue = document.getElementById('itemValue');
const messageBanner = document.getElementById('messageBanner');
const selectionOverlay = document.getElementById('selectionOverlay');
const startMatchBtn = document.getElementById('startMatchBtn');
const selectedSpeed = document.getElementById('selectedSpeed');
const selectedHp = document.getElementById('selectedHp');
const selectedSkillName = document.getElementById('selectedSkillName');
const roomCodeInput = document.getElementById('roomCodeInput');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const networkStatus = document.getElementById('networkStatus');

const characterCatalog = {
  nova: {
    name: 'Nova',
    hp: 100,
    speed: 255,
    color: '#7ae0ff',
    weaponDamage: 16,
    fireRate: 0.18,
    skillName: 'Pulse Burst',
    skillType: 'burst',
    skillCooldown: 6,
  },
  blaze: {
    name: 'Blaze',
    hp: 88,
    speed: 285,
    color: '#ff9a6b',
    weaponDamage: 18,
    fireRate: 0.14,
    skillName: 'Flame Rush',
    skillType: 'dash',
    skillCooldown: 7,
  },
  titan: {
    name: 'Titan',
    hp: 118,
    speed: 220,
    color: '#7ef3c4',
    weaponDamage: 14,
    fireRate: 0.2,
    skillName: 'Barrier',
    skillType: 'barrier',
    skillCooldown: 9,
  },
};

const obstacleLayout = [
  { x: 210, y: 180, w: 128, h: 32 },
  { x: 630, y: 120, w: 132, h: 32 },
  { x: 360, y: 302, w: 168, h: 34 },
  { x: 122, y: 368, w: 90, h: 96 },
  { x: 744, y: 354, w: 92, h: 102 },
  { x: 500, y: 160, w: 38, h: 160 },
];

const grassPatches = [
  { x: 48, y: 62, w: 156, h: 112 },
  { x: 390, y: 52, w: 178, h: 98 },
  { x: 790, y: 210, w: 126, h: 118 },
  { x: 270, y: 402, w: 180, h: 94 },
];

const arena = {
  width: canvas.width,
  height: canvas.height,
  score: 0,
  state: 'selection',
  spawnTimer: 0,
  regularEnemiesSpawned: 0,
  shake: 0,
  bossSpawned: false,
};

const pointer = { x: canvas.width / 2, y: canvas.height / 2, down: false };
const keys = {};
const lootTable = ['Medkit', 'Overcharge', 'Shield', 'Momentum'];
const regularEnemyLimit = 12;

let selectedCharacter = 'nova';
let player;
let enemies = [];
let bullets = [];
let gems = [];
let xpDrops = [];
let particles = [];
const network = {
  socket: null,
  playerId: null,
  code: '',
  players: [],
  bullets: [],
  started: false,
  pendingSkill: false,
  inputTimer: 0,
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function connectToRoom(mode) {
  if (network.socket && network.socket.readyState < WebSocket.CLOSING) {
    return;
  }

  networkStatus.textContent = '対戦サーバーに接続中...';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${window.location.host}`);
  network.socket = socket;

  socket.addEventListener('open', () => {
    const request = { type: mode, character: selectedCharacter };
    if (mode === 'join') request.code = roomCodeInput.value.trim().toUpperCase();
    socket.send(JSON.stringify(request));
  });
  socket.addEventListener('message', (event) => {
    handleNetworkMessage(JSON.parse(event.data));
  });
  socket.addEventListener('error', () => {
    networkStatus.textContent = '接続できません。対戦サーバーが起動しているか確認してください';
  });
  socket.addEventListener('close', () => {
    if (network.socket === socket) network.socket = null;
    if (network.started && arena.state === 'playing') {
      network.started = false;
      arena.state = 'defeat';
      showMessage('通信が切断されました', '部屋を作り直して再接続してください', true);
    }
  });
}

function startOnlineMatch() {
  network.started = true;
  network.inputTimer = 0;
  network.pendingSkill = false;
  arena.score = 0;
  arena.state = 'playing';
  player = createPlayer();
  enemies = [];
  bullets = [];
  gems = [];
  xpDrops = [];
  particles = [];
  selectionOverlay.classList.remove('visible');
  networkStatus.textContent = `対戦中: ${network.code}`;
  showMessage('対戦開始!', '相手のHPを0にしよう', true);
  updateHud();
}

function applyNetworkState(message) {
  network.players = message.players;
  network.bullets = message.bullets;
  if (!player || !network.playerId) return;

  const self = network.players.find((participant) => participant.id === network.playerId);
  const opponent = network.players.find((participant) => participant.id !== network.playerId);
  if (self) {
    player.x = self.x;
    player.y = self.y;
    player.angle = self.angle;
    player.hp = self.hp;
    player.maxHp = self.maxHp;
    player.barrierTimer = self.barrierTimer;
    player.skillCooldown = self.skillCooldown;
  }
  opponentHpValue.textContent = opponent ? String(Math.ceil(opponent.hp)) : '-';

  if (message.winner && arena.state === 'playing') {
    arena.state = message.winner === network.playerId ? 'victory' : 'defeat';
    showMessage(arena.state === 'victory' ? 'Victory!' : 'Defeat!', 'Rキーでメニューへ戻る', true);
  }
  updateHud();
}

function handleNetworkMessage(message) {
  if (message.type === 'room-created') {
    network.code = message.code;
    network.playerId = message.playerId;
    roomCodeInput.value = message.code;
    networkStatus.textContent = `部屋コード ${message.code} を相手に共有してください`;
  } else if (message.type === 'identity') {
    network.playerId = message.playerId;
  } else if (message.type === 'started') {
    network.code = message.code;
    startOnlineMatch();
    applyNetworkState({ players: message.players, bullets: [], winner: null });
  } else if (message.type === 'state') {
    applyNetworkState(message);
  } else if (message.type === 'opponent-left') {
    network.started = false;
    networkStatus.textContent = '相手が退出しました。新しい部屋を作成してください';
    arena.state = 'defeat';
    showMessage('対戦終了', '相手が退出しました', true);
  } else if (message.type === 'error') {
    networkStatus.textContent = message.message;
  }
}

function sendNetworkInput(dt) {
  network.inputTimer += dt;
  if (network.inputTimer < 0.05) return;
  network.inputTimer = 0;
  if (!network.socket || network.socket.readyState !== WebSocket.OPEN || !network.playerId) return;

  const horizontal = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0);
  const vertical = (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0);
  player.angle = Math.atan2(pointer.y - player.y, pointer.x - player.x);
  network.socket.send(JSON.stringify({
    type: 'input',
    x: horizontal,
    y: vertical,
    aim: player.angle,
    shooting: pointer.down,
    skill: network.pendingSkill,
  }));
  network.pendingSkill = false;
}

function circleRectCollision(circleX, circleY, radius, rect) {
  const nearestX = clamp(circleX, rect.x, rect.x + rect.w);
  const nearestY = clamp(circleY, rect.y, rect.y + rect.h);
  return Math.hypot(circleX - nearestX, circleY - nearestY) < radius + 2;
}

function collidesWithObstacle(x, y, radius) {
  return obstacleLayout.some((obstacle) => circleRectCollision(x, y, radius, obstacle));
}

function isInsideGrass(x, y, radius) {
  return grassPatches.some((patch) => (
    x - radius >= patch.x &&
    x + radius <= patch.x + patch.w &&
    y - radius >= patch.y &&
    y + radius <= patch.y + patch.h
  ));
}

function updateSelectionInfo() {
  const choice = characterCatalog[selectedCharacter];
  selectedSpeed.textContent = String(choice.speed);
  selectedHp.textContent = String(choice.hp);
  selectedSkillName.textContent = choice.skillName;
  document.querySelectorAll('.character-option').forEach((button) => {
    button.classList.toggle('active', button.dataset.character === selectedCharacter);
  });
}

function selectCharacter(key) {
  if (!characterCatalog[key]) {
    return;
  }
  selectedCharacter = key;
  updateSelectionInfo();
  if (player) {
    player = createPlayer();
    updateHud();
  }
}

function createPlayer() {
  const config = characterCatalog[selectedCharacter];
  return {
    x: arena.width / 2,
    y: arena.height / 2,
    radius: 18,
    speed: config.speed,
    maxHp: config.hp,
    hp: config.hp,
    fireCooldown: 0,
    invuln: 0,
    angle: 0,
    color: config.color,
    damage: config.weaponDamage,
    fireRate: config.fireRate,
    skillName: config.skillName,
    skillType: config.skillType,
    skillCooldown: 0,
    skillMaxCooldown: config.skillCooldown,
    barrierTimer: 0,
    dashTimer: 0,
    xp: 0,
    xpGoal: 45,
    itemName: 'None',
    damageBoost: 1,
    damageBoostTimer: 0,
    speedBoost: 1,
    speedBoostTimer: 0,
    hidden: false,
  };
}

function spawnEnemy() {
  const edge = Math.floor(Math.random() * 4);
  let x = 0;
  let y = 0;

  if (edge === 0) {
    x = rand(0, arena.width);
    y = -30;
  } else if (edge === 1) {
    x = arena.width + 30;
    y = rand(0, arena.height);
  } else if (edge === 2) {
    x = rand(0, arena.width);
    y = arena.height + 30;
  } else {
    x = -30;
    y = rand(0, arena.height);
  }

  const runner = Math.random() < 0.72;
  const enemy = {
    x,
    y,
    radius: runner ? 15 : 20,
    speed: runner ? 90 : 66,
    maxHp: runner ? 36 : 58,
    hp: runner ? 36 : 58,
    fireCooldown: rand(0.6, 1.8),
    type: runner ? 'runner' : 'shooter',
    color: runner ? '#ff8a70' : '#f7c978',
    drift: rand(0, Math.PI * 2),
  };

  enemies.push(enemy);
}

function spawnBoss() {
  enemies.push({
    x: arena.width / 2,
    y: 90,
    radius: 34,
    speed: 58,
    maxHp: 260,
    hp: 260,
    fireCooldown: 1.0,
    type: 'boss',
    color: '#ff5db1',
    drift: 0,
  });
  showMessage('Boss incoming!', '巨大な敵が現れた！', true);
  arena.bossSpawned = true;
}

function spawnGem(x, y, value = 1) {
  gems.push({
    x,
    y,
    radius: 8,
    value,
    pulse: rand(0, Math.PI * 2),
    color: value > 1 ? '#ffc857' : '#7ef3c4',
  });
}

function spawnXp(x, y, value = 10) {
  xpDrops.push({
    x,
    y,
    radius: 7,
    value,
    pulse: rand(0, Math.PI * 2),
    color: '#d2a8ff',
  });
}

function createBurst(x, y, color, count = 10) {
  for (let i = 0; i < count; i += 1) {
    particles.push({
      x,
      y,
      dx: rand(-90, 90),
      dy: rand(-90, 90),
      radius: rand(2, 5),
      life: rand(0.3, 0.8),
      maxLife: rand(0.3, 0.8),
      color,
    });
  }
}

function awardRandomItem() {
  const item = lootTable[Math.floor(Math.random() * lootTable.length)];
  player.itemName = item;
  itemValue.textContent = item;

  if (item === 'Medkit') {
    player.hp = clamp(player.hp + 25, 0, player.maxHp);
    showMessage('Item Get!', 'Medkit! HP +25', true);
  } else if (item === 'Overcharge') {
    player.damageBoost = 1.45;
    player.damageBoostTimer = 8;
    showMessage('Item Get!', 'Overcharge! Damage UP', true);
  } else if (item === 'Shield') {
    player.barrierTimer = 4.5;
    player.invuln = 1.3;
    showMessage('Item Get!', 'Shield! Barrier active', true);
  } else if (item === 'Momentum') {
    player.speedBoost = 1.18;
    player.speedBoostTimer = 8;
    showMessage('Item Get!', 'Momentum! Move speed UP', true);
  }

  createBurst(player.x, player.y, '#ffe082', 20);
  player.xp = 0;
  player.xpGoal = Math.min(80, player.xpGoal + 8);
}

function shootBullet(from, targetX, targetY, speed, owner, damage, color) {
  const dx = targetX - from.x;
  const dy = targetY - from.y;
  const distance = Math.hypot(dx, dy) || 1;
  bullets.push({
    x: from.x,
    y: from.y,
    radius: owner === 'player' ? 4 : 5,
    dx: (dx / distance) * speed,
    dy: (dy / distance) * speed,
    life: 1.8,
    damage,
    owner,
    color: color || (owner === 'player' ? '#72e1ff' : '#ff7f7f'),
  });
}

function triggerPlayerSkill() {
  if (arena.state !== 'playing' || player.skillCooldown > 0) {
    return;
  }

  player.skillCooldown = player.skillMaxCooldown;
  arena.shake = 1.2;

  if (network.started) {
    network.pendingSkill = true;
    return;
  }

  if (player.skillType === 'burst') {
    const spread = 0.7;
    for (let i = -3; i <= 3; i += 1) {
      const angle = player.angle + (i * spread) / 3;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      bullets.push({
        x: player.x + cos * 18,
        y: player.y + sin * 18,
        radius: 6,
        dx: cos * 620,
        dy: sin * 620,
        life: 0.9,
        damage: 26,
        owner: 'player',
        color: '#ffd86b',
      });
    }
    createBurst(player.x, player.y, '#ffd86b', 22);
    for (let i = 0; i < 10; i += 1) {
      particles.push({
        x: player.x,
        y: player.y,
        dx: Math.cos(player.angle + rand(-1.2, 1.2)) * rand(80, 220),
        dy: Math.sin(player.angle + rand(-1.2, 1.2)) * rand(80, 220),
        radius: rand(2, 5),
        life: rand(0.28, 0.7),
        maxLife: rand(0.28, 0.7),
        color: '#ffe29a',
      });
    }
  }

  if (player.skillType === 'dash') {
    const pushX = Math.cos(player.angle) * 120;
    const pushY = Math.sin(player.angle) * 120;
    const nextX = clamp(player.x + pushX, player.radius, arena.width - player.radius);
    const nextY = clamp(player.y + pushY, player.radius, arena.height - player.radius);
    if (!collidesWithObstacle(nextX, player.y, player.radius)) {
      player.x = nextX;
    }
    if (!collidesWithObstacle(player.x, nextY, player.radius)) {
      player.y = nextY;
    }

    for (let i = 0; i < 12; i += 1) {
      particles.push({
        x: player.x,
        y: player.y,
        dx: rand(-100, 100),
        dy: rand(-100, 100),
        radius: rand(3, 6),
        life: rand(0.2, 0.6),
        maxLife: rand(0.2, 0.6),
        color: '#ffb38f',
      });
    }

    for (const enemy of enemies) {
      const dist = Math.hypot(player.x - enemy.x, player.y - enemy.y);
      if (dist < enemy.radius + player.radius + 28) {
        damageEnemy(enemy, 30);
      }
    }
    createBurst(player.x, player.y, '#ff9a6b', 18);
  }

  if (player.skillType === 'barrier') {
    player.barrierTimer = 3.5;
    player.invuln = 1.1;
    createBurst(player.x, player.y, '#7ef3c4', 22);
  }
}

function damagePlayer(amount) {
  if (arena.state !== 'playing') {
    return;
  }

  let finalDamage = amount;
  if (player.barrierTimer > 0) {
    finalDamage *= 0.4;
  }

  if (player.invuln > 0) {
    return;
  }

  player.hp = clamp(player.hp - finalDamage, 0, player.maxHp);
  player.invuln = 0.45;
  createBurst(player.x, player.y, '#ff7a7a', 14);

  if (player.hp <= 0) {
    arena.state = 'defeat';
    showMessage('Defeat!', 'Press R to rematch', true);
  }
}

function damageEnemy(enemy, amount) {
  enemy.hp -= amount;
  createBurst(enemy.x, enemy.y, '#ffe082', 8);
  if (enemy.hp <= 0) {
    const index = enemies.indexOf(enemy);
    if (index >= 0) {
      enemies.splice(index, 1);
    }

    arena.score += enemy.type === 'boss' ? 200 : 12;
    const gemValue = Math.random() < 0.7 ? 1 : 2;
    spawnGem(enemy.x, enemy.y, gemValue);
    const xpValueAmount = enemy.type === 'boss' ? 25 : 10;
    spawnXp(enemy.x, enemy.y, xpValueAmount);
    createBurst(enemy.x, enemy.y, enemy.type === 'boss' ? '#ff7adf' : '#86f7b0', enemy.type === 'boss' ? 32 : 18);
    if (enemy.type === 'boss') {
      showMessage('Boss Defeated!', '追加経験値とレアアイテムのチャンス!', true);
    }
  }
}

function showMessage(title, text, visible) {
  messageBanner.innerHTML = `<h2>${title}</h2><p>${text}</p>`;
  messageBanner.classList.toggle('visible', visible);
}

function updateHud() {
  scoreValue.textContent = String(arena.score);
  enemyValue.textContent = network.started ? 'VS' : String(
    enemies.length + regularEnemyLimit - arena.regularEnemiesSpawned + (arena.bossSpawned ? 0 : 1)
  );
  hpValue.textContent = String(Math.max(0, Math.ceil(player ? player.hp : 0)));
  const opponent = network.players.find((participant) => participant.id !== network.playerId);
  opponentHpValue.textContent = network.started && opponent ? String(Math.ceil(opponent.hp)) : '-';
  xpValue.textContent = `${player ? player.xp : 0}/${player ? player.xpGoal : 45}`;

  if (!player) {
    skillValue.textContent = 'Pulse Burst';
    itemValue.textContent = 'None';
    return;
  }

  if (player.skillCooldown > 0) {
    skillValue.textContent = `${player.skillName} ${player.skillCooldown.toFixed(1)}s`;
  } else {
    skillValue.textContent = `${player.skillName} READY`;
  }

  itemValue.textContent = player.itemName || 'None';
}

function resetGame() {
  if (network.socket) network.socket.close();
  network.socket = null;
  network.started = false;
  network.playerId = null;
  network.code = '';
  network.players = [];
  network.bullets = [];
  arena.score = 0;
  arena.state = 'playing';
  arena.spawnTimer = 0;
  arena.regularEnemiesSpawned = 0;
  arena.bossSpawned = false;
  arena.shake = 0;
  player = createPlayer();
  enemies = [];
  bullets = [];
  gems = [];
  xpDrops = [];
  particles = [];
  selectionOverlay.classList.remove('visible');
  showMessage('Battle starts!', 'WASDで移動、マウスで照準、クリックで攻撃', false);
  updateHud();
}

function handleMovement(dt) {
  const horizontal = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0);
  const vertical = (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0);
  const length = Math.hypot(horizontal, vertical) || 1;

  const speedFactor = player.speedBoost > 1 ? player.speedBoost : 1;
  const moveX = ((horizontal / length) * player.speed * speedFactor * dt);
  const moveY = ((vertical / length) * player.speed * speedFactor * dt);

  const nextX = clamp(player.x + moveX, player.radius, arena.width - player.radius);
  if (!collidesWithObstacle(nextX, player.y, player.radius)) {
    player.x = nextX;
  }

  const nextY = clamp(player.y + moveY, player.radius, arena.height - player.radius);
  if (!collidesWithObstacle(player.x, nextY, player.radius)) {
    player.y = nextY;
  }

  player.hidden = isInsideGrass(player.x, player.y, player.radius);
}

function handleShooting(dt) {
  player.fireCooldown = Math.max(0, player.fireCooldown - dt);
  player.invuln = Math.max(0, player.invuln - dt);
  player.skillCooldown = Math.max(0, player.skillCooldown - dt);
  player.barrierTimer = Math.max(0, player.barrierTimer - dt);
  player.dashTimer = Math.max(0, player.dashTimer - dt);
  player.damageBoostTimer = Math.max(0, player.damageBoostTimer - dt);
  player.speedBoostTimer = Math.max(0, player.speedBoostTimer - dt);

  if (player.damageBoostTimer <= 0) {
    player.damageBoost = 1;
  }
  if (player.speedBoostTimer <= 0) {
    player.speedBoost = 1;
  }

  const aimX = pointer.x;
  const aimY = pointer.y;
  player.angle = Math.atan2(aimY - player.y, aimX - player.x);

  if (pointer.down && player.fireCooldown <= 0 && arena.state === 'playing') {
    const damage = player.damage * player.damageBoost;
    shootBullet(player, aimX, aimY, 520, 'player', damage, '#72e1ff');
    player.fireCooldown = player.fireRate;
  }
}

function updateEnemies(dt) {
  for (const enemy of enemies) {
    if (player.hidden) {
      continue;
    }

    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    const dist = Math.hypot(dx, dy) || 1;

    let moveX = 0;
    let moveY = 0;

    if (enemy.type === 'boss') {
      moveX = (dx / dist) * enemy.speed * dt * 0.9;
      moveY = (dy / dist) * enemy.speed * dt * 0.9;
      if (Math.abs(dx) < 240 && Math.abs(dy) < 240) {
        moveX += Math.cos(enemy.drift) * 26 * dt;
        moveY += Math.sin(enemy.drift) * 26 * dt;
      }
      enemy.drift += dt * 1.6;
    } else if (enemy.type === 'runner') {
      moveX = (dx / dist) * enemy.speed * dt;
      moveY = (dy / dist) * enemy.speed * dt;
    } else {
      if (dist > 180) {
        moveX = (dx / dist) * enemy.speed * dt;
        moveY = (dy / dist) * enemy.speed * dt;
      } else if (dist < 120) {
        moveX = -(dx / dist) * enemy.speed * dt * 0.8;
        moveY = -(dy / dist) * enemy.speed * dt * 0.8;
      } else {
        moveX = Math.cos(enemy.drift) * 35 * dt;
        moveY = Math.sin(enemy.drift) * 35 * dt;
        enemy.drift += dt * 2.5;
      }
    }

    const nextX = clamp(enemy.x + moveX, enemy.radius, arena.width - enemy.radius);
    if (!collidesWithObstacle(nextX, enemy.y, enemy.radius)) {
      enemy.x = nextX;
    }

    const nextY = clamp(enemy.y + moveY, enemy.radius, arena.height - enemy.radius);
    if (!collidesWithObstacle(enemy.x, nextY, enemy.radius)) {
      enemy.y = nextY;
    }

    enemy.fireCooldown -= dt;
    if (enemy.type === 'shooter' && dist < 360 && enemy.fireCooldown <= 0) {
      shootBullet(enemy, player.x, player.y, 250, 'enemy', 10, '#ff7f7f');
      enemy.fireCooldown = rand(1.4, 2.2);
    }

    if (enemy.type === 'boss' && enemy.fireCooldown <= 0) {
      const shotCount = 5;
      for (let i = 0; i < shotCount; i += 1) {
        const offset = (i - (shotCount - 1) / 2) * 0.45;
        const angle = Math.atan2(player.y - enemy.y, player.x - enemy.x) + offset;
        bullets.push({
          x: enemy.x,
          y: enemy.y,
          radius: 7,
          dx: Math.cos(angle) * 280,
          dy: Math.sin(angle) * 280,
          life: 1.8,
          damage: 15,
          owner: 'enemy',
          color: '#ff99d6',
        });
      }
      enemy.fireCooldown = 1.7;
    }
  }
}

function updateBullets(dt) {
  bullets = bullets.filter((bullet) => {
    bullet.x += bullet.dx * dt;
    bullet.y += bullet.dy * dt;
    bullet.life -= dt;

    if (
      bullet.x < -20 ||
      bullet.x > arena.width + 20 ||
      bullet.y < -20 ||
      bullet.y > arena.height + 20 ||
      bullet.life <= 0 ||
      obstacleLayout.some((obstacle) => circleRectCollision(bullet.x, bullet.y, bullet.radius, obstacle))
    ) {
      return false;
    }

    if (bullet.owner === 'player') {
      for (const enemy of enemies) {
        const dist = Math.hypot(bullet.x - enemy.x, bullet.y - enemy.y);
        if (dist < bullet.radius + enemy.radius) {
          damageEnemy(enemy, bullet.damage);
          return false;
        }
      }
    } else {
      const dist = Math.hypot(bullet.x - player.x, bullet.y - player.y);
      if (dist < bullet.radius + player.radius) {
        damagePlayer(bullet.damage);
        return false;
      }
    }

    return true;
  });
}

function updateGems(dt) {
  for (const gem of gems) {
    gem.pulse += dt * 5;
    const dist = Math.hypot(player.x - gem.x, player.y - gem.y);
    if (dist < player.radius + gem.radius + 6) {
      arena.score += gem.value * 10;
      player.hp = clamp(player.hp + gem.value * 4, 0, player.maxHp);
      createBurst(gem.x, gem.y, '#8af7d2', 14);
      gem.collected = true;
    }
  }
  for (let i = gems.length - 1; i >= 0; i -= 1) {
    if (gems[i].collected) {
      gems.splice(i, 1);
    }
  }

  for (const xpOrb of xpDrops) {
    xpOrb.pulse += dt * 5;
    const dist = Math.hypot(player.x - xpOrb.x, player.y - xpOrb.y);
    if (dist < player.radius + xpOrb.radius + 6) {
      player.xp += xpOrb.value;
      createBurst(xpOrb.x, xpOrb.y, '#d2a8ff', 14);
      xpOrb.collected = true;
      if (player.xp >= player.xpGoal) {
        awardRandomItem();
      }
    }
  }
  for (let i = xpDrops.length - 1; i >= 0; i -= 1) {
    if (xpDrops[i].collected) {
      xpDrops.splice(i, 1);
    }
  }
}

function updateParticles(dt) {
  for (const particle of particles) {
    particle.x += particle.dx * dt;
    particle.y += particle.dy * dt;
    particle.life -= dt;
  }

  for (let i = particles.length - 1; i >= 0; i -= 1) {
    if (particles[i].life <= 0) {
      particles.splice(i, 1);
    }
  }
}

function updateGame(dt) {
  if (arena.state !== 'playing') {
    return;
  }

  if (network.started) {
    handleMovement(dt);
    sendNetworkInput(dt);
    updateParticles(dt);
    updateHud();
    return;
  }

  arena.spawnTimer += dt;
  arena.shake = Math.max(0, arena.shake - dt * 2.5);

  if (arena.regularEnemiesSpawned < regularEnemyLimit && arena.spawnTimer > 1.35) {
    spawnEnemy();
    arena.regularEnemiesSpawned += 1;
    arena.spawnTimer = 0;
  }

  handleMovement(dt);
  handleShooting(dt);
  updateEnemies(dt);
  updateBullets(dt);
  updateGems(dt);
  updateParticles(dt);

  if (
    arena.regularEnemiesSpawned === regularEnemyLimit &&
    enemies.length === 0 &&
    !arena.bossSpawned
  ) {
    spawnBoss();
  }

  if (
    arena.regularEnemiesSpawned === regularEnemyLimit &&
    arena.bossSpawned &&
    enemies.length === 0
  ) {
    arena.state = 'victory';
    showMessage('Victory!', '全ての敵を倒した！ Rキーで再戦', true);
  }

  updateHud();
}

function drawObstacles() {
  ctx.fillStyle = '#3f4968';
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 2;

  obstacleLayout.forEach((obstacle) => {
    ctx.fillRect(obstacle.x, obstacle.y, obstacle.w, obstacle.h);
    ctx.strokeRect(obstacle.x, obstacle.y, obstacle.w, obstacle.h);

    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    for (let x = obstacle.x + 8; x < obstacle.x + obstacle.w - 4; x += 12) {
      ctx.beginPath();
      ctx.moveTo(x, obstacle.y + 4);
      ctx.lineTo(x, obstacle.y + obstacle.h - 4);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  });
}

function drawGrassPatches() {
  for (const patch of grassPatches) {
    ctx.fillStyle = 'rgba(54, 123, 73, 0.76)';
    ctx.fillRect(patch.x, patch.y, patch.w, patch.h);
    ctx.strokeStyle = 'rgba(143, 213, 112, 0.32)';
    ctx.lineWidth = 2;
    ctx.strokeRect(patch.x + 1, patch.y + 1, patch.w - 2, patch.h - 2);

    for (let x = patch.x + 8; x < patch.x + patch.w - 4; x += 18) {
      for (let y = patch.y + 8; y < patch.y + patch.h - 4; y += 18) {
        ctx.beginPath();
        ctx.strokeStyle = (x + y) % 3 === 0 ? '#8acb68' : '#549b56';
        ctx.lineWidth = 2;
        ctx.moveTo(x, y + 5);
        ctx.lineTo(x - 3, y - 3);
        ctx.moveTo(x, y + 5);
        ctx.lineTo(x + 4, y - 4);
        ctx.stroke();
      }
    }
  }
}

function drawPolygon(points, fill, stroke = '#d7f1ff', lineWidth = 0.06) {
    ctx.beginPath();
    points.forEach(([x, y], index) => {
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
  }

  function drawEnemy(enemy) {
    const radius = enemy.radius;
    const heading = Math.atan2(player.y - enemy.y, player.x - enemy.x);
    const isBoss = enemy.type === 'boss';
    const isRunner = enemy.type === 'runner';
    const coreColor = isBoss ? '#fff0fc' : '#c5fff5';

    ctx.save();
    ctx.translate(enemy.x, enemy.y);
    ctx.rotate(heading);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.34)';
    ctx.beginPath();
    ctx.ellipse(0, radius * 0.72, radius * 1.12, radius * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.scale(radius, radius);

    ctx.shadowColor = enemy.color;
    ctx.shadowBlur = isBoss ? 20 : 11;
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    ctx.arc(0, 0, isBoss ? 1.08 : 0.92, 0, Math.PI * 2);
    ctx.fillStyle = enemy.color;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    if (isBoss) {
      drawPolygon(
        [[-0.9, -0.34], [-0.78, -0.82], [-0.3, -0.64], [0, -1.14], [0.3, -0.64], [0.78, -0.82], [0.9, -0.34], [1.02, 0], [0.9, 0.34], [0.52, 0.8], [0, 0.96], [-0.52, 0.8], [-0.9, 0.34], [-1.02, 0]],
        '#57233f', '#ffc0e6', 0.07
      );
      drawPolygon([[-0.82, -0.5], [-1.28, -0.92], [-1.08, -0.22]], '#ff5db1', '#ffd3ed', 0.05);
      drawPolygon([[-0.82, 0.5], [-1.28, 0.92], [-1.08, 0.22]], '#ff5db1', '#ffd3ed', 0.05);
    } else if (isRunner) {
      drawPolygon([[-0.94, -0.14], [-1.3, -0.68], [-0.46, -0.46], [-0.28, 0], [-0.94, 0.14], [-1.3, 0.68], [-0.46, 0.46], [-0.28, 0]], '#9a3b3a', '#ffc0a7', 0.07);
      drawPolygon([[-0.86, -0.28], [-0.38, -0.78], [0.48, -0.68], [1.02, -0.2], [1.04, 0.2], [0.48, 0.68], [-0.38, 0.78], [-0.86, 0.28]], '#6d2832', '#ffbd9d', 0.07);
    } else {
      drawPolygon([[-0.78, -0.48], [-0.52, -0.8], [0.42, -0.8], [0.78, -0.48], [0.78, 0.48], [0.42, 0.8], [-0.52, 0.8], [-0.78, 0.48]], '#5f4933', '#ffe2a0', 0.07);
      drawPolygon([[0.45, -0.19], [1.12, -0.19], [1.12, 0.19], [0.45, 0.19]], '#d19b4e', '#fff0c4', 0.05);
      drawPolygon([[0.68, -0.31], [0.92, -0.31], [0.92, 0.31], [0.68, 0.31]], '#433b35', null);
    }

    drawPolygon(isBoss
      ? [[-0.48, -0.32], [-0.25, -0.58], [0.28, -0.58], [0.52, -0.28], [0.52, 0.28], [0.28, 0.58], [-0.25, 0.58], [-0.48, 0.32]]
      : [[-0.42, -0.36], [-0.2, -0.56], [0.3, -0.48], [0.56, -0.2], [0.56, 0.2], [0.3, 0.48], [-0.2, 0.56], [-0.42, 0.36]],
      isBoss ? '#b63379' : (isRunner ? '#d85648' : '#bd843e'),
      isBoss ? '#ffd2ed' : '#ffe9bd',
      0.05
    );

    ctx.shadowColor = coreColor;
    ctx.shadowBlur = 12;
    ctx.fillStyle = coreColor;
    ctx.beginPath();
    ctx.ellipse(0.24, 0, isBoss ? 0.2 : 0.14, isBoss ? 0.27 : 0.19, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0.22, -0.06, 0.2, 0.12);
    ctx.restore();
  }

  function drawPlayer(target = player) {
    ctx.save();
    ctx.globalAlpha = target === player && target.hidden ? 0.4 : 1;
    ctx.translate(target.x, target.y);
    ctx.rotate(target.angle);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.36)';
    ctx.beginPath();
    const radius = target.radius || 18;
    ctx.ellipse(0, radius * 0.7, radius * 1.15, radius * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.scale(radius, radius);

    ctx.shadowColor = target.color;
    ctx.shadowBlur = 18;
    drawPolygon([[-1.35, -0.38], [-0.82, -0.42], [-0.5, -0.9], [0.5, -0.82], [1.25, -0.3], [1.48, 0], [1.25, 0.3], [0.5, 0.82], [-0.5, 0.9], [-0.82, 0.42], [-1.35, 0.38], [-1.02, 0]], target.color, '#dff8ff', 0.07);
    ctx.shadowBlur = 0;
    drawPolygon([[-0.72, -0.42], [-0.35, -0.62], [0.42, -0.55], [0.9, -0.2], [0.9, 0.2], [0.42, 0.55], [-0.35, 0.62], [-0.72, 0.42], [-0.98, 0]], '#173247', '#a7eaff', 0.06);
    drawPolygon([[0.16, -0.31], [0.66, -0.22], [0.82, 0], [0.66, 0.22], [0.16, 0.31], [-0.02, 0]], '#b9f5ff', '#ffffff', 0.04);
    drawPolygon([[-0.86, -0.23], [-0.5, -0.36], [-0.3, -0.18], [-0.3, 0.18], [-0.5, 0.36], [-0.86, 0.23]], '#1a2638', target.color, 0.04);

    if (target.barrierTimer > 0) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(126, 243, 196, 0.9)';
      ctx.lineWidth = 3 / radius;
      ctx.arc(0, 0, 1.55, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawArena() {
  ctx.clearRect(0, 0, arena.width, arena.height);

  const shakeX = arena.shake > 0 ? rand(-arena.shake * 10, arena.shake * 10) : 0;
  const shakeY = arena.shake > 0 ? rand(-arena.shake * 10, arena.shake * 10) : 0;
  ctx.save();
  ctx.translate(shakeX, shakeY);

  const tiles = 24;
  for (let x = 0; x < arena.width; x += tiles) {
    for (let y = 0; y < arena.height; y += tiles) {
      ctx.fillStyle = (x + y) % (tiles * 2) === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)';
      ctx.fillRect(x, y, tiles, tiles);
    }
  }

  ctx.strokeStyle = 'rgba(120, 170, 255, 0.28)';
  ctx.lineWidth = 2;
  ctx.strokeRect(12, 12, arena.width - 24, arena.height - 24);
  drawObstacles();
  drawGrassPatches();

  for (const gem of gems) {
    const pulse = 1 + Math.sin(gem.pulse) * 0.1;
    ctx.beginPath();
    ctx.fillStyle = gem.color;
    ctx.arc(gem.x, gem.y, gem.radius * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(gem.x - 1.5, gem.y - 3.5, 3, 7);
    ctx.fillRect(gem.x - 3.5, gem.y - 1.5, 7, 3);
  }

  for (const xpOrb of xpDrops) {
    const pulse = 1 + Math.sin(xpOrb.pulse) * 0.15;
    ctx.beginPath();
    ctx.fillStyle = xpOrb.color;
    ctx.arc(xpOrb.x, xpOrb.y, xpOrb.radius * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(xpOrb.x - 1, xpOrb.y - 4, 2, 8);
    ctx.fillRect(xpOrb.x - 4, xpOrb.y - 1, 8, 2);
  }

  for (const enemy of enemies) {
    drawEnemy(enemy);

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(enemy.x - enemy.radius, enemy.y - enemy.radius - 10, enemy.radius * 2, 5);
    ctx.fillStyle = '#7ef3c4';
    ctx.fillRect(enemy.x - enemy.radius, enemy.y - enemy.radius - 10, (enemy.hp / enemy.maxHp) * enemy.radius * 2, 5);
  }

  for (const opponent of network.players) {
    if (opponent.id !== network.playerId) drawPlayer(opponent);
  }

  const visibleBullets = network.started ? network.bullets : bullets;
  for (const bullet of visibleBullets) {
    ctx.beginPath();
    ctx.fillStyle = bullet.color;
    ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  drawPlayer();

  for (const particle of particles) {
    ctx.beginPath();
    ctx.fillStyle = particle.color;
    ctx.globalAlpha = particle.life / particle.maxLife;
    ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  const barWidth = 160;
  const barX = 16;
  const barY = arena.height - 24;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(barX, barY, barWidth, 12);
  ctx.fillStyle = '#66e3b6';
  ctx.fillRect(barX, barY, (player.hp / player.maxHp) * barWidth, 12);

  ctx.fillStyle = '#ffffff';
  ctx.font = '12px Segoe UI';
  ctx.fillText('PLAYER', barX, barY - 8);

  ctx.restore();
}

let lastTime = 0;
function gameLoop(timestamp) {
  const dt = Math.min((timestamp - lastTime) / 1000 || 0.016, 0.032);
  lastTime = timestamp;

  updateGame(dt);
  drawArena();
  requestAnimationFrame(gameLoop);
}

window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  keys[key] = true;

  if (key === ' ' && arena.state === 'playing') {
    event.preventDefault();
    triggerPlayerSkill();
  }

  if ((key === 'r' || key === 'enter') && arena.state !== 'playing') {
    if (network.code) {
      if (network.socket) network.socket.close();
      network.socket = null;
      network.started = false;
      network.playerId = null;
      network.code = '';
      network.players = [];
      network.bullets = [];
      arena.state = 'selection';
      selectionOverlay.classList.add('visible');
      networkStatus.textContent = '部屋を作成するか、相手のコードを入力';
      showMessage('Battle starts!', 'WASDで移動、マウスで照準、クリックで攻撃', false);
      updateHud();
    } else {
      resetGame();
    }
  }
});

window.addEventListener('keyup', (event) => {
  keys[event.key.toLowerCase()] = false;
});

canvas.addEventListener('mousemove', (event) => {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * canvas.width;
  pointer.y = ((event.clientY - rect.top) / rect.height) * canvas.height;
});

canvas.addEventListener('mousedown', () => {
  pointer.down = true;
});

window.addEventListener('mouseup', () => {
  pointer.down = false;
});

document.querySelectorAll('.character-option').forEach((button) => {
  button.addEventListener('click', () => {
    selectCharacter(button.dataset.character);
  });
});

startMatchBtn.addEventListener('click', () => {
  resetGame();
});

createRoomBtn.addEventListener('click', () => {
  connectToRoom('create');
});

joinRoomBtn.addEventListener('click', () => {
  connectToRoom('join');
});

roomCodeInput.addEventListener('input', () => {
  roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
});

updateSelectionInfo();
player = createPlayer();
updateHud();
requestAnimationFrame(gameLoop);
