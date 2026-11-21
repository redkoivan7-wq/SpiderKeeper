import { button, h, heading, icon, muted } from './ui.js';

const WIDTH = 640;
const HEIGHT = 460;
const MARGIN = 24;
const SCORE = 10;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const random = (min, max) => min + Math.random() * (max - min);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function seeded(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function ellipse(ctx, x, y, rx, ry, fill, angle = 0) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, angle, 0, Math.PI * 2);
  ctx.fill();
}

function leaf(ctx, x, y, length, angle, fill) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(length * .2, -length * .5, length * .82, -length * .22, length, 0);
  ctx.bezierCurveTo(length * .68, length * .36, length * .24, length * .32, 0, 0);
  ctx.fill();
  ctx.strokeStyle = '#adac6444';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(length * .5, 5, length * .88, 0);
  ctx.stroke();
  ctx.restore();
}

function frond(ctx, x, y, length, angle) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  for (let i = 1; i < 10; i++) {
    const fraction = i / 10;
    const size = length * .4 * (1 - fraction);
    const bend = fraction * fraction * length * .2;
    leaf(ctx, fraction * length, bend, size, -.9 + fraction / 2, '#536d3d');
    leaf(ctx, fraction * length, bend, size, .95, '#364b29');
  }
  ctx.strokeStyle = '#778e4f';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(length * .6, 0, length, length * .2);
  ctx.stroke();
  ctx.restore();
}

function ground(ctx, width, height, hero = false) {
  const rand = seeded(2461);
  const bg = ctx.createRadialGradient(width * .65, height * .38, 6, width * .58, height * .56, width * .74);
  bg.addColorStop(0, hero ? '#4b4b35' : '#725236');
  bg.addColorStop(.38, hero ? '#353b2a' : '#584331');
  bg.addColorStop(1, '#141d16');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < 4500; i++) {
    const x = rand() * width;
    const y = rand() * height;
    const size = .4 + rand() * 3;
    ellipse(ctx, x, y, size, size * .5, i % 3 ? '#c29c7023' : '#18130f4c', rand() * Math.PI);
  }
  for (let i = 0; i < 46; i++) {
    const x = rand() * width;
    const y = rand() * height;
    if (hero ? x < width * .42 : x > 134 && x < width - 116 && y > 67 && y < height - 71) continue;
    const size = 8 + rand() * 25;
    ellipse(ctx, x, y + 3, size, size / 3, '#14170f66', i);
    leaf(ctx, x, y, size * 2, i, ['#56633a', '#8a693b', '#4b5134', '#745039'][i % 4]);
  }
  if (!hero) {
    ctx.save();
    ctx.translate(73, 76);
    ctx.rotate(-.43);
    ellipse(ctx, 3, 10, 78, 42, '#131611a1');
    const bark = ctx.createLinearGradient(0, -35, 0, 40);
    bark.addColorStop(0, '#9d7550');
    bark.addColorStop(.44, '#6d4b32');
    bark.addColorStop(1, '#423023');
    ellipse(ctx, 0, 0, 71, 34, bark);
    for (let i = -26; i <= 25; i += 5) {
      ctx.strokeStyle = i % 2 ? '#c1915b55' : '#28201588';
      ctx.beginPath();
      ctx.moveTo(-Math.sqrt(1000 - i * i) * 2, i);
      ctx.quadraticCurveTo(25, i + 10, 58, i * .38);
      ctx.stroke();
    }
    ellipse(ctx, 53, 6, 24, 21, '#2b2118');
    ellipse(ctx, 56, 7, 18, 15, '#161713');
    ctx.restore();
    for (const [x, y, size] of [[564, 66, 29], [595, 86, 20], [541, 89, 15], [65, 354, 28]]) {
      ellipse(ctx, x + 3, y + 6, size, size * .66, '#171b17aa', -.3);
      ellipse(ctx, x, y, size, size * .62, '#6a6b55', -.3);
      ellipse(ctx, x - 5, y - 4, size * .76, size * .4, '#888871', -.3);
    }
  }
  frond(ctx, width * .93, height * .97, 150, -2.6);
  frond(ctx, width * .96, height * .98, 117, -1.65);
  frond(ctx, hero ? width * .86 : 70, hero ? 29 : height * .97, 130, hero ? 2.63 : -1.35);
  frond(ctx, hero ? width * .88 : 73, hero ? 32 : height * .99, 123, hero ? .88 : -.4);
}

function drawSpider(ctx, spider, phase, scale = 1) {
  ctx.save();
  ctx.translate(spider.x, spider.y);
  ctx.rotate(spider.angle);
  ctx.scale(scale, scale);
  ellipse(ctx, -2, 5, 25, 16, '#11130e88');
  const legs = [[9, 6, 18, 13, 30, 11], [5, 9, 11, 23, 23, 29],
    [-1, 10, -5, 27, -2, 35], [-9, 8, -20, 20, -26, 29]];
  for (const side of [-1, 1]) {
    legs.forEach(([x, y, kx, ky, endX, endY], index) => {
      const sway = Math.sin(phase + index * 2 + side * 1.5) * (phase ? 3.2 : 0);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y * side);
      ctx.lineTo(kx + sway * .5, ky * side);
      ctx.lineTo(endX + sway, (endY - sway * .2) * side);
      ctx.lineWidth = 7;
      ctx.strokeStyle = '#191911';
      ctx.stroke();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#9b7655';
      ctx.stroke();
      ellipse(ctx, kx + sway * .5, ky * side, 2.7, 2.3, '#c09360');
      if (scale > 1) {
        ctx.lineWidth = .55;
        ctx.strokeStyle = '#d7b78b85';
        for (let step = 1; step <= 7; step++) {
          const t = step / 8;
          const hx = kx + (endX - kx) * t + sway;
          const hy = (ky + (endY - ky) * t) * side;
          ctx.beginPath();
          ctx.moveTo(hx, hy);
          ctx.lineTo(hx - 3.6, hy + 2.1 * side);
          ctx.stroke();
        }
      }
    });
  }
  const hide = ctx.createRadialGradient(-13, -4, 1, -8, 0, 20);
  hide.addColorStop(0, '#b8956c');
  hide.addColorStop(.48, '#684b38');
  hide.addColorStop(1, '#29251e');
  ellipse(ctx, -10, 0, 16, 13, hide);
  ellipse(ctx, 8, 0, 11, 9, '#655340');
  for (let i = 0; i < 35; i++) {
    const angle = i * 2.39996;
    const fraction = Math.sqrt((i + 1) / 35);
    const x = -10 + Math.cos(angle) * 15 * fraction;
    const y = Math.sin(angle) * 12 * fraction;
    ctx.strokeStyle = '#dec29a80';
    ctx.lineWidth = .55;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x - 2, y - 1, x - 4, y - 2);
    ctx.stroke();
  }
  ellipse(ctx, 15, -3, 2.2, 1.8, '#d7aa69');
  ellipse(ctx, 15, 3, 2.2, 1.8, '#d7aa69');
  ctx.restore();
}

export function paintHero(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ground(ctx, canvas.width, canvas.height, true);
  ctx.save();
  ctx.translate(471, 192);
  ctx.strokeStyle = '#e0cf9321';
  ctx.lineWidth = 1;
  for (const r of [112, 137, 161]) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  drawSpider(ctx, { x: 471, y: 192, angle: -1 }, 0, 4.1);
}

function spawn(spider) {
  let x = random(MARGIN, WIDTH - MARGIN);
  const y = random(MARGIN, HEIGHT - MARGIN);
  if (distance(spider, { x, y }) < 75) x = spider.x < WIDTH / 2 ? WIDTH - 70 : 70;
  return { x, y, angle: random(0, Math.PI * 2), speed: random(38, 81), phase: random(0, 6) };
}

function drawInsect(ctx, insect, time) {
  ctx.save();
  ctx.translate(insect.x, insect.y);
  ctx.rotate(insect.angle);
  const wing = Math.sin(time * 16 + insect.phase) * 2;
  ellipse(ctx, 0, 4, 10, 6, '#12171177');
  ctx.strokeStyle = '#241a11';
  ctx.lineWidth = 1.2;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(-3, 0);
    ctx.lineTo(-7, (7 + wing) * side);
    ctx.moveTo(2, 0);
    ctx.lineTo(3, (8 - wing) * side);
    ctx.moveTo(6, 0);
    ctx.lineTo(10, 4 * side);
    ctx.stroke();
  }
  ellipse(ctx, -2, 0, 8, 4.5, '#b18a57');
  ellipse(ctx, -3, 0, 6.2, 3.5, '#76552f');
  ellipse(ctx, 5, 0, 4, 3.5, '#46321c');
  ellipse(ctx, 7, 0, 1.7, 1.2, '#d6bb79');
  ctx.restore();
}

export function mountGame(container, { record, saveRecord, motion, notice }) {
  const scoreText = h('strong', {}, '0');
  const caughtText = h('strong', {}, '0');
  const recordText = h('strong', {}, String(record));
  const gameStatus = h('p', { class: 'muted', role: 'status' }, 'Охота на паузе.');
  const canvas = h('canvas', { width: WIDTH, height: HEIGHT, tabindex: '0',
    'aria-label': 'Террариум. Нажмите или потяните к цели. Стрелки перемещают паука.' });
  const stat = (title, value) => h('div', {}, h('span', {}, title), value);
  const primary = button('Начать охоту', () => toggle(), 'primary');
  primary.setAttribute('aria-controls', 'terrarium');
  canvas.id = 'terrarium';
  const reset = button('Новая игра', () => resetRound(), 'secondary');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    container.append(heading('Охота паука'), muted('Этот браузер не поддерживает рисование игры.'));
    return () => {};
  }

  container.append(
    heading('Охота паука', 'Нажимайте или ведите по террариуму, чтобы направлять паука. На ПК также работают стрелки.'),
    h('div', { class: 'game-layout' },
      h('div', { class: 'arena' }, canvas),
      h('div', { class: 'panel game-controls' },
        h('div', { class: 'section-head' }, h('h2', {}, 'Счёт охоты'), icon('game')),
        h('div', { class: 'game-stats' }, stat('Очки', scoreText), stat('Поймано', caughtText), stat('Рекорд', recordText)),
        h('div', { class: 'actions' }, primary, reset), gameStatus)));

  const backdrop = h('canvas', { width: WIDTH, height: HEIGHT });
  ground(backdrop.getContext('2d'), WIDTH, HEIGHT);
  const spider = { x: WIDTH / 2, y: HEIGHT / 2, angle: -.6 };
  let target = null;
  let insects = Array.from({ length: 8 }, () => spawn(spider));
  let captured = 0;
  let phase = 0;
  let time = 0;
  let running = false;
  let started = false;
  let frame = 0;
  let last = 0;
  let effects = [];
  const keys = new Set();

  function paint() {
    ctx.drawImage(backdrop, 0, 0);
    if (target) {
      ctx.strokeStyle = '#e3d7969e';
      ctx.beginPath();
      ctx.arc(target.x, target.y, 11, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const insect of insects) drawInsect(ctx, insect, time);
    for (const effect of effects) {
      ctx.strokeStyle = 'rgba(255,215,120,' + effect.life + ')';
      ctx.beginPath();
      ctx.arc(effect.x, effect.y, 8 + (1 - effect.life) * 26, 0, Math.PI * 2);
      ctx.stroke();
    }
    drawSpider(ctx, spider, phase, .88);
  }

  function tick(now) {
    if (!running) return;
    const dt = last ? Math.min((now - last) / 1000, .04) : 0;
    last = now;
    time += dt;
    const x = Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft'));
    const y = Number(keys.has('ArrowDown')) - Number(keys.has('ArrowUp'));
    if (x || y) target = { x: clamp(spider.x + x * 35, MARGIN, WIDTH - MARGIN),
      y: clamp(spider.y + y * 35, MARGIN, HEIGHT - MARGIN) };
    if (target) {
      const gap = distance(spider, target);
      if (gap > 1) {
        const step = Math.min(gap, 240 * dt);
        spider.angle = Math.atan2(target.y - spider.y, target.x - spider.x);
        spider.x += Math.cos(spider.angle) * step;
        spider.y += Math.sin(spider.angle) * step;
        if (motion) phase += dt * 25;
      } else {
        target = null;
        phase = 0;
      }
    }
    for (let index = 0; index < insects.length; index++) {
      const insect = insects[index];
      insect.angle += Math.sin(time * 3 + insect.phase) * dt * 2;
      insect.x += Math.cos(insect.angle) * insect.speed * dt;
      insect.y += Math.sin(insect.angle) * insect.speed * dt;
      if (insect.x < MARGIN || insect.x > WIDTH - MARGIN) insect.angle = Math.PI - insect.angle;
      if (insect.y < MARGIN || insect.y > HEIGHT - MARGIN) insect.angle = -insect.angle;
      insect.x = clamp(insect.x, MARGIN, WIDTH - MARGIN);
      insect.y = clamp(insect.y, MARGIN, HEIGHT - MARGIN);
      if (distance(spider, insect) < 21) {
        if (motion) effects.push({ x: insect.x, y: insect.y, life: 1 });
        insects[index] = spawn(spider);
        captured++;
        caughtText.textContent = captured;
        scoreText.textContent = captured * SCORE;
        if (captured * SCORE > record) {
          record = captured * SCORE;
          recordText.textContent = record;
          try { saveRecord(record); }
          catch { notice('Рекорд виден до закрытия страницы. Хранилище недоступно.'); }
        }
      }
    }
    for (const effect of effects) effect.life -= dt * 2.6;
    effects = effects.filter(effect => effect.life > 0);
    paint();
    frame = requestAnimationFrame(tick);
  }

  function toggle() {
    running = !running;
    if (running) {
      started = true;
      primary.textContent = 'Пауза';
      gameStatus.textContent = 'Охота идёт.';
      last = 0;
      frame = requestAnimationFrame(tick);
    } else {
      primary.textContent = 'Продолжить';
      gameStatus.textContent = 'Охота на паузе.';
      cancelAnimationFrame(frame);
      keys.clear();
    }
  }

  function resetRound() {
    if (running) toggle();
    captured = 0;
    phase = 0;
    time = 0;
    target = null;
    effects = [];
    Object.assign(spider, { x: WIDTH / 2, y: HEIGHT / 2, angle: -.6 });
    insects = Array.from({ length: 8 }, () => spawn(spider));
    scoreText.textContent = '0';
    caughtText.textContent = '0';
    toggle();
    paint();
  }

  function point(event) {
    const box = canvas.getBoundingClientRect();
    target = {
      x: clamp((event.clientX - box.left) * WIDTH / box.width, MARGIN, WIDTH - MARGIN),
      y: clamp((event.clientY - box.top) * HEIGHT / box.height, MARGIN, HEIGHT - MARGIN)
    };
  }
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || (!running && started)) return;
    if (!started) toggle();
    canvas.setPointerCapture(event.pointerId);
    point(event);
  });
  canvas.addEventListener('pointermove', event => {
    if (running && canvas.hasPointerCapture(event.pointerId)) point(event);
  });
  canvas.addEventListener('keydown', event => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    if (running) keys.add(event.key);
  });
  canvas.addEventListener('keyup', event => {
    if (keys.delete(event.key) && keys.size === 0) target = null;
  });
  canvas.addEventListener('blur', () => keys.clear());
  const hide = () => { if (document.hidden && running) toggle(); };
  document.addEventListener('visibilitychange', hide);
  paint();
  return () => {
    cancelAnimationFrame(frame);
    document.removeEventListener('visibilitychange', hide);
  };
}
