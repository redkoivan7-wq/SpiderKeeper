import { LEGACY_KEY, createBackup, openJournal, parseBackup, readLegacy, storeBackup, uid } from './storage.js';
import { button, careView, empty, h, heading, homeView, icon, link, localStamp, muted, sections } from './ui.js';
import { mountGame, paintHero } from './game.js';
import { setupPwa } from './pwa.js';
import { migrate } from './model.js';
import { mediaScope } from './media.js';
import { collectionView, comparisonView, editPet, passportView, pathFor } from './collection.js';
import { analyticsView, environmentPanel, growthPanel, terrariumStats } from './analytics.js';
import { eventEditor } from './care.js';
import { feedView } from './feed.js';
import { assign, environmentSummary, measurement, terrariaView, terrariumView } from './terraria.js';
import { ru } from './strings.js';

const $ = id => document.getElementById(id);
const screen = $('screen');
const dialog = $('dialog');
const form = $('form');
const status = $('status');
const storageError = $('storage-error');
const RECORD_KEY = 'spiderkeeper_game_record';
const filters = { pet: '', day: '', month: new Date() };
const collectionFilters = { query: '', sex: '', maturity: '', species: '', order: 'name', mode: 'cards', availability: 'active' };
let data = migrate({ pets: [], events: [], reminders: [], settings: { motion: true } });
let journal;
let route;
let gameCleanup;
let saveForm;
let busy = false;
let readingVersion = 0;
let record = readRecord();
let statusTimer;
const scopes = new Set();

function readRecord() {
  try {
    const value = Number(localStorage.getItem(RECORD_KEY));
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  } catch { return 0; }
}
function saveRecord(value) {
  record = Math.max(value, readRecord(), record);
  localStorage.setItem(RECORD_KEY, String(record));
}

function notice(message) {
  clearTimeout(statusTimer);
  status.textContent = message;
  status.hidden = false;
  statusTimer = setTimeout(() => { status.hidden = true; }, 6500);
}
const pwa = setupPwa({
  connection: $('connection'), update: $('update'), notice,
  canReload: () => !busy && !dialog.open
});
pwa.installAvailable.addEventListener('change', () => { if (route === 'settings') render(); });

function errorMessage(error) {
  if (error?.name === 'QuotaExceededError') return 'Недостаточно места на устройстве. Уменьшите размер фото или освободите место.';
  if (error?.name === 'SyntaxError') return 'Не удалось прочитать JSON. Проверьте файл резервной копии.';
  return error?.message || 'Хранилище недоступно.';
}

const areas = { terraria: ru.terraria, feeds: ru.feeds, analytics: ru.analytics };
function currentRoute() {
  const hash = location.hash.slice(1);
  const area = hash.split('/')[0];
  return Object.hasOwn(sections, area) || Object.hasOwn(areas, area) ? hash : 'home';
}
function routeParts(path) {
  const [area, token, page] = path.split('/');
  try { return { area, id: decodeURIComponent(token || ''), page }; }
  catch { return { area, id: '', page: '' }; }
}
function readFile(key) {
  return journal ? journal.file(key) : Promise.resolve(undefined);
}
function newMediaScope() {
  const scope = mediaScope(readFile);
  const tracked = { picture: scope.picture, dispose() { scope.dispose(); scopes.delete(tracked); } };
  scopes.add(tracked);
  return tracked;
}
function makeAPI() {
  let media;
  return {
    control, showForm, commit, write, notice, uid, readFile, newMediaScope,
    picture: (...args) => { media ??= newMediaScope(); return media.picture(...args); },
    addEvent, editEvent, addPet: () => editPet(makeAPI()),
    move: pet => assign(data, makeAPI(), pet)
  };
}
function render() {
  if (gameCleanup) {
    gameCleanup();
    gameCleanup = undefined;
  }
  for (const scope of scopes) scope.dispose();
  const { area, id, page } = routeParts(route);
  const active = area === 'terraria' || area === 'feeds' || (area === 'analytics' && id) ? 'pets'
    : area === 'analytics' ? 'home' : area;
  document.documentElement.classList.toggle('reduce-motion', !data.settings.motion);
  for (const anchor of $('nav').children) {
    if (anchor.hash === '#' + active) anchor.setAttribute('aria-current', 'page');
    else anchor.removeAttribute('aria-current');
  }
  screen.replaceChildren();
  screen.setAttribute('aria-label', areas[area] || sections[area][0]);
  const api = makeAPI();
  const pet = data.pets.find(item => item.id === id);
  const terrarium = data.terraria.find(item => item.id === id);
  const unavailable = area => [link('К списку', area, 'quiet', 'left'), empty('Запись недоступна.')];
  switch (area) {
    case 'game':
      gameCleanup = mountGame(screen, {
        record, saveRecord, motion: data.settings.motion && !matchMedia('(prefers-reduced-motion: reduce)').matches, notice
      });
      return;
    case 'home': {
      const reading = data.terraria.length ? h('div', { class: 'home-terra' }, data.terraria.slice(0, 3).map(item =>
        h('article', { class: 'stat' }, link(item.name, pathFor('terraria', item.id), 'quiet'), environmentSummary(data, item))))
        : empty('Добавьте террариум, чтобы видеть его параметры.');
      screen.append(...homeView(data, actions, reading));
      paintHero(screen.querySelector('.hero-art'));
      return;
    }
    case 'pets':
      screen.append(...(!id ? collectionView(data, api, collectionFilters) : !pet ? unavailable('pets')
        : page === 'compare' ? comparisonView(data, pet, api) : passportView(data, pet, api, growthPanel(data, pet, api))));
      return;
    case 'terraria':
      screen.append(...(!id ? terrariaView(data, api) : !terrarium ? unavailable('terraria')
        : page === 'stats' ? terrariumStats(data, terrarium) : terrariumView(data, terrarium, api, environmentPanel(data, terrarium))));
      return;
    case 'feeds': screen.append(...feedView(data, api, id)); return;
    case 'analytics': screen.append(...(id && !pet ? unavailable('pets') : analyticsView(data, api, pet))); return;
    case 'care': screen.append(...careView(data, actions, filters)); return;
    default: screen.append(...settingsView());
  }
}
function navigate() {
  if (route && location.hash === '#content') return;
  const next = currentRoute();
  if (next === route) return;
  route = next;
  const parts = routeParts(next);
  if (parts.area === 'care') {
    filters.pet = data.pets.some(pet => pet.id === parts.id) ? parts.id : '';
    filters.day = '';
  }
  render();
  window.scrollTo(0, 0);
  $('content').focus({ preventScroll: true });
}
async function refresh() {
  const version = ++readingVersion;
  const snapshot = await journal.read();
  if (version !== readingVersion) return;
  acceptWrite(snapshot);
}
async function commit(change) {
  if (!journal) throw new Error('Для сохранения нужно доступное хранилище IndexedDB.');
  acceptWrite(await journal.change(change));
}
function acceptWrite(next) {
  readingVersion++;
  data = next;
  record = Math.max(record, readRecord(), data.gameRecord || 0);
}
async function write(change, message) {
  try {
    await commit(change);
    render();
    notice(message);
  } catch (error) { notice(errorMessage(error)); }
}
function addEvent(petId, type, date) { eventEditor(data, makeAPI(), petId, type, date); }
function editEvent(event) { eventEditor(data, makeAPI(), event.petId, event.type, event.date, event); }

function control(name, label, value = '', options = {}) {
  const { type = 'text', choices, ...attrs } = options;
  value ??= '';
  let input;
  if (choices) {
    input = h('select', { name, ...attrs }, choices.map(([key, text]) =>
      h('option', { value: key, selected: key === value }, text)));
  } else if (type === 'textarea') {
    input = h('textarea', { name, rows: 3, ...attrs }, value);
  } else {
    input = h('input', { name, type, ...attrs });
    if (type !== 'file') input.value = value;
  }
  return h('label', { class: type === 'textarea' || type === 'file' ? 'wide' : undefined },
    h('span', {}, label), input);
}

function showForm(title, inputs, submit, label = 'Сохранить') {
  if (busy) return;
  if (!journal) return notice('Локальное хранилище недоступно. Проверьте настройки браузера и обновите страницу.');
  $('dialog-title').textContent = title;
  $('fields').replaceChildren(...inputs);
  $('form-error').hidden = true;
  $('submit').textContent = label;
  saveForm = submit;
  if (!dialog.open) dialog.showModal();
}

function choicesForPets(optional) {
  return [
    ...(optional ? [['', 'Без привязки к пауку']] : []),
    ...data.pets.map(pet => [pet.id, pet.name])
  ];
}

function editReminder(item) {
  const now = localStamp();
  showForm(item ? 'Изменить напоминание' : 'Новое напоминание', [
    control('title', 'Что нужно сделать', item?.title, { required: true, placeholder: 'Например, заменить воду' }),
    control('petId', 'Паук', item?.petId ?? (routeParts(route).area === 'care' ? filters.pet : ''), { choices: choicesForPets(true) }),
    control('date', 'Дата', item?.date || (routeParts(route).area === 'care' && filters.day) || now.slice(0, 10), { type: 'date', required: true }),
    control('time', 'Время', item?.time, { type: 'time' }),
    control('note', 'Комментарий', item?.note, { type: 'textarea' })
  ], async input => {
    const title = String(input.get('title')).trim();
    if (!title) throw new Error('Введите название напоминания.');
    await commit(current => {
      const next = { id: item?.id || uid(), petId: input.get('petId'), title,
        date: input.get('date'), time: input.get('time'), note: String(input.get('note')).trim(), done: item?.done || false };
      if (!item) current.reminders.push(next);
      else {
        const index = current.reminders.findIndex(reminder => reminder.id === item.id);
        if (JSON.stringify(current.reminders[index]) !== JSON.stringify(item)) {
          throw new Error('Напоминание изменилось в другом окне. Откройте его заново.');
        }
        current.reminders[index] = next;
      }
    });
    return 'Напоминание сохранено.';
  });
}

const actions = {
  addEvent, editEvent, editReminder, addReminder: () => editReminder(),
  measure: () => measurement(data, makeAPI()),
  async toggleReminder(item) {
    try {
      await commit(current => {
        const match = current.reminders.find(reminder => reminder.id === item.id);
        if (match) match.done = !item.done;
      });
      render();
    } catch (error) { notice(errorMessage(error)); }
  },
  filterPet(pet) {
    filters.pet = pet;
    route = pet ? pathFor('care', pet) : 'care';
    history.replaceState(null, '', '#' + route);
    render();
    screen.querySelector('select').focus();
  },
  filterDay(day) {
    filters.day = day;
    render();
    (screen.querySelector('.day[aria-pressed="true"]') || screen.querySelector('.calendar-head button'))?.focus();
  },
  changeMonth(offset) {
    filters.month = new Date(filters.month.getFullYear(), filters.month.getMonth() + offset, 1, 12);
    filters.day = '';
    render();
    screen.querySelectorAll('.calendar-head button')[offset === -1 ? 0 : 1].focus();
  }
};

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !saveForm) return;
  busy = true;
  $('form-error').hidden = true;
  $('submit').disabled = true;
  $('cancel').disabled = true;
  $('close-dialog').disabled = true;
  try {
    const message = await saveForm(new FormData(form));
    dialog.close();
    render();
    notice(message);
  } catch (error) {
    $('form-error').textContent = errorMessage(error);
    $('form-error').hidden = false;
  } finally {
    busy = false;
    $('submit').disabled = false;
    $('cancel').disabled = false;
    $('close-dialog').disabled = false;
  }
});
$('cancel').addEventListener('click', () => dialog.close());
$('close-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
dialog.addEventListener('close', () => screen.querySelector('h1')?.focus());
if (window.visualViewport) {
  const fitDialog = () => document.documentElement.style.setProperty('--dialog-height', Math.floor(window.visualViewport.height * .9) + 'px');
  window.visualViewport.addEventListener('resize', fitDialog);
  fitDialog();
}

function download(content, name) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const anchor = h('a', { href: url, download: name, hidden: true });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function settingsView() {
  const install = h('section', { class: 'panel' }, h('h2', {}, 'Приложение на устройстве'),
    pwa.standalone() ? muted('SpiderKeeper открыт как установленное приложение.')
      : h('ul', { class: 'install-steps' },
        h('li', {}, 'iPhone · Safari → Поделиться → На экран «Домой». Включите «Открыть как веб-приложение», если есть такой переключатель.'),
        h('li', {}, 'Android и Windows · найдите установку приложения в меню совместимого браузера.')),
    h('div', { class: 'actions' }, pwa.canInstall() && button('Установить', pwa.install, 'primary'),
      button('Проверить обновления', pwa.checkUpdates)));
  const backup = h('section', { class: 'panel' }, h('h2', {}, 'Резервная копия'),
    muted('Копия v3 включает коллекцию, террариумы, уход, измерения, кормовые операции, фото, настройки и рекорд. Импорт добавляет записи. При конфликте сохраняются обе версии.'),
    muted('Данные хранятся в текущем браузере. Для переноса на другое устройство или в установленное приложение используйте копию.'),
    h('div', { class: 'actions' },
      button('Экспортировать', async () => {
        try {
          const snapshot = journal ? await journal.snapshot() : { data, photos: new Map() };
          const stored = [...snapshot.photos.values()].reduce((sum, blob) => sum + blob.size, 0);
          if (stored > 24 * 1024 * 1024 && !window.confirm('Фотографии занимают около ' +
              Math.ceil(stored / 1048576) + ' МБ. JSON будет крупнее. Продолжить экспорт?')) return;
          const text = await createBackup(snapshot, record);
          download(text, 'SpiderKeeper-' + localStamp().slice(0, 10) + '.json');
          notice('Резервная копия подготовлена.');
        } catch (error) { notice(errorMessage(error)); }
      }, 'primary'),
      button('Импортировать', () => showForm('Импорт резервной копии', [
        control('backup', 'Файл SpiderKeeper в формате JSON', '', { type: 'file', required: true, accept: '.json,application/json' })
      ], async values => {
        const file = values.get('backup');
        if (file.size > 32 * 1024 * 1024 && !window.confirm('Размер копии около ' + Math.ceil(file.size / 1048576) +
            ' МБ. На iPhone импорт может упереться в доступную память. Продолжить?')) return 'Импорт отменён.';
        const backup = parseBackup(await file.text());
        await acceptWrite(await storeBackup(journal, backup));
        try { saveRecord(record); }
        catch { /* The imported record was already committed to IndexedDB. */ }
        return 'Резервная копия импортирована.';
      }, 'Импортировать')),
      !journal && button('Скачать исходные данные v1', () => {
        try {
          const raw = localStorage.getItem(LEGACY_KEY);
          if (raw === null) return notice('Исходные данные v1 отсутствуют.');
          download(raw, 'SpiderKeeper-v1-recovery.json');
        } catch (error) { notice(errorMessage(error)); }
      })));
  const motion = h('input', { type: 'checkbox', checked: data.settings.motion, disabled: !journal });
  motion.addEventListener('change', async () => {
    try {
      motion.disabled = true;
      const enabled = motion.checked;
      await commit(current => { current.settings.motion = enabled; });
      render();
      screen.querySelector('input[type="checkbox"]')?.focus();
    } catch (error) {
      motion.checked = data.settings.motion;
      motion.disabled = false;
      notice(errorMessage(error));
    }
  });
  return [
    heading('Настройки', 'SpiderKeeper 0.3 · резервные копии, установка и внешний вид'),
    h('div', { class: 'two-up' }, backup, install),
    h('section', { class: 'panel' }, h('h2', {}, 'Внешний вид'),
      h('label', { class: 'check' }, motion, 'Использовать анимации интерфейса и эффекты игры'))
  ];
}

async function start() {
  try {
    journal = await openJournal();
    await refresh();
  } catch (error) {
    journal = undefined;
    try { data = readLegacy(); }
    catch { /* Leave the legacy data intact for recovery. */ }
    storageError.textContent = 'Не удалось открыть хранилище для записи. ' + errorMessage(error);
    storageError.hidden = false;
  }
  $('nav').replaceChildren(...Object.entries(sections).map(([id, [label, symbol]]) =>
    h('a', { href: '#' + id }, icon(symbol), h('span', {}, label))));
  navigate();
  window.addEventListener('hashchange', navigate);
  window.addEventListener('focus', async () => {
    if (!journal || busy || dialog.open || route === 'game') return;
    try {
      await refresh();
      render();
    } catch (error) { notice(errorMessage(error)); }
  });
}
start();
