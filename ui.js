import { species } from './catalog.js';

const paths = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  spider: 'M10 10a2 2 0 0 1 4 0v1a4 4 0 1 1-4 0zM9 10 5 7 4 4m5 9-5-2-2-3m7 7-5 1-2 2m8 0-4 2-1 2m10-12 4-3 1-3m-5 9 5-2 2-3m-7 7 5 1 2 2m-8 0 4 2 1 2',
  journal: 'M6 3h12a2 2 0 0 1 2 2v16H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm-2 14h16M8 7h8m-8 4h6',
  game: 'M7 7h10c2 0 3 2 4 5l1 4a2 2 0 0 1-3 2l-4-3H9l-4 3a2 2 0 0 1-3-2l1-4c1-3 2-5 4-5zm1 2v5m-2.5-2.5h5m5 0h.01m3 1h.01',
  settings: 'M11 3h2l.8 2.4 2 .8 2.3-1.1 1.4 1.4-1.1 2.3.8 2 2.4.8v2l-2.4.8-.8 2 1.1 2.3-1.4 1.4-2.3-1.1-2 .8L13 22h-2l-.8-2.4-2-.8-2.3 1.1-1.4-1.4 1.1-2.3-.8-2L2.5 13v-2l2.4-.8.8-2-1.1-2.3L6 4.5l2.3 1.1 2-.8zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  plus: 'M12 5v14M5 12h14', arrow: 'M4 12h15m-6-6 6 6-6 6',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM12 7v5l3 2',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v6m8-6v6',
  feed: 'M7 11h10m-9 5 4 3 4-3m-4-13v5m-3-2 3 3 3-3',
  molt: 'M12 2c1 5 7 7 7 12a7 7 0 0 1-14 0c0-5 6-7 7-12zm-3 13c0 2 1 3 3 3',
  bell: 'M5 17h14l-2-3V9a5 5 0 1 0-10 0v5zm5 3a2 2 0 0 0 4 0',
  left: 'm14 6-6 6 6 6', right: 'm10 6 6 6-6 6',
  external: 'M13 4h7v7m0-7-9 9m7 0v7H4V6h7'
};

export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  path.setAttribute('d', paths[name]);
  svg.append(path);
  return svg;
}

export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'click') node.addEventListener('click', value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false));
  return node;
}

export const button = (label, click, kind = 'secondary', symbol) =>
  h('button', { type: 'button', class: kind, click: () => click() }, symbol && icon(symbol), label);
export const link = (label, route, kind = 'secondary', symbol) =>
  h('a', { href: '#' + route, class: 'button ' + kind }, symbol && icon(symbol), label);
export const muted = text => h('p', { class: 'muted' }, text);
export const empty = text => h('p', { class: 'empty' }, text);

export const sections = {
  home: ['Главная', 'home'], pets: ['Мои пауки', 'spider'], care: ['Уход', 'journal'],
  game: ['Игра', 'game'], settings: ['Настройки', 'settings']
};
export const eventTypes = [
  'Кормление', 'Отказ от корма', 'Линька', 'Подготовка к линьке', 'Вода',
  'Уборка террариума', 'Температура', 'Влажность', 'Заметка'
];
export const eventLabel = type => type === 'Вода' ? 'Замена воды' : type === 'Заметка' ? 'Наблюдение' : type;
export const sexLabels = { male: 'Самец', female: 'Самка', unknown: 'Пол неизвестен' };
const dateFormat = new Intl.DateTimeFormat('ru', { dateStyle: 'medium' });
const monthFormat = new Intl.DateTimeFormat('ru', { month: 'long', year: 'numeric' });
const timestampFormat = new Intl.DateTimeFormat('ru', { dateStyle: 'medium', timeStyle: 'short' });
export function localStamp(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function displayDate(value) {
  if (!value) return '—';
  const date = new Date(value + 'T12:00:00');
  return Number.isNaN(+date) || localStamp(date).slice(0, 10) !== value ? value : dateFormat.format(date).replace(/\sг\.$/u, '');
}
export function displayStamp(at) {
  const date = new Date(at);
  return Number.isNaN(+date) ? at : timestampFormat.format(date);
}
const dated = item => [displayDate(item.date), item.time].filter(Boolean).join(' · ');
const order = item => item.date + 'T' + item.time;
export const recent = events => [...events].sort((a, b) => order(b).localeCompare(order(a)));
export function lastEvent(data, pet, type) {
  const date = type === 'Линька' ? pet.lastMolt : pet.lastFeeding;
  return recent([
    ...data.events.filter(item => item.petId === pet.id && item.type === type),
    ...(date ? [{ petId: pet.id, type, date, time: '', detail: '', note: '' }] : [])
  ])[0];
}

export function heading(title, description, actions) {
  return h('div', { class: 'page-head' },
    h('div', {}, h('h1', { tabindex: '-1' }, title), description && muted(description)), actions);
}

const nameOf = (data, id) => data.pets.find(pet => pet.id === id)?.name || 'Паук';
function eventList(items, data) {
  return items.length ? h('ul', { class: 'items' }, items.map(item =>
    h('li', {},
      h('span', { class: 'item-icon' }, icon(item.type === 'Линька' ? 'molt' : item.type === 'Кормление' ? 'feed' : 'journal')),
      h('div', { class: 'item-content' },
        h('strong', {}, eventLabel(item.type)),
        h('small', {}, dated(item) + ' · ' + nameOf(data, item.petId)),
        item.detail && h('p', {}, item.detail), item.note && h('p', {}, item.note)
      )
    ))) : empty('Записей пока нет.');
}
function reminderList(items, data, actions) {
  return items.length ? h('ul', { class: 'items' }, items.map(item =>
    h('li', { class: item.done ? 'done' : undefined },
      h('span', { class: 'item-icon' }, icon('bell')),
      h('div', { class: 'item-content' }, h('strong', {}, item.title),
        h('small', {}, [
          dated(item), item.petId && nameOf(data, item.petId),
          !item.done && order(item) < (item.time ? localStamp() : localStamp().slice(0, 10)) && 'Просрочено'
        ].filter(Boolean).join(' · ')),
        item.note && h('p', {}, item.note)),
      actions && h('div', { class: 'reminder-actions' },
        button('Изменить', () => actions.editReminder(item), 'secondary'),
        button(item.done ? 'Вернуть' : 'Готово', () => actions.toggleReminder(item), item.done ? 'secondary' : 'primary')
      )
    ))) : empty('Напоминаний пока нет.');
}
const pending = items => [...items].filter(item => !item.done).sort((a, b) => order(a).localeCompare(order(b)));

function panel(title, body, action) {
  return h('section', { class: 'panel' },
    h('div', { class: 'section-head' }, h('h2', {}, title), action), body);
}

export function homeView(data, actions) {
  const events = recent(data.events);
  const feeding = recent(data.pets.map(pet => lastEvent(data, pet, 'Кормление')).filter(Boolean))[0];
  const molt = recent(data.pets.map(pet => lastEvent(data, pet, 'Линька')).filter(Boolean))[0];
  const stat = (title, symbol, value, hint) => h('article', { class: 'stat' },
    h('div', { class: 'stat-label' }, icon(symbol), title), h('strong', {}, value), h('small', {}, hint));
  const hero = h('div', { class: 'hero' },
    h('canvas', { class: 'hero-art', width: '740', height: '420', 'aria-hidden': 'true' }),
    h('div', { class: 'hero-copy' },
      h('h1', { tabindex: '-1' }, 'Мой террариум'),
      h('p', {}, 'Наблюдения, кормления и линьки ваших пауков в одном дневнике.'),
      h('div', { class: 'actions' }, link('Мои пауки', 'pets', 'primary', 'arrow'),
        button('Записать уход', actions.addEvent, 'secondary', 'plus'))));
  return [
    hero,
    h('div', { class: 'stats' },
      stat('Питомцы', 'spider', String(data.pets.length), 'Карточек в коллекции'),
      stat('Последнее кормление', 'feed', displayDate(feeding?.date), feeding ? nameOf(data, feeding.petId) : 'Ожидает записи'),
      stat('Последняя линька', 'molt', displayDate(molt?.date), molt ? nameOf(data, molt.petId) : 'Ожидает записи')),
    h('div', { class: 'two-up' },
      panel('Последние события', eventList(events.slice(0, 4), data), link('Весь дневник', 'care', 'quiet', 'arrow')),
      panel('Ближайшие напоминания', reminderList(pending(data.reminders).slice(0, 4), data),
        button('Добавить', actions.addReminder, 'quiet', 'plus'))),
    h('section', { class: 'panel play-callout' },
      h('div', { class: 'item-icon' }, icon('game')),
      h('div', {}, h('h2', {}, 'Охота паука'), muted('Поймайте насекомых в виртуальном террариуме.')),
      link('Играть', 'game', 'secondary', 'arrow'))
  ];
}

const detail = (title, value) => h('div', {}, h('dt', {}, title), h('dd', {}, value || '—'));
const sourceLink = item => h('a', { href: item.source, target: '_blank', rel: 'noopener noreferrer' },
  'World Spider Catalog', icon('external'));

export function petsView(data, photos, actions) {
  const cards = data.pets.map(pet => {
    const blob = photos.get(pet.photoId);
    const art = h('div', { class: 'pet-art' }, icon('spider'));
    if (blob) {
      const img = h('img', { src: blob, alt: 'Фото питомца ' + pet.name, loading: 'lazy' });
      img.addEventListener('error', () => {
        img.remove();
        art.append(h('small', { class: 'image-error' }, 'Формат фото недоступен в этом браузере.'));
      }, { once: true });
      art.append(img);
    }
    const match = species.find(item => item.scientific.toLowerCase() === pet.scientific.trim().toLowerCase());
    return h('article', { class: 'pet-card' }, art,
      h('div', { class: 'pet-body' },
        h('div', { class: 'section-head' }, h('h2', {}, pet.name),
          button('Изменить', () => actions.editPet(pet))),
        pet.scientific && h('p', { class: 'scientific' }, h('i', {}, pet.scientific)),
        pet.species && muted(pet.species),
        h('div', { class: 'tags' }, h('span', {}, sexLabels[pet.sex]),
          pet.stage && h('span', {}, pet.stage), pet.size && h('span', {}, pet.size)),
        h('dl', { class: 'pet-details' },
          detail('Приобретён', displayDate(pet.acquired)),
          detail('Линька', displayDate(lastEvent(data, pet, 'Линька')?.date)),
          detail('Кормление', displayDate(lastEvent(data, pet, 'Кормление')?.date))),
        pet.notes && h('p', { class: 'note' }, pet.notes),
        match && h('p', { class: 'species-link' }, sourceLink(match)),
        h('div', { class: 'actions' },
          button('Кормление', () => actions.addEvent(pet.id, 'Кормление'), 'secondary'),
          button('Линька', () => actions.addEvent(pet.id, 'Линька'), 'secondary')),
        h('details', {}, h('summary', {}, 'История изменений'),
          pet.history.length
            ? h('ul', { class: 'change-history' }, [...pet.history].reverse().map(change =>
              h('li', {}, h('strong', {}, displayStamp(change.at)), muted(change.fields.join(', ')),
                (change.values || []).map(value =>
                  h('p', { class: 'muted' }, value.label + ' · ' + value.before + ' → ' + value.after)))))
            : muted('Изменений пока нет.'))
      ));
  });
  const catalog = panel('Справочник видов', h('div', { class: 'species-grid' }, species.map(item =>
    h('details', { class: 'species-card' },
      h('summary', {}, h('strong', {}, item.name), h('i', {}, item.scientific)),
      h('p', { class: 'muted' }, 'Ареал · ' + item.range),
      h('p', {}, item.description), h('p', {}, sourceLink(item))))));
  return [
    heading('Мои пауки', 'Карточки питомцев и справочник видов', button('Добавить паука', () => actions.editPet(), 'primary', 'plus')),
    cards.length ? h('div', { class: 'pet-grid' }, cards) : h('div', { class: 'panel' }, empty('Добавьте первого питомца.')),
    catalog
  ];
}

export function calendarView(date, day, events, reminders, onMonth, onDay) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const first = new Date(year, month, 1, 12);
  const start = (first.getDay() + 6) % 7;
  const length = new Date(year, month + 1, 0).getDate();
  const today = localStamp().slice(0, 10);
  const marked = new Set([...events, ...reminders].map(item => item.date));
  const labels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(label => h('span', { class: 'weekday' }, label));
  const blanks = Array.from({ length: start }, () => h('span', { 'aria-hidden': 'true' }));
  const days = Array.from({ length }, (_, index) => {
    const dayKey = localStamp(new Date(year, month, index + 1, 12)).slice(0, 10);
    return h('button', {
      type: 'button', class: 'day' + (marked.has(dayKey) ? ' marked' : ''),
      'aria-label': displayDate(dayKey) + (marked.has(dayKey) ? ', есть записи' : ''),
      'aria-current': dayKey === today ? 'date' : undefined, 'aria-pressed': String(dayKey === day),
      click: () => onDay(dayKey)
    }, String(index + 1));
  });
  return h('section', { class: 'panel calendar' },
    h('h2', {}, 'Календарь ухода'),
    h('div', { class: 'calendar-head' },
      h('button', { type: 'button', class: 'quiet', 'aria-label': 'Предыдущий месяц', click: () => onMonth(-1) }, icon('left')),
      h('strong', {}, monthFormat.format(first)),
      h('button', { type: 'button', class: 'quiet', 'aria-label': 'Следующий месяц', click: () => onMonth(1) }, icon('right'))),
    h('div', { class: 'calendar-grid' }, labels, blanks, days),
    day && button('Показать все дни', () => onDay(''), 'quiet'));
}

export function careView(data, actions, filters) {
  const select = h('select', { 'aria-label': 'Питомец' },
    h('option', { value: '' }, 'Все пауки'),
    data.pets.map(pet => h('option', { value: pet.id, selected: pet.id === filters.pet }, pet.name)));
  select.addEventListener('change', () => actions.filterPet(select.value));
  const belongs = item => !filters.pet || item.petId === filters.pet;
  const datedFilter = item => !filters.day || item.date === filters.day;
  const events = recent(data.events.filter(belongs));
  const reminders = data.reminders.filter(belongs);
  const visible = reminders.filter(datedFilter).sort((a, b) => Number(a.done) - Number(b.done) || order(a).localeCompare(order(b)));
  return [
    heading('Уход', 'Дневник наблюдений, календарь и напоминания',
      h('div', { class: 'actions' },
        button('Напоминание', actions.addReminder, 'secondary', 'bell'),
        button('Запись', () => actions.addEvent(filters.pet, undefined, filters.day), 'primary', 'plus'))),
    h('div', { class: 'care-grid' },
      calendarView(filters.month, filters.day, events, reminders, actions.changeMonth, actions.filterDay),
      h('div', { class: 'stack' },
        panel(filters.day ? displayDate(filters.day) : 'История ухода', eventList(events.filter(datedFilter), data), select),
        panel('Напоминания', reminderList(visible, data, actions)))
    )
  ];
}
