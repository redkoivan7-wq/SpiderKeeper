import { button, displayDate, empty, h, heading, link, localStamp, muted, panel, recent } from './ui.js';
import { amount, clock, day, movePet, occupancy, placed, same, terrariumDefaults } from './model.js';
import { cm, detail, fieldText, pathFor } from './collection.js';
import { enlarge, photoOptions, preparePhoto, releaseMedia, storeMedia } from './media.js';
import { labels, ru, terrariumFields } from './strings.js';

const numberFields = new Set(['length', 'width', 'height', 'depth', 'tempMin', 'tempMax', 'humidityMin', 'humidityMax']);
const numberOptions = key => ({ type: 'number', step: 'any', min: key.startsWith('temp') ? '-273.15' : ['length', 'width', 'height'].includes(key) ? '.01' : '0',
  max: key.startsWith('humidity') ? '100' : undefined });
export function terraceName(data, id) {
  return data.terraria.find(item => item.id === id)?.name || 'Без террариума';
}
export function equipmentRows(data, id) {
  const transfers = data.placements.filter(item => item.toId === id || item.fromId === id).map(row => ({
    ...row, type: 'transfer', time: '',
    title: (data.pets.find(pet => pet.id === row.petId)?.name || 'Питомец') + ' · ' +
      terraceName(data, row.fromId) + ' → ' + terraceName(data, row.toId)
  }));
  return recent([...data.maintenance.filter(row => row.terrariumId === id), ...transfers]);
}
export function serviceHistory(rows) {
  return rows.length ? h('ul', { class: 'items' }, rows.map(row => h('li', {},
    h('div', { class: 'item-content' }, h('strong', {}, row.title || labels.handling[row.type] || row.type),
      h('small', {}, [displayDate(row.date), row.time].filter(Boolean).join(' · ')),
      row.note && h('p', {}, row.note))))) : empty('Обслуживание ещё не записывали.');
}

function editTerrarium(data, api, item) {
  const { control, showForm, commit } = api;
  const values = item || terrariumDefaults;
  const choices = { kind: labels.terrarium, hide: labels.boolean, water: labels.boolean };
  const id = item?.id || api.uid();
  const inputs = Object.entries(terrariumFields).map(([key, title]) => {
    const options = numberFields.has(key) ? numberOptions(key)
      : choices[key] ? { choices: Object.entries(choices[key]) }
        : { type: key === 'started' ? 'date' : key === 'note' ? 'textarea' : 'text', required: key === 'name' };
    return control(key, title, values[key] ?? '', options);
  });
  const remove = item?.photoId && h('label', { class: 'check wide' }, h('input', { name: 'removePhoto', type: 'checkbox' }), 'Убрать фотографию');
  showForm(item ? 'Изменить террариум' : 'Добавить террариум', [...inputs, ...photoOptions(control), remove].filter(Boolean), async input => {
    const next = { ...values, id };
    for (const key of Object.keys(terrariumFields)) {
      if (numberFields.has(key)) {
        const { min, max } = numberOptions(key);
        next[key] = amount(input.get(key), Number(min), max ? Number(max) : Number.MAX_SAFE_INTEGER);
      } else next[key] = fieldText(input, key);
    }
    day(next.started);
    if (!next.name) throw new Error('Введите название террариума.');
    for (const [low, high] of [[next.tempMin, next.tempMax], [next.humidityMin, next.humidityMax]]) {
      if (low !== null && high !== null && low > high) throw new Error('Нижняя граница диапазона выше верхней.');
    }
    const media = await preparePhoto(input.get('photo'), input.get('encoding') === 'optimized');
    if (media) Object.assign(next, { photoId: media.originalId, thumbId: media.thumbId });
    else if (input.has('removePhoto')) Object.assign(next, { photoId: '', thumbId: '' });
    await commit((current, photoStore) => {
      const index = current.terraria.findIndex(row => row.id === id);
      if (item && !same(current.terraria[index], item)) throw new Error('Террариум изменился в другом окне.');
      if (index >= 0) current.terraria[index] = next;
      else current.terraria.push(next);
      storeMedia(photoStore, media);
      if (item) releaseMedia(current, photoStore, [item.photoId, item.thumbId]);
    });
    return media?.warning || 'Террариум сохранён.';
  });
}

export function assign(data, api, pet, terrarium) {
  const { control, showForm, commit } = api;
  const occupied = occupancy(data);
  const candidates = data.pets.filter(item => !item.archived);
  const now = localStamp();
  const id = api.uid();
  const options = data.terraria.filter(item => !occupied.has(item.id) || occupied.get(item.id) === pet?.id);
  if (!pet && !candidates.length) return api.notice('Сначала добавьте активного паука.');
  showForm('Переселение питомца', [
    control('pet', 'Питомец', pet?.id || '', { choices: candidates.map(item => [item.id, item.name]), required: true,
      disabled: Boolean(pet) }),
    control('terrarium', 'Новый террариум', terrarium?.id || placed(data, pet?.id), {
      choices: [['', 'Без террариума'], ...(terrarium ? [terrarium] : options).map(item => [item.id, item.name])],
      disabled: Boolean(terrarium)
    }),
    control('date', ru.date, now.slice(0, 10), { type: 'date', required: true }),
    control('note', 'Причина переноса', '', { type: 'textarea' }),
    muted('Выбранный террариум станет текущим после сохранения.')
  ], async input => {
    const row = { id, petId: pet?.id || fieldText(input, 'pet'), toId: terrarium?.id || fieldText(input, 'terrarium'),
      date: day(input.get('date'), true), at: new Date().toISOString(), note: fieldText(input, 'note') };
    await commit(current => {
      const before = current.placements.length;
      movePet(current, row);
      if (current.placements.length === before) throw new Error('Питомец уже находится в выбранном террариуме.');
    });
    return 'История размещения обновлена.';
  });
}

export function measurement(data, api, terrarium) {
  if (!data.terraria.length) {
    api.notice('Сначала добавьте террариум.');
    editTerrarium(data, api);
    return;
  }
  const { control, showForm, commit } = api;
  const now = localStamp();
  const id = api.uid();
  showForm(ru.measurement, [
    control('terrarium', 'Террариум', terrarium?.id || '', { choices: data.terraria.map(item => [item.id, item.name]), required: true }),
    control('temperature', ru.temperature, '', { ...numberOptions('temp') }),
    control('humidity', ru.humidity, '', { ...numberOptions('humidity') }),
    control('date', ru.date, now.slice(0, 10), { type: 'date', required: true }),
    control('time', ru.time, now.slice(11), { type: 'time', required: true }),
    control('note', ru.note, '', { type: 'textarea' })
  ], async input => {
    const temperature = amount(input.get('temperature'), -273.15);
    const humidity = amount(input.get('humidity'), 0, 100);
    if (temperature === null && humidity === null) throw new Error('Введите температуру или влажность.');
    const row = { id, terrariumId: fieldText(input, 'terrarium'), temperature, humidity,
      date: day(input.get('date'), true), time: clock(input.get('time')), note: fieldText(input, 'note') };
    await commit(current => {
      if (current.environment.some(item => item.id === id)) return;
      if (!current.terraria.some(item => item.id === row.terrariumId)) throw new Error('Террариум недоступен.');
      current.environment.push(row);
    });
    return 'Измерение сохранено.';
  });
}

function maintenance(api, terrarium) {
  const { control, showForm, commit } = api;
  const now = localStamp();
  const id = api.uid();
  showForm('Записать обслуживание', [
    control('type', 'Событие', 'clean', { choices: Object.entries(labels.handling) }),
    control('date', ru.date, now.slice(0, 10), { type: 'date', required: true }),
    control('time', ru.time, now.slice(11), { type: 'time' }), control('note', ru.note, '', { type: 'textarea' })
  ], async input => {
    const row = { id, terrariumId: terrarium.id, type: fieldText(input, 'type'), date: day(input.get('date'), true),
      time: clock(input.get('time')), note: fieldText(input, 'note') };
    await commit(current => {
      if (!current.terraria.some(item => item.id === terrarium.id)) throw new Error('Террариум недоступен.');
      if (!current.maintenance.some(item => item.id === id)) current.maintenance.push(row);
    });
    return 'Обслуживание записано.';
  });
}

const isOut = (value, min, max) => (min !== null && value < min) || (max !== null && value > max);
const bound = (low, high) => low === null && high === null ? 'Диапазон не задан' : (low ?? '—') + ' … ' + (high ?? '—');
export function environmentSummary(data, item, detailed = false) {
  const history = recent(data.environment.filter(row => row.terrariumId === item.id));
  const parts = [
    ['temperature', 'Температура', '°C', item.tempMin, item.tempMax],
    ['humidity', 'Влажность', '%', item.humidityMin, item.humidityMax]
  ];
  return h('div', { class: 'environment-summary' }, parts.map(([key, label, unit, min, max]) => {
    const row = history.find(entry => entry[key] !== null);
    return h('div', { class: 'environment-reading' },
      h('strong', {}, row ? String(row[key]) + ' ' + unit : '—'), h('span', {}, label),
      row && h('small', {}, [displayDate(row.date), row.time].filter(Boolean).join(' · ')),
      detailed && h('small', {}, bound(min, max)), row && isOut(row[key], min, max) &&
        h('span', { class: 'range-alert' }, 'За пределами вашего диапазона'));
  }));
}
export function readingsHistory(rows, data) {
  return rows.length ? h('ul', { class: 'items' }, recent(rows).map(row => h('li', {},
    h('div', { class: 'item-content' }, h('strong', {}, [
      row.temperature !== null && row.temperature + ' °C', row.humidity !== null && row.humidity + ' %'
    ].filter(Boolean).join(' · ')), h('small', {}, [displayDate(row.date), row.time,
      data && terraceName(data, row.terrariumId)].filter(Boolean).join(' · ')), row.note && h('p', {}, row.note))))) : empty(ru.noData);
}

export function terrariaView(data, api) {
  const occupied = occupancy(data);
  return [
    link('К коллекции', 'pets', 'quiet', 'left'),
    heading(ru.terraria, 'Жилые места, измерения и обслуживание', button('Добавить террариум', () => editTerrarium(data, api), 'primary', 'plus')),
    data.terraria.length ? h('div', { class: 'pet-grid' }, data.terraria.map(item => {
      const pet = data.pets.find(owner => owner.id === occupied.get(item.id));
      return h('article', { class: 'pet-card' },
        item.photoId && h('div', { class: 'pet-art' }, api.picture(item.thumbId || item.photoId, 'Террариум ' + item.name)),
        h('div', { class: 'pet-body' }, h('h2', {}, h('a', { href: '#' + pathFor('terraria', item.id) }, item.name)),
          muted([labels.terrarium[item.kind], pet?.name || 'Пустой'].join(' · ')), environmentSummary(data, item),
          h('div', { class: 'actions' }, link('Открыть', pathFor('terraria', item.id), 'primary'),
            button('Изменить', () => editTerrarium(data, api, item)))));
    })) : empty('Добавьте первый террариум. Существующие карточки пауков можно привязать позже.')
  ];
}

export function terrariumView(data, item, api, graphs) {
  const occupant = data.pets.find(pet => pet.id === occupancy(data).get(item.id));
  const fields = ['kind', 'length', 'width', 'height', 'substrate', 'depth', 'hide', 'water',
    'ventilation', 'equipment', 'location', 'started', 'note'];
  function display(key) {
    if (key === 'kind') return labels.terrarium[item[key]];
    if (key === 'hide' || key === 'water') return labels.boolean[item[key]];
    if (key === 'started') return displayDate(item[key]);
    if (numberFields.has(key)) return cm(item[key]);
    return item[key] || '—';
  }
  return [
    h('div', { class: 'actions' }, link(ru.terraria, 'terraria', 'quiet', 'left'), link(ru.analytics, pathFor('terraria', item.id, 'stats'))),
    heading(item.name, occupant ? 'Текущий питомец · ' + occupant.name : 'Террариум свободен', button('Изменить', () => editTerrarium(data, api, item))),
    h('div', { class: 'two-up terrarium-panels' },
      panel('Паспорт террариума', h('div', {}, h('dl', { class: 'facts' }, fields.map(key => detail(terrariumFields[key], display(key)))),
        h('div', { class: 'actions' }, occupant ? [link('К паспорту паука', pathFor('pets', occupant.id)),
          button('Переселить', () => assign(data, api, occupant))] : button('Назначить паука', () => assign(data, api, undefined, item))))),
      panel('Параметры среды', h('div', {}, muted('Ручные измерения'), environmentSummary(data, item, true),
        h('div', { class: 'actions' }, button(ru.measurement, () => measurement(data, api, item), 'primary')),
        item.photoId && h('button', { type: 'button', class: 'photo-button cover-photo', 'aria-label': 'Открыть фото террариума',
          click: () => enlarge(api.readFile, item.photoId, item.name) }, api.picture(item.thumbId || item.photoId, item.name))))),
    graphs,
    panel('История обслуживания', serviceHistory(equipmentRows(data, item.id)),
      button('Записать обслуживание', () => maintenance(api, item), 'secondary', 'plus'))
  ];
}
