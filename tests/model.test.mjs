import assert from 'node:assert/strict';
import test from 'node:test';
import { daysBetween, mergeCollections, migrate, movePet, occupancy, postStock, stockCounts, terrariumDefaults,
  undoStock, validate } from '../model.js';
import { normalize, parseBackup } from '../storage.js';

const date = '2026-11-21';
const at = date + 'T08:00:00.000Z';
const baseline = () => migrate(normalize({
  pets: [{ id: 1, name: 'Паук', species: 'Описание из старого дневника' }],
  events: [{ petId: 1, type: 'Линька', date, note: 'Старая линька' }]
}));
const feed = { id: 'lot', name: 'Сверчки', size: '', acquired: '', price: null, currency: 'RUB', location: '', note: '' };
const event = { id: 'feeding', petId: '1', type: 'Кормление', date, time: '08:00', detail: 'Сверчки', note: '' };
const movement = { id: 'm1', petId: '1', fromId: '', toId: 't1', date, at, note: '' };
const terrarium = { ...terrariumDefaults, id: 't1', name: 'Первый террариум' };
const entry = { id: 'init', feedId: 'lot', kind: 'add', delta: 9, date, time: '', note: '', eventId: '', undoOf: '' };
const spend = { ...entry, id: 'spend', kind: 'feeding', delta: -3, eventId: 'feeding' };

test('v2 copy and persisted schema migrate without inventing fields', () => {
  const box = {
    format: 'spiderkeeper', version: 2, record: 30,
    pets: [{ id: 'p', name: 'Исходный паук', species: 'Не определён', photoId: 'old-photo' }],
    events: [{ id: 'e', petId: 'p', type: 'Линька', date, note: 'Исходная запись' }],
    reminders: [], photos: [['old-photo', 'data:image/png;base64,iVBORw0KGgo=']]
  };
  const migrated = parseBackup(JSON.stringify(box));
  assert.equal(migrated.data.schema, 3);
  assert.equal(migrated.record, 30);
  assert.equal(migrated.data.pets[0].species, 'Не определён');
  assert.equal(migrated.data.pets[0].confidence, 'unknown');
  assert.equal(migrated.data.album[0].originalId, 'old-photo');
  assert.equal(migrated.data.album[0].date, '');
  assert.equal(migrated.data.events[0].note, 'Исходная запись');
  assert.equal(migrated.data.events[0].time, '');
  assert.equal(migrate(migrated.data), migrated.data);
  const old = { ...migrated.data, schema: undefined, album: undefined, customSettings: { kept: true } };
  assert.equal(migrate(old).customSettings.kept, true);
});

test('one current occupant and retained movement history', () => {
  const data = baseline();
  data.pets.push({ ...data.pets[0], id: '2' });
  data.terraria.push(terrarium, { ...terrarium, id: 't2' });
  movePet(data, movement);
  assert.throws(() => movePet(data, { ...movement, id: 'm2', petId: '2' }), /уже занят/);
  movePet(data, { ...movement, id: 'm3', toId: 't2' });
  assert.equal(data.placements[1].fromId, 't1');
  assert.equal(occupancy(data).get('t2'), '1');
  assert(!occupancy(data).has('t1'));
  validate(data);
});

test('ledger is idempotent and can undo a debit once', () => {
  const data = baseline();
  data.events.push(event);
  data.feeds.push(feed);
  postStock(data, entry);
  postStock(data, spend);
  postStock(data, spend);
  assert.equal(stockCounts(data).get(feed.id), 6);
  assert.throws(() => postStock(data, { ...spend, id: 'again' }), /уже зарегистрировано/);
  assert.throws(() => postStock(data, { ...entry, kind: 'dead', id: 'dead', delta: -7 }), /недостаточно/);
  undoStock(data, spend.id, { ...entry, id: 'undo' });
  assert.equal(stockCounts(data).get(feed.id), 9);
  assert.throws(() => undoStock(data, spend.id, { ...entry, id: 'again' }), /уже отменена/);
  validate(data);
});

test('merge conflicts preserve album–molt, placement, measurement and food references', () => {
  const make = (name, value, debit) => {
    const data = baseline();
    data.pets[0].name = name;
    data.pets[0].photoId = 'image';
    data.terraria.push(structuredClone(terrarium));
    data.placements.push(structuredClone(movement));
    data.environment.push({ id: 'env', terrariumId: 't1', date, time: '08:00', temperature: value, humidity: null, note: '' });
    data.album.push({ id: 'album', petId: '1', originalId: 'image', thumbId: '', date, caption: name, optimized: false });
    data.events[0].molt = { metric: 'legs', before: 3, after: 4, condition: name, photoIds: ['album'] };
    data.events.push({ ...event, note: name });
    data.feeds.push(structuredClone(feed));
    data.stock.push(structuredClone(entry), { ...spend, delta: debit });
    validate(data);
    return data;
  };
  const local = make('Первый', 22, -3);
  const copy = make('Другой', 25, -5);
  mergeCollections(local, copy, new Map([['image', 'image2']]));
  validate(local);
  assert.equal(local.pets.length, 2);
  assert.equal(local.terraria.length, 2);
  assert.equal(local.feeds.length, 2);
  assert.equal(local.environment[1].terrariumId, local.terraria[1].id);
  assert.equal(occupancy(local).get(local.terraria[1].id), local.pets[1].id);
  assert.equal(local.events.find(item => item.petId === local.pets[1].id && item.molt).molt.photoIds[0], local.album[1].id);
  assert.equal(local.stock.at(-1).eventId, local.events.at(-1).id);
  assert.equal(stockCounts(local).get(local.feeds[1].id), 4);
  const before = structuredClone(local);
  mergeCollections(local, copy, new Map([['image', 'image2']]));
  assert.deepEqual(local, before);
});

test('date differences and malformed v3 references', () => {
  assert.equal(daysBetween('2024-02-28', '2024-03-01'), 2);
  assert.equal(daysBetween('2026-02-31', date), null);
  const data = baseline();
  data.album.push({ id: 'photo', petId: 'missing', originalId: 'file', thumbId: '', date: '', caption: '', optimized: false });
  assert.throws(() => parseBackup(JSON.stringify({ format: 'spiderkeeper', version: 3, ...data, photos: [] })), /связанная карточка/);
  assert.throws(() => parseBackup('{'), SyntaxError);
});
