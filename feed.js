import { button, displayDate, empty, h, heading, link, localStamp, muted, panel } from './ui.js';
import { amount, day, postStock, same, stockCounts, undoStock } from './model.js';
import { detail, fieldText, pathFor } from './collection.js';
import { labels, ru } from './strings.js';

const currencies = [['RUB', '₽ · RUB'], ['KZT', '₸ · KZT'], ['BYN', 'BYN'], ['EUR', '€ · EUR'], ['USD', '$ · USD'], ['UAH', '₴ · UAH']];
const fields = { name: ru.name, size: 'Размер или группа', acquired: 'Дата приобретения',
  price: 'Стоимость покупки', location: 'Место содержания', note: ru.note };
const names = ['Тараканы', 'Сверчки', 'Саранча'];
const integer = { type: 'number', min: '0', step: '1' };

export const stockLabel = (row, counts) => row.name + (row.size ? ' · ' + row.size : '') + ' · ' + (counts.get(row.id) || 0) + ' шт.';
export const money = (price, currency = 'RUB') => new Intl.NumberFormat('ru', { style: 'currency', currency }).format(price);
export function costs(feeds) {
  const values = new Map();
  for (const feed of feeds) {
    if (feed.price === null) continue;
    const currency = feed.currency || 'RUB';
    values.set(currency, (values.get(currency) || 0) + feed.price);
  }
  return [...values].map(([currency, value]) => money(value, currency)).join(' · ');
}

export function operation(api, kind, input, overrides) {
  const now = localStamp();
  return { id: api.uid(), kind, date: now.slice(0, 10), time: now.slice(11),
    note: input ? fieldText(input, 'note') : '', eventId: '', undoOf: '', ...overrides };
}

function editFeed(api, item) {
  const { control, showForm, commit } = api;
  const id = item?.id || api.uid();
  const operationId = api.uid();
  const entries = [
    control('name', fields.name, item?.name, { required: true, list: 'feed-suggestions' }),
    h('datalist', { id: 'feed-suggestions' }, names.map(name => h('option', { value: name }))),
    control('size', fields.size, item?.size),
    control('acquired', fields.acquired, item?.acquired, { type: 'date' }),
    control('price', fields.price, item?.price ?? '', { type: 'number', min: '0', step: '0.01' }),
    control('currency', 'Валюта', item?.currency || 'RUB', { choices: currencies }),
    control('location', fields.location, item?.location),
    ...(!item ? [control('initial', 'Начальный остаток, шт.', '', integer)] : []),
    control('note', fields.note, item?.note, { type: 'textarea' })
  ];
  showForm(item ? 'Изменить позицию корма' : 'Добавить корм', entries, async input => {
    const next = {
      id, name: fieldText(input, 'name'), size: fieldText(input, 'size'), acquired: day(input.get('acquired')),
      price: amount(input.get('price')), currency: fieldText(input, 'currency'),
      location: fieldText(input, 'location'), note: fieldText(input, 'note')
    };
    if (!next.name) throw new Error('Введите название кормовых насекомых.');
    const initial = amount(input.get('initial'), 0, Number.MAX_SAFE_INTEGER, true);
    await commit(current => {
      const index = current.feeds.findIndex(row => row.id === id);
      if (item && !same(current.feeds[index], item)) throw new Error('Позиция корма изменена в другом окне.');
      if (index >= 0) {
        if (item) current.feeds[index] = next;
        return;
      }
      current.feeds.push(next);
      if (initial) postStock(current, operation(api, 'add', null, { id: operationId, feedId: id, delta: initial,
        note: 'Начальный остаток' }));
    });
    return 'Позиция корма сохранена.';
  });
}

function adjust(api, feed, kind) {
  const { control, showForm, commit } = api;
  const id = api.uid();
  const title = { add: 'Добавить запас', remove: 'Уменьшить количество', dead: 'Списать погибших', correct: 'Исправить остаток' }[kind];
  showForm(title, [
    muted(feed.name), control('count', kind === 'correct' ? 'Фактический остаток, шт.' : 'Количество, шт.', '',
      { ...integer, min: kind === 'correct' ? '0' : '1', required: true }),
    control('note', ru.note, '', { type: 'textarea' })
  ], async input => {
    const count = amount(input.get('count'), kind === 'correct' ? 0 : 1, Number.MAX_SAFE_INTEGER, true);
    if (count === null) throw new Error('Укажите количество.');
    await commit(current => {
      const delta = kind === 'correct' ? count - (stockCounts(current).get(feed.id) || 0) : kind === 'add' ? count : -count;
      if (delta) postStock(current, operation(api, kind, input, { id, feedId: feed.id, delta }));
    });
    return 'Остаток корма обновлён.';
  });
}

function reverse(api, row) {
  const id = api.uid();
  api.showForm('Отменить операцию?', [
    muted('Остаток будет пересчитан. Исходная операция останется в истории.'),
    api.control('note', 'Причина отмены', '', { type: 'textarea' })
  ], async input => {
    await api.commit(current => {
      if (!current.stock.some(item => item.id === id)) undoStock(current, row.id, operation(api, 'undo', input, { id }));
    });
    return 'Операция отменена.';
  }, 'Отменить операцию');
}

export function feedView(data, api, id) {
  const counts = stockCounts(data);
  const title = ru.feeds;
  if (!id) return [
    link('К коллекции', 'pets', 'quiet', 'left'),
    heading(title, 'Запасы кормовых насекомых', button('Добавить корм', () => editFeed(api), 'primary', 'plus')),
    data.feeds.length ? h('div', { class: 'pet-grid' }, data.feeds.map(feed =>
      h('article', { class: 'panel feed-tile' }, h('h2', {}, h('a', { href: '#' + pathFor('feeds', feed.id) }, feed.name)),
        h('strong', { class: 'quantity' }, String(counts.get(feed.id) || 0) + ' шт.'),
        muted([feed.size, feed.location].filter(Boolean).join(' · ')),
        h('div', { class: 'actions' }, link('Открыть запас', pathFor('feeds', feed.id)),
          button('Добавить запас', () => adjust(api, feed, 'add'), 'primary'))))) : empty('Добавьте любую позицию корма для своей коллекции.')
  ];
  const feed = data.feeds.find(item => item.id === id);
  if (!feed) return [link(title, 'feeds', 'quiet', 'left'), empty('Позиция корма недоступна.')];
  const rows = data.stock.filter(row => row.feedId === id);
  const undone = new Set(rows.map(row => row.undoOf).filter(Boolean));
  return [
    link(title, 'feeds', 'quiet', 'left'),
    heading(feed.name, 'Остаток · ' + (counts.get(id) || 0) + ' шт.', button('Изменить', () => editFeed(api, feed))),
    panel('Сведения о запасе', h('div', {},
      h('dl', { class: 'facts' }, detail(fields.size, feed.size || '—'), detail(fields.acquired, displayDate(feed.acquired)),
        detail(fields.price, feed.price !== null ? money(feed.price, feed.currency) : '—'),
        detail(fields.location, feed.location || '—'), detail(ru.note, feed.note || '—')),
      h('div', { class: 'actions' }, button('Добавить запас', () => adjust(api, feed, 'add'), 'primary'),
        button('Уменьшить количество', () => adjust(api, feed, 'remove')),
        button('Списать погибших', () => adjust(api, feed, 'dead')),
        button('Исправить остаток', () => adjust(api, feed, 'correct'))))),
    panel('История изменений запаса', rows.length ? h('ul', { class: 'items' }, rows.reverse().map(row =>
      h('li', {}, h('div', { class: 'item-content' },
        h('strong', {}, labels.stock[row.kind] + ' · ' + (row.delta > 0 ? '+' : '') + row.delta + ' шт.'),
        h('small', {}, [displayDate(row.date), row.time, undone.has(row.id) && 'Отменено'].filter(Boolean).join(' · ')),
        row.note && h('p', {}, row.note),
        row.eventId && link('Дневник кормлений', 'care', 'quiet')),
      !row.undoOf && !undone.has(row.id) && button('Отменить операцию', () => reverse(api, row), 'secondary')))) : empty('Операций пока нет.'))
  ];
}
