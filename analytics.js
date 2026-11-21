import { button, displayDate, empty, eventList, h, heading, link, localStamp, muted, panel, recent } from './ui.js';
import { amount, day, daysBetween, isDate } from './model.js';
import { choice, cm, fieldText, pathFor } from './collection.js';
import { costs } from './feed.js';
import { enlarge } from './media.js';
import { environmentSummary, equipmentRows, readingsHistory, serviceHistory } from './terraria.js';
import { labels, ru } from './strings.js';

const format = new Intl.NumberFormat('ru', { maximumFractionDigits: 2 });
const dayNumber = day => Date.parse(day) / 86400000;
function periodStart(period, now = new Date()) {
  const count = { month: 1, quarter: 3, year: 12 }[period];
  if (!count) return null;
  const target = new Date(now.getFullYear(), now.getMonth() - count, 1, 12);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(last, now.getDate()));
  return localStamp(target).slice(0, 10);
}
const inPeriod = (rows, period, key = 'date') => {
  const threshold = periodStart(period);
  return threshold ? rows.filter(row => row[key] && row[key] >= threshold) : rows;
};
const byDate = (a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || '');

function periods(title, view, initial = 'all') {
  const content = h('div', { class: 'period-content' });
  const update = period => content.replaceChildren(view(period));
  const select = choice('Период · ' + title, Object.entries(labels.period), initial, update);
  update(initial);
  return panel(title, content, select);
}
function svg(tag, attrs, value) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, val] of Object.entries(attrs)) node.setAttribute(key, val);
  if (value !== undefined) node.textContent = value;
  return node;
}
function chart(points, unit, label, ranges = []) {
  const rows = [...points].filter(row => isDate(row.date) && Number.isFinite(row.value)).sort(byDate);
  if (!rows.length) return empty(ru.noData);
  const yValues = [...rows.map(row => row.value), ...ranges.filter(Number.isFinite)];
  const low = Math.min(...yValues);
  const high = Math.max(...yValues);
  const pad = (high - low) * .1 || Math.max(.5, Math.abs(high) * .06);
  const top = high + pad;
  const bottom = low - pad;
  const times = rows.map(row => dayNumber(row.date) + (row.time ? (Number(row.time.slice(0, 2)) * 60 + Number(row.time.slice(3))) / 1440 : 0));
  const scaleY = number => 20 + 126 * (top - number) / (top - bottom);
  const scaleX = index => times.at(-1) === times[0] ? 231 : 51 + 357 * (times[index] - times[0]) / (times.at(-1) - times[0]);
  const drawing = svg('svg', { viewBox: '0 0 430 177', role: 'group', 'aria-label': label });
  for (let i = 0; i < 4; i++) {
    const value = top - (top - bottom) / 3 * i;
    const y = scaleY(value);
    drawing.append(svg('line', { x1: 48, x2: 416, y1: y, y2: y, class: 'chart-grid' }),
      svg('text', { x: 43, y: y + 4, 'text-anchor': 'end' }, format.format(value)));
  }
  for (const value of ranges.filter(Number.isFinite)) {
    const y = scaleY(value);
    drawing.append(svg('line', { x1: 48, x2: 416, y1: y, y2: y, class: 'chart-boundary' }));
  }
  if (rows.length >= 2) drawing.append(svg('polyline', {
    class: 'chart-line', points: rows.map((row, i) => scaleX(i) + ',' + scaleY(row.value)).join(' ')
  }));
  const stamps = [rows[0].date, rows.at(-1).date];
  drawing.append(svg('text', { x: 49, y: 170 }, displayDate(stamps[0])));
  if (stamps[1] !== stamps[0]) drawing.append(svg('text', { x: 413, y: 170, 'text-anchor': 'end' }, displayDate(stamps[1])));
  const labelPoint = row => [displayDate(row.date), row.time, format.format(row.value) + ' ' + unit, row.origin].filter(Boolean).join(' · ');
  const info = h('p', { class: 'chart-tooltip', role: 'status' }, labelPoint(rows.at(-1)));
  function select(index) {
    info.textContent = labelPoint(rows[index]);
    for (const point of drawing.querySelectorAll('.chart-point')) point.classList.toggle('selected', Number(point.dataset.point) === index);
  }
  rows.forEach((row, index) => {
    const point = svg('g', { tabindex: 0, role: 'button', 'aria-label': labelPoint(row), class: 'chart-point', 'data-point': index });
    const cx = scaleX(index), cy = scaleY(row.value);
    point.append(svg('circle', { cx, cy, r: 12, class: 'chart-hit' }), svg('circle', { cx, cy, r: 4, class: 'chart-dot' }));
    point.addEventListener('click', () => select(index));
    point.addEventListener('focus', () => select(index));
    point.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(index); }
    });
    drawing.append(point);
  });
  const picker = choice('Точка графика · ' + label, rows.map((row, index) => [String(index), labelPoint(row)]),
    String(rows.length - 1), value => select(Number(value)));
  select(rows.length - 1);
  return h('figure', { class: 'chart' }, h('figcaption', {}, label + ' · ' + unit), drawing, info,
    rows.length === 1 ? muted('Есть одно измерение. Для линии нужны хотя бы два.') : picker);
}

function growthEntry(api, pet) {
  const id = api.uid();
  api.showForm('Записать размер', [
    api.control('metric', 'Способ измерения', pet.metric, { choices: Object.entries(labels.metric) }),
    api.control('size', 'Размер, см', '', { type: 'number', min: '.01', step: 'any', required: true }),
    api.control('date', ru.date, localStamp().slice(0, 10), { type: 'date', required: true }),
    api.control('note', ru.note, '', { type: 'textarea' })
  ], async input => {
    const size = amount(input.get('size'), .01);
    if (size === null) throw new Error('Укажите размер.');
    const row = { id, petId: pet.id, size, metric: fieldText(input, 'metric'), date: day(input.get('date'), true), note: fieldText(input, 'note') };
    await api.commit(current => {
      if (!current.pets.some(owner => owner.id === pet.id)) throw new Error('Карточка недоступна.');
      if (!current.growth.some(item => item.id === id)) current.growth.push(row);
    });
    return 'Размер записан.';
  });
}
function moltList(data, pet, rows, all, api) {
  if (!rows.length) return empty('Зарегистрированных линек за этот период пока нет.');
  return h('ul', { class: 'items' }, [...rows].reverse().map(e => {
    const index = all.findIndex(row => row.id === e.id);
    const interval = index > 0 ? daysBetween(all[index - 1].date, e.date) : null;
    const details = e.molt;
    return h('li', {}, h('div', { class: 'item-content' },
      h('strong', {}, [displayDate(e.date), e.time].filter(Boolean).join(' · ')),
      interval !== null && h('small', {}, 'От предыдущей линьки · ' + interval + ' дн.'),
      details && (details.before !== null || details.after !== null) && h('p', {}, labels.metric[details.metric] +
        ' · до: ' + cm(details.before) + ' · после: ' + cm(details.after)),
      details?.condition && h('p', {}, details.condition),
      e.note && h('p', {}, e.note),
      Boolean(details?.photoIds.length) && h('div', { class: 'actions' }, details.photoIds.map((id, i) => {
        const image = data.album.find(row => row.id === id);
        return image && button(image.caption || 'Снимок ' + (i + 1), () =>
          enlarge(api.readFile, image.originalId, image.caption || pet.name, displayDate(image.date)), 'quiet');
      }))), button('Изменить', () => api.editEvent(e), 'secondary'));
  }));
}
export function growthPanel(data, pet, api) {
  const molts = data.events.filter(row => row.petId === pet.id && row.type === ru.molt).sort(byDate);
  const rows = data.growth.filter(row => row.petId === pet.id).map(row => ({ ...row, value: row.size, origin: row.note || 'Ручное измерение' }));
  const timeline = molts.flatMap(row => row.molt ? [
    { ...row, metric: row.molt.metric, value: row.molt.before, origin: 'До линьки' },
    { ...row, metric: row.molt.metric, value: row.molt.after, origin: 'После линьки' }
  ] : []);
  return periods('Рост и линьки', period => h('div', { class: 'stack' },
    h('div', { class: 'actions' }, button('Записать размер', () => growthEntry(api, pet), 'primary'),
      button('Записать линьку', () => api.addEvent(pet.id, ru.molt))),
    h('div', { class: 'two-up' }, ...Object.entries(labels.metric).map(([metric, label]) =>
      chart(inPeriod([...rows, ...timeline].filter(row => row.metric === metric), period), 'см', label))),
    h('h3', {}, 'История линек'), moltList(data, pet, inPeriod(molts, period), molts, api)));
}
export function environmentPanel(data, terrarium) {
  const rows = data.environment.filter(row => row.terrariumId === terrarium.id);
  return periods('Графики среды', period => {
    const visible = inPeriod(rows, period);
    return h('div', { class: 'stack' }, h('div', { class: 'two-up' },
      chart(visible.map(row => ({ ...row, value: row.temperature, origin: row.note })), '°C', 'Температура', [terrarium.tempMin, terrarium.tempMax]),
      chart(visible.map(row => ({ ...row, value: row.humidity, origin: row.note })), '%', 'Влажность', [terrarium.humidityMin, terrarium.humidityMax])),
    h('h3', {}, 'Журнал измерений'), readingsHistory(visible));
  }, 'month');
}
export function terrariumStats(data, terrarium) {
  return [
    link('К террариуму', pathFor('terraria', terrarium.id), 'quiet', 'left'),
    heading(ru.analytics, terrarium.name), environmentPanel(data, terrarium),
    periods('Обслуживание террариума', period => serviceHistory(inPeriod(equipmentRows(data, terrarium.id), period)))
  ];
}
export function analyticsView(data, api, pet) {
  if (pet) {
    const rows = data.events.filter(row => row.petId === pet.id);
    return [
      link('К паспорту', pathFor('pets', pet.id), 'quiet', 'left'),
      heading(ru.analytics, pet.name),
      growthPanel(data, pet, api),
      periods('Кормления и отказы', period => eventList(recent(inPeriod(rows, period)).filter(event =>
        event.type === ru.feeding || event.type === ru.refusal), data)),
      periods('Поведение и наблюдения', period => eventList(recent(inPeriod(rows, period)).filter(event =>
        event.type === 'Заметка' || event.type === ru.premolt), data))
    ];
  }
  return [
    link('На главную', 'home', 'quiet', 'left'),
    heading(ru.analytics, 'Питомцы, события, измерения и расходы'),
    periods('Сводка коллекции', period => {
      const events = recent(inPeriod(data.events, period));
      const expense = costs(inPeriod(data.feeds, period, 'acquired'));
      const stats = [
        ['Активные питомцы', data.pets.filter(pet => !pet.archived).length], ['В архиве', data.pets.filter(pet => pet.archived).length],
        ['Террариумы', data.terraria.length], ['Кормления', events.filter(row => row.type === ru.feeding).length],
        ['Линьки', events.filter(row => row.type === ru.molt).length], ['Расходы на корм', expense || 'Нет данных']
      ];
      return h('div', { class: 'stats statistics-grid' }, stats.map(([title, value]) => h('article', { class: 'stat' },
        muted(title), h('strong', {}, String(value)))));
    }),
    periods('Последние события', period => eventList(recent(inPeriod(data.events, period)).slice(0, 20), data)),
    periods('История измерений', period => readingsHistory(inPeriod(data.environment, period), data)),
    panel('Террариумы', data.terraria.length ? h('div', { class: 'pet-grid' }, data.terraria.map(terrarium =>
      h('article', { class: 'stat' }, link(terrarium.name, pathFor('terraria', terrarium.id, 'stats'), 'quiet'),
        environmentSummary(data, terrarium)))) : empty('Террариумов пока нет.'))
  ];
}
