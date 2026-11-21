import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { serve } from './serve.mjs';

const commonPaths = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
];
const executable = process.env.SPIDERKEEPER_BROWSER || commonPaths.find(existsSync);
assert(executable, 'Set SPIDERKEEPER_BROWSER to a Chromium browser executable.');
const scratch = resolve(tmpdir());
const temp = await mkdtemp(join(scratch, 'spiderkeeper-browser-'));
assert.equal(dirname(temp), scratch);
assert(basename(temp).startsWith('spiderkeeper-browser-'));
const downloads = join(temp, 'downloads');
await mkdir(downloads);
let workerVersion = '1';
const { server, url } = await serve(0, (path, body) => path === 'sw.js'
  ? body.toString().replace("const CACHE = PREFIX + '1';", "const CACHE = PREFIX + '" + workerVersion + "';") : body);
const browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--disable-background-networking', '--remote-debugging-port=0', '--user-data-dir=' + join(temp, 'profile'),
  'about:blank'], { windowsHide: true, stdio: process.env.SPIDERKEEPER_BROWSER_DEBUG ? 'inherit' : 'ignore' });
browser.on('error', error => console.error(error));
let socket;

async function until(fn, label, timeout = 10000) {
  const end = Date.now() + timeout;
  do {
    const result = await fn();
    if (result) return result;
    await sleep(70);
  } while (Date.now() < end);
  throw new Error('Timed out: ' + label);
}
const pending = new Map();
const runtimeErrors = [];
let nextId = 0;
let session;
function send(method, params = {}, sessionId = session) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, sessionId: sessionId || undefined }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
const check = (expression, label) => until(() => evaluate(expression), label);
const text = value => JSON.stringify(value);
const exists = selector => 'Boolean(document.querySelector(' + text(selector) + '))';
const click = selector => evaluate('document.querySelector(' + text(selector) + ').click()');
const clickLabel = label => evaluate(
  "[...document.querySelectorAll('button,a')].find(el => el.textContent.trim() === " + text(label) + ').click()');
const includes = value => 'document.body.innerText.includes(' + text(value) + ')';
const value = (name, value) => evaluate('(() => { const el = document.querySelector(' +
  text('#form [name="' + name + '"]') + '); el.value = ' + text(value) +
  "; el.dispatchEvent(new Event('change', {bubbles:true})); })()");
const file = (name, filename, content, mime) => evaluate(`(() => {
  const transfer = new DataTransfer();
  transfer.items.add(new File([Uint8Array.from(atob(` + text(content) + `), c => c.charCodeAt(0))],
    ` + text(filename) + `, { type: ` + text(mime) + ` }));
  document.querySelector(` + text('#form [name="' + name + '"]') + `).files = transfer.files;
})()`);
const go = async route => {
  await evaluate('location.hash = ' + text(route));
  await check(exists('#nav a[href="#' + route + '"][aria-current="page"]'), route);
};
const submit = async () => {
  await click('#submit');
  await check('!document.querySelector("dialog").open || !document.querySelector("#form-error").hidden', 'save form');
  const error = await evaluate('document.querySelector("dialog").open && document.querySelector("#form-error").textContent');
  assert.equal(error, false);
};
async function attach(targetId) {
  ({ sessionId: session } = await send('Target.attachToTarget', { targetId, flatten: true }, null));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
}
const reopen = async () => {
  await send('Page.reload');
  await check(exists('#nav [aria-current]'), 'reloaded app');
};
const legacy = JSON.stringify({
  pets: [{ id: 1, name: 'Джипи', species: 'Никарагуа (вид уточняется)' },
    { id: 2, name: '<img src=x onerror=alert(1)>', species: 'Прежняя карточка' }],
  events: [{ petId: 1, type: 'Линька', date: '2026-11-08', note: 'Исходная линька' },
    { petId: 2, type: 'Вода', date: '2026-11-15', note: 'Исходная вода' }]
});

try {
  const endpoint = await until(async () => {
    try { return (await readFile(join(temp, 'profile', 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/); }
    catch { return false; }
  }, 'Chromium debugger');
  socket = new WebSocket('ws://127.0.0.1:' + endpoint.join(''));
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails);
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    if (message.error) call.reject(new Error(JSON.stringify(message.error)));
    else call.resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const targets = await send('Target.getTargets', {}, null);
  await attach(targets.targetInfos.find(info => info.type === 'page').targetId);

  await send('Page.addScriptToEvaluateOnNewDocument', { source: `if (location.origin === ` + text(new URL(url).origin) +
    ` && !sessionStorage.getItem('seeded')) {
      localStorage.setItem('spiderkeeper_v1', ` + text(legacy) + `);
      sessionStorage.setItem('seeded', '1');
    }` });
  await send('Page.navigate', { url: url + '?utm_source=test' });
  await check(includes('Исходная линька'), 'legacy migration');
  await go('pets');
  assert.equal(await evaluate('document.querySelectorAll(".pet-card").length'), 2);
  assert(await evaluate(includes('<img src=x onerror=alert(1)>')));
  assert.equal(await evaluate('document.querySelectorAll("img[src=x]").length'), 0);
  assert.equal(await evaluate('localStorage.getItem("spiderkeeper_v1")'), legacy);

  await clickLabel('Добавить паука');
  await value('name', 'Рыжик');
  await value('scientific', 'Tliltocatl albopilosus');
  await value('species', 'Курчавый птицеед');
  await value('size', '4 см');
  const image = (await readFile(new URL('../icons/apple-touch-icon.png', import.meta.url))).toString('base64');
  await file('photo', 'photo.png', image, 'image/png');
  await submit();
  await check('Boolean([...document.images].find(img => img.alt === "Фото питомца Рыжик" && img.naturalWidth === 180))', 'IndexedDB photo');
  await evaluate('[...document.querySelectorAll(".pet-card")].at(-1).querySelector("button").click()');
  await value('name', 'Рыжик обновлён');
  await submit();
  await click('.pet-card:last-child .pet-body details summary');
  assert(await evaluate(includes('Рыжик → Рыжик обновлён')));

  await evaluate("[...document.querySelectorAll('.pet-card')].at(-1).querySelector('.actions button').click()");
  await value('detail', 'Сверчок');
  await value('note', 'Кормление прошло');
  await submit();
  await evaluate("[...document.querySelectorAll('.pet-card')].at(-1).querySelector('.actions button:last-child').click()");
  await value('note', 'Линька завершена');
  await submit();

  await go('care');
  assert(await evaluate(includes('Сверчок')));
  assert(await evaluate(includes('Линька завершена')));
  await clickLabel('Напоминание');
  await value('title', 'Поставить поилку');
  await submit();
  await click('.day[aria-current="date"]');
  assert(await evaluate(includes('Поставить поилку')));
  assert(await evaluate(includes('Кормление прошло')));
  assert(!(await evaluate(includes('Исходная линька'))));
  await clickLabel('Готово');
  await check(exists('.items .done'), 'complete reminder');
  await reopen();
  await check(includes('Поставить поилку'), 'persistence after reload');
  assert(await evaluate(includes('Исходная вода')));

  await go('game');
  await clickLabel('Начать охоту');
  await check(includes('Охота идёт.'), 'game running');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await evaluate('document.querySelector("#terrarium").scrollIntoView({block:"center"})');
  const box = await evaluate('document.querySelector("#terrarium").getBoundingClientRect().toJSON()');
  await evaluate("globalThis.aim = null; const arc = CanvasRenderingContext2D.prototype.arc;" +
    "CanvasRenderingContext2D.prototype.arc = function (...args) {" +
    "if (this.canvas.id === 'terrarium' && args[2] === 11) globalThis.aim = args.slice(0, 2);" +
    "return arc.apply(this, args); };");
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width * .76, y: box.y + box.height * .64 }] });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await check('globalThis.aim && Math.abs(aim[0] - 640 * .76) < 3 && Math.abs(aim[1] - 460 * .64) < 3', 'touch steering target');
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  for (let i = 0; i < 80; i++) {
    if (await evaluate('Number(document.querySelector(".game-stats > div strong").textContent) > 0')) break;
    const x = box.x + box.width * (.12 + (i % 5) * .19);
    const y = box.y + box.height * (.13 + (i % 7) * .12);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(230);
  }
  await check('Number(localStorage.getItem("spiderkeeper_game_record")) >= 10', 'collision and saved record');
  await clickLabel('Пауза');
  await check(includes('Охота на паузе.'), 'pause');
  const frozen = await evaluate('document.querySelector("#terrarium").toDataURL()');
  await sleep(180);
  assert.equal(await evaluate('document.querySelector("#terrarium").toDataURL()'), frozen);
  await clickLabel('Продолжить');
  await check(includes('Охота идёт.'), 'resume');
  await clickLabel('Пауза');
  const record = await evaluate('Number(localStorage.getItem("spiderkeeper_game_record"))');

  await go('settings');
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads }, null);
  await clickLabel('Экспортировать');
  const filename = await until(async () => (await readdir(downloads)).find(name => name.endsWith('.json')), 'backup download');
  const backup = await readFile(join(downloads, filename));
  const parsed = JSON.parse(backup.toString());
  assert.equal(parsed.pets.length, 3);
  assert.equal(parsed.events.length, 4);
  assert.equal(parsed.reminders[0].done, true);
  assert.equal(parsed.photos.length, 1);
  assert.equal(parsed.photos[0][1], 'data:image/png;base64,' + image);
  assert.equal(parsed.record, record);
  const importCopy = async bytes => {
    await clickLabel('Импортировать');
    await file('backup', 'backup.json', bytes.toString('base64'), 'application/json');
    await submit();
  };
  await importCopy(backup);
  await go('pets');
  assert.equal(await evaluate('document.querySelectorAll(".pet-card").length'), 3);

  await check('Boolean(navigator.serviceWorker.controller)', 'service worker control');
  const manifest = await evaluate('fetch("./manifest.webmanifest").then(r => r.json())');
  assert.equal(manifest.display, 'standalone');
  assert.equal(new URL(manifest.start_url, url).href, url);
  assert.equal(new URL(manifest.scope, url).href, url);
  for (const [path, size] of [['icons/apple-touch-icon.png', 180], ['icons/icon-192.png', 192], ['icons/icon-512.png', 512]]) {
    assert.equal(await evaluate('fetch(' + text(path) +
      ').then(r => r.blob()).then(createImageBitmap).then(image => image.width + "x" + image.height)'), size + 'x' + size);
  }

  for (const width of [320, 390, 1280]) {
    const mobile = width < 800;
    await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile });
    for (const route of ['home', 'pets', 'care', 'game', 'settings']) {
      await go(route);
      assert(await evaluate('document.documentElement.scrollWidth <= ' + width), route + ' overflow at ' + width);
      assert.equal(await evaluate('getComputedStyle(document.querySelector("nav")).position'), mobile ? 'fixed' : 'static');
    }
    if (process.env.SPIDERKEEPER_SCREENSHOT_DIR) {
      await go('home');
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(process.env.SPIDERKEEPER_SCREENSHOT_DIR, 'spiderkeeper-' + width + '.png'), Buffer.from(data, 'base64'));
    }
  }

  workerVersion = '2';
  await go('settings');
  await clickLabel('Проверить обновления');
  await check(includes('Доступно обновление SpiderKeeper'), 'waiting update');
  await clickLabel('Обновить');
  await check(exists('#nav [aria-current="page"]'), 'updated application');
  await check('caches.keys().then(keys => keys.includes("spiderkeeper-stage002-2") && !keys.includes("spiderkeeper-stage002-1"))',
    'versioned cache cleanup');

  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await send('Page.navigate', { url: url + '?offline=1#home' });
  await check(includes('Без сети'), 'offline shell navigation');
  await check(includes('Последние события') + ' && ' + includes('Линька завершена'), 'offline journal and data');
  await go('pets');
  await check('Boolean([...document.images].find(img => img.alt === "Фото питомца Рыжик обновлён" && img.naturalWidth === 180))', 'offline photo');
  await go('game');
  await check('Number(document.querySelectorAll(".game-stats strong")[2].textContent) === ' + record, 'offline game record');

  const { browserContextId } = await send('Target.createBrowserContext', {}, null);
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId }, null);
  await attach(targetId);
  await send('Page.navigate', { url: url + '#settings' });
  await check(exists('#nav [aria-current]'), 'fresh context startup');
  await importCopy(backup);
  await go('pets');
  assert.equal(await evaluate('document.querySelectorAll(".pet-card").length'), 3);
  await check('Boolean([...document.images].find(img => img.alt === "Фото питомца Рыжик обновлён" && img.naturalWidth === 180))', 'photo restored in new context');
  await go('care');
  assert(await evaluate(includes('Исходная вода')));
  assert(await evaluate(includes('Кормление прошло')));
  assert(await evaluate(includes('Линька завершена')));
  await check(exists('.items .done'), 'completed reminders restored');
  await go('settings');
  await importCopy(Buffer.from(legacy));
  await go('pets');
  assert.equal(await evaluate('document.querySelectorAll(".pet-card").length'), 3);
  await go('settings');
  const conflict = JSON.parse(legacy);
  conflict.pets[0].name = 'Джипи из другой копии';
  conflict.events[0].note = 'Линька из другой копии';
  const conflicting = Buffer.from(JSON.stringify(conflict));
  await importCopy(conflicting);
  await importCopy(conflicting);
  await go('pets');
  assert.equal(await evaluate('document.querySelectorAll(".pet-card").length'), 4);
  await go('care');
  assert(await evaluate(includes('Исходная линька')));
  assert(await evaluate(includes('Линька из другой копии')));
  await go('settings');
  await clickLabel('Импортировать');
  await file('backup', 'invalid.json', Buffer.from('{"pets":{}}').toString('base64'), 'application/json');
  await click('#submit');
  await check('!document.querySelector("#form-error").hidden', 'invalid backup rejected');
  await click('#cancel');
  await go('pets');
  assert.equal(await evaluate('document.querySelectorAll(".pet-card").length'), 4);
  assert.deepEqual(runtimeErrors, []);
  console.log('Passed: legacy migration and import, XSS-safe text, edit history, photos, events, reminders, repeat import, fresh-context restore, game, 320/390/1280px, manifest, offline shell, worker update.');
} finally {
  socket?.close();
  browser.kill();
  server.closeAllConnections();
  server.close();
  await rm(temp, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }).catch(() => {});
}
