import { LEGACY_KEY, createBackup, openJournal, parseBackup, photoKey, readLegacy, storeBackup, uid } from './storage.js';
import { button, careView, eventLabel, eventTypes, h, heading, homeView, icon, localStamp, muted, petsView, sections, sexLabels } from './ui.js';
import { mountGame, paintHero } from './game.js';
import { setupPwa } from './pwa.js';

const $ = id => document.getElementById(id);
const screen = $('screen');
const dialog = $('dialog');
const form = $('form');
const status = $('status');
const storageError = $('storage-error');
const RECORD_KEY = 'spiderkeeper_game_record';
const petFields = {
  name: 'Имя', scientific: 'Научное название', species: 'Распространённое название',
  sex: 'Пол', stage: 'Стадия развития', acquired: 'Дата приобретения', size: 'Размер',
  lastMolt: 'Последняя известная линька', lastFeeding: 'Последнее известное кормление',
  notes: 'Комментарии', photoId: 'Фотография'
};
const sex = [['unknown', 'Неизвестен'], ['male', 'Самец'], ['female', 'Самка']];
const filters = { pet: '', day: '', month: new Date() };
let data = { pets: [], events: [], reminders: [], settings: { motion: true } };
let photos = new Map();
let journal;
let route;
let gameCleanup;
let saveForm;
let busy = false;
let readingVersion = 0;
let record = 0;
let statusTimer;
const photoURLs = new Map();

try { record = Math.max(0, Number(localStorage.getItem(RECORD_KEY)) || 0); }
catch { /* The game can still run when local storage is unavailable. */ }

function saveRecord(value) {
  const saved = Number(localStorage.getItem(RECORD_KEY)) || 0;
  record = Math.max(value, saved);
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

function currentRoute() {
  const hash = location.hash.slice(1);
  return Object.hasOwn(sections, hash) ? hash : 'home';
}

function decoratePhotos() {
  for (const [id, url] of photoURLs) {
    if (photos.has(id)) continue;
    URL.revokeObjectURL(url);
    photoURLs.delete(id);
  }
  for (const [id, blob] of photos) {
    if (!photoURLs.has(id)) photoURLs.set(id, URL.createObjectURL(blob));
  }
}

function render() {
  if (gameCleanup) {
    gameCleanup();
    gameCleanup = undefined;
  }
  document.documentElement.classList.toggle('reduce-motion', !data.settings.motion);
  for (const anchor of $('nav').children) {
    if (anchor.hash === '#' + route) anchor.setAttribute('aria-current', 'page');
    else anchor.removeAttribute('aria-current');
  }
  screen.replaceChildren();
  screen.setAttribute('aria-label', sections[route][0]);
  if (route === 'game') {
    gameCleanup = mountGame(screen, {
      record, saveRecord, motion: data.settings.motion && !matchMedia('(prefers-reduced-motion: reduce)').matches, notice
    });
  } else if (route === 'home') {
    screen.append(...homeView(data, actions));
    paintHero(screen.querySelector('.hero-art'));
  } else if (route === 'pets') {
    decoratePhotos();
    screen.append(...petsView(data, photoURLs, actions));
  } else if (route === 'care') {
    screen.append(...careView(data, actions, filters));
  } else {
    screen.append(...settingsView());
  }
}

function navigate() {
  if (route && location.hash === '#content') return;
  const next = currentRoute();
  if (next === route) return;
  route = next;
  render();
  window.scrollTo(0, 0);
  $('content').focus({ preventScroll: true });
}

async function refresh() {
  const version = ++readingVersion;
  const snapshot = await journal.snapshot();
  if (version !== readingVersion) return;
  ({ data, photos } = snapshot);
}

async function commit(change) {
  if (!journal) throw new Error('Для сохранения нужно доступное хранилище IndexedDB.');
  await acceptWrite(await journal.change(change));
}

async function acceptWrite(next) {
  readingVersion++;
  data = next;
  try { await refresh(); }
  catch { notice('Записи сохранены. Обновите страницу для повторной загрузки фотографий.'); }
}

function control(name, label, value = '', options = {}) {
  const { type = 'text', choices, ...attrs } = options;
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

function editPet(pet) {
  const val = key => pet?.[key] || '';
  const c = (key, options) => control(key, petFields[key], val(key), options);
  const fields = [
    c('name', { required: true, autocomplete: 'off' }), c('scientific', { placeholder: 'Tliltocatl albopilosus' }),
    c('species'), control('sex', petFields.sex, pet?.sex || 'unknown', { choices: sex }),
    c('stage', { placeholder: 'Например, ювенильная' }), c('size', { placeholder: 'Например, 4 см в размахе' }),
    c('acquired', { type: 'date' }), c('lastMolt', { type: 'date' }), c('lastFeeding', { type: 'date' }),
    c('notes', { type: 'textarea' }), control('photo', 'Фотография · до 20 МБ', '', { type: 'file', accept: 'image/*' })
  ];
  if (pet?.photoId) {
    fields.push(h('label', { class: 'check wide' }, h('input', { name: 'removePhoto', type: 'checkbox' }), 'Убрать текущее фото'));
  }
  showForm(pet ? 'Изменить карточку' : 'Добавить паука', fields, async input => {
    const keys = Object.keys(petFields).filter(key => key !== 'photoId');
    const values = Object.fromEntries(keys.map(key => [key, String(input.get(key) || '').trim()]));
    if (!values.name) throw new Error('Введите имя паука.');
    const file = input.get('photo');
    const replacement = file?.size ? await photoKey(file) : '';
    const photoId = replacement || (input.has('removePhoto') ? '' : pet?.photoId || '');
    const next = { id: pet?.id || uid(), ...values, photoId, history: pet?.history || [] };
    const differences = pet ? Object.keys(petFields).filter(key => next[key] !== pet[key]) : [];
    if (!pet || differences.length) {
      const entry = {
        at: new Date().toISOString(), fields: pet ? differences.map(key => petFields[key]) : ['Карточка создана']
      };
      if (pet) {
        const showValue = (item, key) => {
          if (key === 'sex') return sexLabels[item[key]];
          if (key === 'photoId') return item[key] ? 'Фото добавлено' : 'Без фото';
          return item[key] || '—';
        };
        entry.values = differences.filter(key => key !== 'photoId' || !pet.photoId || !next.photoId)
          .map(key => ({ label: petFields[key], before: showValue(pet, key), after: showValue(next, key) }));
      }
      next.history = [...next.history, entry];
    }
    await commit((current, photoStore) => {
      const index = current.pets.findIndex(item => item.id === next.id);
      if (pet && JSON.stringify(current.pets[index]) !== JSON.stringify(pet)) {
        throw new Error('Карточка изменилась в другом окне. Откройте её заново.');
      }
      if (index >= 0) current.pets[index] = next;
      else current.pets.push(next);
      if (replacement) photoStore.put(file, replacement);
      if (pet?.photoId && !current.pets.some(item => item.photoId === pet.photoId)) photoStore.delete(pet.photoId);
    });
    return pet ? 'Карточка обновлена.' : 'Паук добавлен.';
  });
}

function choicesForPets(optional) {
  return [
    ...(optional ? [['', 'Без привязки к пауку']] : []),
    ...data.pets.map(pet => [pet.id, pet.name])
  ];
}

function addEvent(petId, type = 'Кормление', date) {
  if (!data.pets.length) {
    notice('Сначала добавьте паука в дневник.');
    editPet();
    return;
  }
  const now = localStamp();
  const kind = control('type', 'Событие', type, { choices: eventTypes.map(item => [item, eventLabel(item)]) });
  const detail = control('detail', 'Корм');
  const label = detail.querySelector('span');
  const value = detail.querySelector('input');
  const select = kind.querySelector('select');
  const food = ['Кормление', 'Отказ от корма'];
  function configure() {
    const temperature = select.value === 'Температура';
    const humidity = select.value === 'Влажность';
    const measure = temperature || humidity;
    const feeding = food.includes(select.value);
    label.textContent = temperature ? 'Температура, °C' : humidity ? 'Влажность, %' : 'Корм';
    value.type = measure ? 'number' : 'text';
    value.step = 'any';
    value.min = humidity ? '0' : '';
    value.max = humidity ? '100' : '';
    value.required = measure || select.value === 'Кормление';
    value.placeholder = feeding ? 'Например, сверчок' : '';
    detail.hidden = !measure && !feeding;
  }
  select.addEventListener('change', () => { value.value = ''; configure(); });
  configure();
  showForm('Записать уход', [
    control('petId', 'Паук', petId, { choices: choicesForPets(false), required: true }),
    kind, control('date', 'Дата', date || now.slice(0, 10), { type: 'date', required: true }),
    control('time', 'Время', now.slice(11), { type: 'time', required: true }),
    detail, control('note', 'Комментарий', '', { type: 'textarea' })
  ], async input => {
    const typed = input.get('type');
    const units = typed === 'Температура' ? ' °C' : typed === 'Влажность' ? ' %' : '';
    const description = String(input.get('detail') || '').trim();
    if (typed === 'Кормление' && !description) throw new Error('Укажите корм.');
    await commit(current => {
      if (!current.pets.some(pet => pet.id === input.get('petId'))) throw new Error('Выберите паука.');
      current.events.push({
        id: uid(), petId: input.get('petId'), type: typed, date: input.get('date'),
        time: input.get('time'), detail: detail.hidden ? '' : description + units,
        note: String(input.get('note')).trim()
      });
    });
    return 'Запись добавлена в дневник.';
  });
}

function editReminder(item) {
  const now = localStamp();
  showForm(item ? 'Изменить напоминание' : 'Новое напоминание', [
    control('title', 'Что нужно сделать', item?.title, { required: true, placeholder: 'Например, заменить воду' }),
    control('petId', 'Паук', item?.petId ?? (route === 'care' ? filters.pet : ''), { choices: choicesForPets(true) }),
    control('date', 'Дата', item?.date || (route === 'care' && filters.day) || now.slice(0, 10), { type: 'date', required: true }),
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
  editPet, addEvent, editReminder, addReminder: () => editReminder(),
  async toggleReminder(item) {
    try {
      await commit(current => {
        const match = current.reminders.find(reminder => reminder.id === item.id);
        if (match) match.done = !item.done;
      });
      render();
    } catch (error) { notice(errorMessage(error)); }
  },
  filterPet(pet) { filters.pet = pet; render(); screen.querySelector('select').focus(); },
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
    muted('JSON включает карточки, историю, напоминания, фото, настройки и рекорд. Импорт добавляет записи. При конфликте сохраняются обе версии.'),
    muted('Данные хранятся в текущем браузере. Для переноса на другое устройство или в установленное приложение используйте копию.'),
    h('div', { class: 'actions' },
      button('Экспортировать', async () => {
        try {
          const snapshot = journal ? await journal.snapshot() : { data, photos };
          const text = await createBackup(snapshot, record);
          download(text, 'SpiderKeeper-' + localStamp().slice(0, 10) + '.json');
          notice('Резервная копия подготовлена.');
        } catch (error) { notice(errorMessage(error)); }
      }, 'primary'),
      button('Импортировать', () => showForm('Импорт резервной копии', [
        control('backup', 'Файл SpiderKeeper в формате JSON', '', { type: 'file', required: true, accept: '.json,application/json' })
      ], async values => {
        const file = values.get('backup');
        const backup = parseBackup(await file.text());
        await acceptWrite(await storeBackup(journal, backup));
        try { saveRecord(Math.max(backup.record, record)); }
        catch { return 'Записи восстановлены. Рекорд сохранить не удалось.'; }
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
    heading('Настройки', 'Резервные копии, установка и внешний вид'),
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
