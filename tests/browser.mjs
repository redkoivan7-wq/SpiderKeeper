import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
  await evaluate('new Promise(resolve => { const route = ' + text('#' + route) +
    '; if (location.hash === route) return resolve(); addEventListener("hashchange", resolve, {once:true}); location.hash = route; })');
  await check(exists('#nav [aria-current="page"]'), route);
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
  await value('sizeCm', '4');
  await value('sex', 'female');
  await value('maturity', 'juvenile');
  const image = (await readFile(new URL('../icons/apple-touch-icon.png', import.meta.url))).toString('base64');
  await file('photo', 'photo.png', image, 'image/png');
  await submit();
  await evaluate('[...document.querySelectorAll(".collection-card")].find(card => card.innerText.includes("Рыжик")).scrollIntoView({block:"center"})');
  await check('Boolean([...document.images].find(img => img.alt === "Фото питомца Рыжик" && img.naturalWidth === 180))', 'IndexedDB photo');
  const passport = await evaluate('[...document.querySelectorAll(".pet-card h2 a")].find(a => a.textContent === "Рыжик").hash.slice(1)');
  await go(passport);
  await clickLabel('Изменить');
  await value('name', 'Рыжик обновлён');
  await submit();
  await click('details summary');
  assert(await evaluate(includes('Рыжик → Рыжик обновлён')));
  await go('pets');
  await evaluate('(() => { const input = document.querySelector("input[type=search]"); input.value = "Tliltocatl"; input.dispatchEvent(new Event("input")); })()');
  assert.equal(await evaluate('document.querySelectorAll(".collection-card").length'), 1);
  const filter = (title, value) => evaluate('(() => { const input = [...document.querySelectorAll("select")].find(el => el.getAttribute("aria-label") === ' +
    text(title) + '); input.value = ' + text(value) + '; input.dispatchEvent(new Event("change")); })()');
  await filter('Пол', 'male');
  assert.equal(await evaluate('document.querySelectorAll(".collection-card").length'), 0);
  await filter('Пол', 'female');
  await filter('Вид списка', 'rows');
  assert(await evaluate(exists('.compact .collection-card')));
  await filter('Пол', '');
  await evaluate('(() => { const input = document.querySelector("input[type=search]"); input.value = ""; input.dispatchEvent(new Event("input")); })()');
  await go(passport);

  await clickLabel('Кормление');
  await value('detail', 'Сверчок');
  await value('note', 'Кормление прошло');
  await submit();
  await clickLabel('Линька');
  await value('date', '2026-10-27');
  await value('before', '3');
  await value('after', '4');
  await value('note', 'Линька в октябре');
  await submit();
  await clickLabel('Линька');
  await value('before', '4');
  await value('after', '4.8');
  await value('note', 'Линька завершена');
  await evaluate('document.querySelector("[name=attachment]").click()');
  await submit();
  assert(await evaluate(includes('От предыдущей линьки')));
  assert.equal(await evaluate('document.querySelectorAll(".chart-point").length'), 4);
  await clickLabel('Записать размер');
  await value('metric', 'body');
  await value('size', '2.5');
  await submit();
  assert.equal(await evaluate('document.querySelectorAll(".chart").length'), 2);

  const image2 = (await readFile(new URL('../icons/icon-512.png', import.meta.url))).toString('base64');
  await clickLabel('Добавить фото');
  await file('photo', 'after.png', image2, 'image/png');
  await value('caption', 'После линьки');
  await value('date', '2026-11-10');
  await submit();
  assert.equal(await evaluate('document.querySelectorAll(".album-item").length'), 2);
  await clickLabel('Сделать главным');
  await click('button[aria-label="Открыть основное фото"]');
  await check(exists('.lightbox[open] img'), 'full screen image');
  await clickLabel('Закрыть фото');
  await go(passport + '/compare');
  await check('document.querySelectorAll(".compare-pair img").length === 2', 'comparison photos');
  assert(await evaluate(includes('После линьки')));
  await go(passport);
  await evaluate('[...document.querySelectorAll(".album-item")].at(-1).querySelector(".actions button:last-child").click()');
  await click('#submit');
  await check(includes('Снимок используется в истории линьки'), 'linked photo protection');
  await click('#cancel');
  await clickLabel('Добавить фото');
  await file('photo', 'loose.png', image, 'image/png');
  await value('caption', 'Удаляемый снимок');
  await value('date', '2026-11-01');
  await submit();
  await evaluate('[...document.querySelectorAll(".album-item")].find(el => el.innerText.includes("Удаляемый снимок")).querySelector(".actions button:last-child").click()');
  await submit();
  assert.equal(await evaluate('document.querySelectorAll(".album-item").length'), 2);

  await go('terraria');
  await clickLabel('Добавить террариум');
  await value('name', 'Стеллаж A');
  await value('length', '30');
  await value('tempMax', '24');
  await submit();
  await clickLabel('Добавить террариум');
  await value('name', 'Стеллаж B');
  await submit();
  const terrariums = await evaluate('[...document.querySelectorAll(".pet-card h2 a")].map(el => el.hash.slice(1))');
  await go(terrariums[0]);
  await clickLabel('Изменить');
  await value('length', '32');
  await submit();
  assert(await evaluate(includes('32 см')));
  await clickLabel('Записать измерение');
  await value('temperature', '27');
  await value('humidity', '74');
  await submit();
  assert(await evaluate(includes('За пределами вашего диапазона')));
  await clickLabel('Записать обслуживание');
  await value('note', 'Убрали грунт');
  await submit();
  await clickLabel('Назначить паука');
  await value('pet', decodeURIComponent(passport.split('/')[1]));
  await submit();
  assert(await evaluate(includes('Текущий питомец · Рыжик обновлён')));
  await go(passport);
  await clickLabel('Переселить');
  await value('terrarium', decodeURIComponent(terrariums[1].split('/')[1]));
  await value('note', 'Подрос');
  await submit();
  assert(await evaluate(includes('Стеллаж A → Стеллаж B')));
  await go(terrariums[0]);
  assert(await evaluate(includes('Террариум свободен')));
  await go(terrariums[1]);
  assert(await evaluate(includes('Текущий питомец · Рыжик обновлён')));
  await go('analytics');
  assert(await evaluate(includes('27 °C')));

  await go('feeds');
  await clickLabel('Добавить корм');
  await value('name', 'Тараканы');
  await value('initial', '8');
  await value('price', '75');
  await submit();
  const feed = await evaluate('document.querySelector(".feed-tile h2 a").hash.slice(1)');
  await go(passport);
  await clickLabel('Кормление');
  await value('feed', decodeURIComponent(feed.split('/')[1]));
  await evaluate('document.querySelector("[name=debit]").click()');
  await value('count', '3');
  await evaluate('document.querySelector("#submit").click(); document.querySelector("#submit").click()');
  await check('!document.querySelector("#dialog").open', 'double-submitted feeding');
  await go(feed);
  assert(await evaluate(includes('Остаток · 5 шт.')));
  await go(passport);
  await evaluate('[...document.querySelectorAll(".items li")].find(el => el.innerText.includes("Тараканы") && el.innerText.includes("Кормление")).querySelector("button").click()');
  await value('note', 'Кормление сверено');
  await submit();
  await go(feed);
  assert(await evaluate(includes('Остаток · 5 шт.')));
  await go(passport);
  await clickLabel('Кормление');
  await value('type', 'Отказ от корма');
  await value('feed', decodeURIComponent(feed.split('/')[1]));
  assert(await evaluate('document.querySelector("[name=debit]").disabled'));
  await submit();
  await go(feed);
  assert(await evaluate(includes('Остаток · 5 шт.')));
  await evaluate('[...document.querySelectorAll(".items li")].find(el => el.innerText.includes("Кормление")).querySelector("button").click()');
  await submit();
  assert(await evaluate(includes('Остаток · 8 шт.')));
  await clickLabel('Исправить остаток');
  await value('count', '4');
  await submit();
  await clickLabel('Уменьшить количество');
  await value('count', '7');
  await click('#submit');
  await check(includes('На складе недостаточно'), 'negative stock blocked');
  await click('#cancel');
  assert(await evaluate(includes('Остаток · 4 шт.')));

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
  assert.equal(parsed.version, 3);
  assert.equal(parsed.events.length, 7);
  assert.equal(parsed.reminders[0].done, true);
  assert.equal(parsed.terraria.length, 2);
  assert.equal(parsed.album.length, 2);
  assert.equal(parsed.stock.length, 4);
  assert.equal(parsed.growth.length, 1);
  assert(parsed.photos.some(([, source]) => source === 'data:image/png;base64,' + image));
  assert(parsed.photos.some(([, source]) => source === 'data:image/png;base64,' + image2));
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

  for (const width of [320, 375, 390, 430, 768, 1280]) {
    const mobile = width < 800;
    await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile });
    for (const route of ['home', 'pets', passport, passport + '/compare', 'care', 'game', 'settings', 'terraria', ...terrariums, 'feeds', feed, 'analytics']) {
      await go(route);
      assert(await evaluate('document.documentElement.scrollWidth <= ' + width), route + ' overflow at ' + width);
      assert.equal(await evaluate('getComputedStyle(document.querySelector("nav")).position'), mobile ? 'fixed' : 'static');
    }
    if (process.env.SPIDERKEEPER_SCREENSHOT_DIR) {
      await go('home');
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(process.env.SPIDERKEEPER_SCREENSHOT_DIR, 'spiderkeeper-' + width + '.png'), Buffer.from(data, 'base64'));
      if (width === 390) {
        for (const [area, path] of [['album', passport], ['terrarium', terrariums[0]], ['feeds', feed]]) {
          await go(path);
          const screenshot = await send('Page.captureScreenshot', { format: 'png' });
          await writeFile(join(process.env.SPIDERKEEPER_SCREENSHOT_DIR, 'spiderkeeper-' + area + '.png'), Buffer.from(screenshot.data, 'base64'));
        }
      }
    }
  }

  await evaluate('caches.open("spiderkeeper-stage002-1").then(() => true)');
  workerVersion = '2';
  await go('settings');
  await clickLabel('Проверить обновления');
  await check(includes('Доступно обновление SpiderKeeper'), 'waiting update');
  await clickLabel('Импортировать');
  await click('#update button');
  await sleep(200);
  assert(await evaluate('document.querySelector("#dialog").open'));
  assert(await evaluate(includes('Доступно обновление SpiderKeeper')));
  await click('#cancel');
  await clickLabel('Обновить');
  await check(exists('#nav [aria-current="page"]'), 'updated application');
  await check('caches.keys().then(keys => keys.includes("spiderkeeper-stage003-2") && !keys.includes("spiderkeeper-stage003-1") && !keys.includes("spiderkeeper-stage002-1"))',
    'versioned cache cleanup');

  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await send('Page.navigate', { url: url + '?offline=1#home' });
  await check(includes('Без сети'), 'offline shell navigation');
  await check(includes('Последние события') + ' && ' + includes('Линька завершена'), 'offline journal and data');
  await go('pets');
  await evaluate('[...document.querySelectorAll(".collection-card")].find(card => card.innerText.includes("Рыжик")).scrollIntoView({block:"center"})');
  await check('Boolean([...document.images].find(img => img.alt === "Фото питомца Рыжик обновлён" && img.naturalWidth === 320))', 'offline photo');
  await go('game');
  await check('Number(document.querySelectorAll(".game-stats strong")[2].textContent) === ' + record, 'offline game record');

  await go(terrariums[1]);
  await clickLabel('Записать измерение');
  await value('temperature', '23');
  await value('note', 'Без интернета');
  await submit();
  assert(await evaluate(includes('Без интернета')));

  async function fresh() {
    const { browserContextId } = await send('Target.createBrowserContext', {}, null);
    const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId }, null);
    await attach(targetId);
  }
  await fresh();
  await send('Page.navigate', { url: url + '#settings' });
  await check(exists('#nav [aria-current]'), 'fresh context startup');
  await importCopy(backup);
  await go('pets');
  assert.equal(await evaluate('document.querySelectorAll(".pet-card").length'), 3);
  await evaluate('[...document.querySelectorAll(".collection-card")].find(card => card.innerText.includes("Рыжик")).scrollIntoView({block:"center"})');
  await check('Boolean([...document.images].find(img => img.alt === "Фото питомца Рыжик обновлён" && img.naturalWidth === 320))', 'photo restored in new context');
  await go('care');
  assert(await evaluate(includes('Исходная вода')));
  assert(await evaluate(includes('Кормление прошло')));
  assert(await evaluate(includes('Линька завершена')));
  await check(exists('.items .done'), 'completed reminders restored');
  await go(terrariums[1]);
  assert(await evaluate(includes('Текущий питомец · Рыжик обновлён')));
  await go(terrariums[0]);
  assert(await evaluate(includes('Убрали грунт')));
  assert(await evaluate(includes('27 °C')));
  await go(feed);
  assert(await evaluate(includes('Остаток · 4 шт.')));
  await go(passport);
  assert.equal(await evaluate('document.querySelectorAll(".album-item").length'), 2);
  assert.equal(await evaluate('document.querySelectorAll(".chart-point").length'), 5);
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
  await fresh();
  await send('Page.navigate', { url: url + 'styles.css' });
  await check('location.pathname.endsWith("/styles.css")', 'legacy fixture origin');
  const key = 'image/png:' + createHash('sha256').update(Buffer.from(image, 'base64')).digest('hex');
  const stage2 = {
    pets: [{ id: 'existing', name: 'Питомец этапа 002', scientific: '', species: 'Вид неизвестен', sex: 'unknown',
      stage: '', acquired: '', size: '4 см', lastMolt: '', lastFeeding: '', notes: '', photoId: key, history: [] }],
    events: [{ id: 'stage2-event', petId: 'existing', type: 'Линька', date: '2026-10-11',
      time: '', detail: '', note: 'Исходная запись этапа 002' }],
    reminders: [], settings: { motion: false }
  };
  await evaluate('new Promise((resolve, reject) => {' +
    'const r=indexedDB.open("spiderkeeper",1); r.onupgradeneeded=()=>{r.result.createObjectStore("journal"); r.result.createObjectStore("photos");};' +
    'r.onerror=()=>reject(r.error); r.onsuccess=()=>{const db=r.result; const tx=db.transaction(["journal","photos"],"readwrite");' +
    'tx.objectStore("journal").put(' + text(stage2) + ',"data");' +
    'tx.objectStore("photos").put(new Blob([Uint8Array.from(atob(' + text(image) + '), c=>c.charCodeAt(0))],{type:"image/png"}),' + text(key) + ');' +
    'tx.oncomplete=()=>{db.close(); localStorage.setItem("spiderkeeper_game_record","80"); resolve(true);};tx.onabort=()=>reject(tx.error);};})');
  await send('Page.navigate', { url: url + '#pets/existing' });
  await check(includes('Исходная запись этапа 002'), 'v2 IndexedDB migration');
  await evaluate('document.querySelector(".album-item").scrollIntoView({block:"center"})');
  await check('Boolean(document.querySelector(".album-item img")?.naturalWidth)', 'migrated full picture');
  await go('game');
  assert(await evaluate(includes('80')));
  await go('settings');
  const oldExport = { format: 'spiderkeeper', version: 2, ...stage2, photos: [[key, 'data:image/png;base64,' + image]], record: 80 };
  await importCopy(Buffer.from(JSON.stringify(oldExport)));
  await go('pets');
  assert.equal(await evaluate('document.querySelectorAll(".collection-card").length'), 1);
  await go('settings');
  const alternate = {
    ...oldExport, pets: [{ ...stage2.pets[0], id: 'alternate', name: 'Не должен появиться', photoId: 'different' }],
    events: [], photos: [['different', 'data:image/png;base64,' + image2]]
  };
  await evaluate("globalThis.originalPut = IDBObjectStore.prototype.put;" +
    "IDBObjectStore.prototype.put = function (...args) { if (this.name === 'journal') throw new DOMException('Test quota exceeded','QuotaExceededError'); return originalPut.apply(this,args); };");
  await clickLabel('Импортировать');
  await file('backup', 'quota.json', Buffer.from(JSON.stringify(alternate)).toString('base64'), 'application/json');
  await click('#submit');
  await check(includes('Недостаточно места'), 'quota simulation');
  await click('#cancel');
  await evaluate('IDBObjectStore.prototype.put = originalPut');
  assert.deepEqual(await evaluate('import("./storage.js").then(m=>m.openJournal()).then(j=>j.snapshot()).then(s=>[s.data.pets.length,s.photos.size])'), [1, 1]);

  await clickLabel('Импортировать');
  alternate.photos[0][1] = 'data:image/png;base64,iVBORw0KGgo=';
  await file('backup', 'badphoto.json', Buffer.from(JSON.stringify(alternate)).toString('base64'), 'application/json');
  await click('#submit');
  await check(includes('повреждённое изображение'), 'damaged image is rejected');
  await click('#cancel');

  await go('pets/existing');
  await clickLabel('Архивировать');
  await submit();
  await go('pets');
  assert.equal(await evaluate('document.querySelectorAll(".collection-card").length'), 0);
  await filter('Активные или архивные', 'archive');
  assert.equal(await evaluate('document.querySelectorAll(".collection-card").length'), 1);
  await go('pets/existing');
  await clickLabel('Удалить карточку');
  await submit();
  await check('location.hash === "#pets"', 'deleted archived record');
  assert.deepEqual(await evaluate('import("./storage.js").then(m=>m.openJournal()).then(j=>j.snapshot()).then(s=>[s.data.pets.length,s.photos.size])'), [0, 0]);

  await fresh();
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(globalThis,'indexedDB',{value:undefined});" });
  await send('Page.navigate', { url: url + '#pets' });
  await check(includes('Не удалось открыть хранилище'), 'IndexedDB unavailable');
  await clickLabel('Добавить паука');
  assert(!(await evaluate('document.querySelector("#dialog").open')));
  assert.deepEqual(runtimeErrors, []);
  console.log('Passed: v1, live IndexedDB v2 migration, v2/v3 import, album/molt/placement/feed/chart UI, XSS-safe text, offline writes, game, all viewport widths, update/cache cleanup, storage unavailable and quota rollback.');
} finally {
  socket?.close();
  browser.kill();
  server.closeAllConnections();
  server.close();
  await rm(temp, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }).catch(() => {});
}
