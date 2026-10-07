const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT) || 8080;
const ARENA = { width: 960, height: 540 };
const OBSTACLES = [
  { x: 210, y: 180, w: 128, h: 32 },
  { x: 630, y: 120, w: 132, h: 32 },
  { x: 360, y: 302, w: 168, h: 34 },
  { x: 122, y: 368, w: 90, h: 96 },
  { x: 744, y: 354, w: 92, h: 102 },
  { x: 500, y: 160, w: 38, h: 160 },
];
const CHARACTERS = {
  nova: { hp: 100, speed: 255, damage: 16, fireRate: 0.18, color: '#7ae0ff', skill: 'burst' },
  blaze: { hp: 88, speed: 285, damage: 18, fireRate: 0.14, color: '#ff9a6b', skill: 'dash' },
  titan: { hp: 118, speed: 220, damage: 14, fireRate: 0.2, color: '#7ef3c4', skill: 'barrier' },
};
const rooms = new Map();

function send(socket, data) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(data));
  }
}

function createCode() {
  let code;
  do {
    code = Math.random().toString(36).slice(2, 6).toUpperCase();
  } while (rooms.has(code));
  return code;
}

function createPlayer(socket, character, index) {
  const config = CHARACTERS[character] || CHARACTERS.nova;
  return {
    id: randomUUID(),
    socket,
    character: CHARACTERS[character] ? character : 'nova',
    x: index === 0 ? 180 : 780,
    y: ARENA.height / 2,
    angle: index === 0 ? 0 : Math.PI,
    hp: config.hp,
    maxHp: config.hp,
    speed: config.speed,
    damage: config.damage,
    fireRate: config.fireRate,
    color: config.color,
    skill: config.skill,
    fireCooldown: 0,
    skillCooldown: 0,
    barrierTimer: 0,
    invuln: 0,
    input: { x: 0, y: 0, aim: 0, shooting: false, skill: false },
  };
}

function publicPlayer(player) {
  return {
    id: player.id,
    character: player.character,
    x: player.x,
    y: player.y,
    angle: player.angle,
    hp: player.hp,
    maxHp: player.maxHp,
    color: player.color,
    barrierTimer: player.barrierTimer,
    skillCooldown: player.skillCooldown,
  };
}

function broadcast(room, data) {
  const payload = JSON.stringify(data);
  for (const player of room.players) {
    if (player.socket.readyState === WebSocket.OPEN) {
      player.socket.send(payload);
    }
  }
}

function joinRoom(socket, request) {
  if (socket.room) {
    send(socket, { type: 'error', message: 'すでに部屋に接続しています' });
    return;
  }

  const code = String(request.code || '').trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) {
    send(socket, { type: 'error', message: '部屋が見つかりません' });
    return;
  }
  if (room.players.length >= 2) {
    send(socket, { type: 'error', message: 'この部屋は満員です' });
    return;
  }

  const player = createPlayer(socket, request.character, room.players.length);
  room.players.push(player);
  socket.room = room;
  socket.player = player;
  room.started = true;
  broadcast(room, {
    type: 'started',
    code: room.code,
    playerId: null,
    players: room.players.map(publicPlayer),
  });
  for (const participant of room.players) {
    send(participant.socket, { type: 'identity', playerId: participant.id });
  }
}

function createRoom(socket, request) {
  if (socket.room) {
    send(socket, { type: 'error', message: 'すでに部屋に接続しています' });
    return;
  }

  const code = createCode();
  const player = createPlayer(socket, request.character, 0);
  const room = { code, players: [player], bullets: [], started: false, winner: null, lastTick: Date.now() };
  rooms.set(code, room);
  socket.room = room;
  socket.player = player;
  send(socket, { type: 'room-created', code, playerId: player.id });
}

function circleHitsRect(x, y, radius, rect) {
  const nearestX = Math.max(rect.x, Math.min(x, rect.x + rect.w));
  const nearestY = Math.max(rect.y, Math.min(y, rect.y + rect.h));
  return Math.hypot(x - nearestX, y - nearestY) < radius + 2;
}

function collides(x, y, radius) {
  return OBSTACLES.some((obstacle) => circleHitsRect(x, y, radius, obstacle));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function spawnBullet(room, player, angle, speed, damage, color, radius = 4) {
  room.bullets.push({
    owner: player.id,
    x: player.x + Math.cos(angle) * (player.radius || 18),
    y: player.y + Math.sin(angle) * (player.radius || 18),
    dx: Math.cos(angle) * speed,
    dy: Math.sin(angle) * speed,
    radius,
    damage,
    color,
    life: 1.8,
  });
}

function activateSkill(room, player) {
  if (player.skillCooldown > 0) {
    return;
  }

  player.skillCooldown = player.skill === 'burst' ? 6 : player.skill === 'dash' ? 7 : 9;
  if (player.skill === 'burst') {
    for (let index = -3; index <= 3; index += 1) {
      spawnBullet(room, player, player.angle + (index * 0.7) / 3, 620, 26, '#ffd86b', 6);
    }
  } else if (player.skill === 'dash') {
    const nextX = clamp(player.x + Math.cos(player.angle) * 120, 18, ARENA.width - 18);
    const nextY = clamp(player.y + Math.sin(player.angle) * 120, 18, ARENA.height - 18);
    if (!collides(nextX, player.y, 18)) player.x = nextX;
    if (!collides(player.x, nextY, 18)) player.y = nextY;
  } else {
    player.barrierTimer = 3.5;
    player.invuln = 1.1;
  }
}

function updateRoom(room, dt) {
  if (!room.started || room.winner) return;

  for (const player of room.players) {
    const { x, y, aim, shooting, skill } = player.input;
    const length = Math.hypot(x, y) || 1;
    const moveX = (x / length) * player.speed * dt;
    const moveY = (y / length) * player.speed * dt;
    const nextX = clamp(player.x + moveX, 18, ARENA.width - 18);
    const nextY = clamp(player.y + moveY, 18, ARENA.height - 18);
    if (!collides(nextX, player.y, 18)) player.x = nextX;
    if (!collides(player.x, nextY, 18)) player.y = nextY;
    player.angle = aim;
    player.fireCooldown = Math.max(0, player.fireCooldown - dt);
    player.skillCooldown = Math.max(0, player.skillCooldown - dt);
    player.barrierTimer = Math.max(0, player.barrierTimer - dt);
    player.invuln = Math.max(0, player.invuln - dt);

    if (skill) activateSkill(room, player);
    if (shooting && player.fireCooldown <= 0) {
      spawnBullet(room, player, player.angle, 520, player.damage, player.color);
      player.fireCooldown = player.fireRate;
    }
  }

  room.bullets = room.bullets.filter((bullet) => {
    bullet.x += bullet.dx * dt;
    bullet.y += bullet.dy * dt;
    bullet.life -= dt;
    if (bullet.life <= 0 || bullet.x < -20 || bullet.x > ARENA.width + 20 || bullet.y < -20 || bullet.y > ARENA.height + 20) return false;
    if (OBSTACLES.some((obstacle) => circleHitsRect(bullet.x, bullet.y, bullet.radius, obstacle))) return false;

    const target = room.players.find((player) => player.id !== bullet.owner);
    if (!target || Math.hypot(bullet.x - target.x, bullet.y - target.y) >= bullet.radius + 18) return true;
    if (target.invuln <= 0) {
      const reduction = target.barrierTimer > 0 ? 0.4 : 1;
      target.hp = Math.max(0, target.hp - bullet.damage * reduction);
      target.invuln = 0.45;
      if (target.hp <= 0) room.winner = bullet.owner;
    }
    return false;
  });

  broadcast(room, {
    type: 'state',
    players: room.players.map(publicPlayer),
    bullets: room.bullets.map(({ owner, x, y, dx, dy, radius, color }) => ({ owner, x, y, dx, dy, radius, color })),
    winner: room.winner,
  });
}

const staticFiles = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/game.js': ['game.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
};
const server = http.createServer((request, response) => {
  const asset = staticFiles[new URL(request.url, 'http://localhost').pathname];
  if (!asset) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }

  fs.readFile(path.join(__dirname, asset[0]), (error, content) => {
    if (error) {
      response.writeHead(500);
      response.end('Unable to load game files');
      return;
    }
    response.writeHead(200, { 'content-type': asset[1] });
    response.end(content);
  });
});
const wss = new WebSocketServer({ server });

wss.on('connection', (socket) => {
  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      send(socket, { type: 'error', message: '通信データを読み取れません' });
      return;
    }

    if (message.type === 'create') createRoom(socket, message);
    else if (message.type === 'join') joinRoom(socket, message);
    else if (message.type === 'input' && socket.player && socket.room?.started && !socket.room.winner) {
      socket.player.input = {
        x: clamp(Number(message.x) || 0, -1, 1),
        y: clamp(Number(message.y) || 0, -1, 1),
        aim: Number(message.aim) || 0,
        shooting: Boolean(message.shooting),
        skill: Boolean(message.skill),
      };
    }
  });

  socket.on('close', () => {
    const room = socket.room;
    if (!room) return;
    rooms.delete(room.code);
    for (const player of room.players) {
      if (player.socket !== socket) send(player.socket, { type: 'opponent-left' });
    }
  });
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const dt = Math.min((now - room.lastTick) / 1000, 0.05);
    room.lastTick = now;
    updateRoom(room, dt);
  }
}, 50);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Brawl Rush multiplayer server listening on port ${PORT}`);
});
