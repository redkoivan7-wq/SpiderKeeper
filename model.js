export const lists = ['terraria', 'placements', 'album', 'growth', 'environment', 'maintenance', 'feeds', 'stock'];
export const petDefaults = {
  origin: '', age: '', maturity: '', sizeCm: null, metric: 'legs', confidence: 'unknown',
  behavior: '', archived: false
};
export const terrariumDefaults = {
  name: '', kind: '', length: null, width: null, height: null, substrate: '', depth: null,
  hide: '', water: '', ventilation: '', equipment: '', location: '', started: '', note: '',
  photoId: '', thumbId: '', tempMin: null, tempMax: null, humidityMin: null, humidityMax: null
};
export const same = (left, right) => JSON.stringify(left, sortedKeys) === JSON.stringify(right, sortedKeys);
function sortedKeys(_, value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value;
}

export function migrate(data) {
  if (data.schema === 3) return data;
  for (const key of lists) data[key] ??= [];
  data.pets = data.pets.map(pet => ({ ...petDefaults, ...pet }));
  for (const pet of data.pets) {
    if (pet.photoId && !data.album.some(photo => photo.petId === pet.id && photo.originalId === pet.photoId)) {
      data.album.push({
        id: 'legacy-photo:' + pet.id, petId: pet.id, originalId: pet.photoId,
        thumbId: '', date: '', caption: '', optimized: false
      });
    }
  }
  data.schema = 3;
  return data;
}

export const placed = (data, petId) => {
  let latest;
  for (const item of data.placements) {
    if (item.petId === petId && (!latest || item.at >= latest.at)) latest = item;
  }
  return latest?.toId || '';
};
export function occupancy(data) {
  const latest = new Map();
  for (const item of data.placements) {
    if (!latest.has(item.petId) || item.at >= latest.get(item.petId).at) latest.set(item.petId, item);
  }
  const occupied = new Map();
  for (const pet of data.pets) {
    const id = latest.get(pet.id)?.toId;
    if (pet.archived || !id) continue;
    if (occupied.has(id)) throw new Error('В одном террариуме оказались два активных питомца.');
    occupied.set(id, pet.id);
  }
  return occupied;
}

export function movePet(data, movement) {
  if (data.placements.some(row => row.id === movement.id)) return;
  const pet = data.pets.find(item => item.id === movement.petId);
  if (!pet || pet.archived) throw new Error('Выберите активного питомца.');
  if (movement.toId) {
    if (!data.terraria.some(item => item.id === movement.toId)) throw new Error('Террариум недоступен.');
    const resident = occupancy(data).get(movement.toId);
    if (resident && resident !== pet.id) throw new Error('Этот террариум уже занят.');
  }
  const fromId = placed(data, pet.id);
  if (fromId !== movement.toId) {
    const latestAt = Math.max(0, ...data.placements.filter(item => item.petId === pet.id).map(item => Date.parse(item.at) || 0));
    const at = new Date(Math.max(Date.parse(movement.at), latestAt + 1)).toISOString();
    data.placements.push({ ...movement, fromId, at });
  }
}

export function isDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const value = new Date(date + 'T00:00:00Z');
  return Number.isFinite(+value) && value.toISOString().slice(0, 10) === date;
}
export function daysBetween(from, to) {
  return isDate(from) && isDate(to) ? Math.round((Date.parse(to) - Date.parse(from)) / 86400000) : null;
}
export function amount(value, min = 0, max = Number.MAX_SAFE_INTEGER, whole = false) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || (whole && !Number.isSafeInteger(parsed))) {
    throw new Error('Проверьте числовое значение.');
  }
  return parsed;
}
export function day(value, required = false) {
  const valueText = String(value ?? '');
  if ((required || valueText) && !isDate(valueText)) throw new Error('Укажите корректную дату.');
  return valueText;
}
export function clock(value) {
  if (value && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('Укажите корректное время.');
  return value || '';
}

export function stockCounts(data) {
  const counts = new Map();
  for (const entry of data.stock) counts.set(entry.feedId, (counts.get(entry.feedId) ?? 0) + entry.delta);
  return counts;
}
export function postStock(data, entry) {
  if (data.stock.some(row => row.id === entry.id)) return;
  if (!data.feeds.some(item => item.id === entry.feedId)) throw new Error('Позиция корма недоступна.');
  if (!Number.isSafeInteger(entry.delta) || !entry.delta) throw new Error('Изменение запаса должно быть целым числом.');
  const result = (stockCounts(data).get(entry.feedId) ?? 0) + entry.delta;
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('На складе недостаточно насекомых или превышен диапазон количества.');
  if (entry.eventId && data.stock.some(row => row.eventId === entry.eventId)) {
    throw new Error('Списание для этого кормления уже зарегистрировано.');
  }
  data.stock.push(entry);
}

export function undoStock(data, itemId, entry) {
  const original = data.stock.find(row => row.id === itemId);
  if (!original || original.undoOf || data.stock.some(row => row.undoOf === itemId)) {
    throw new Error('Эта операция уже отменена или недоступна.');
  }
  postStock(data, { ...entry, feedId: original.feedId, delta: -original.delta, kind: 'undo', eventId: '', undoOf: itemId });
}
export const photoKeys = data => new Set([
  ...data.pets.map(pet => pet.photoId),
  ...data.terraria.flatMap(item => [item.photoId, item.thumbId]),
  ...data.album.flatMap(item => [item.originalId, item.thumbId])
].filter(Boolean));

const ID = value => typeof value === 'string' && value.trim() !== '';
const string = value => typeof value === 'string';
const optionalDate = value => value === '' || isDate(value);
const optionalTime = value => value === '' || (string(value) && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value));
const finite = (min, max) => value => value === null || (Number.isFinite(value) && value >= min && value <= max);
const positive = finite(0, Number.MAX_SAFE_INTEGER);
const size = finite(.01, Number.MAX_SAFE_INTEGER);
const temperature = finite(-273.15, Number.MAX_SAFE_INTEGER);
const humidity = finite(0, 100);
const oneOf = (...choices) => value => choices.includes(value);
const metric = oneOf('legs', 'body');
const bool = value => typeof value === 'boolean';
const kind = oneOf('', 'ground', 'tree', 'burrow', 'universal');
const validAt = value => string(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const range = (low, high) => low === null || high === null || low <= high;
const descriptions = Object.fromEntries(['substrate','ventilation','equipment','location','note'].map(field => [field, string]));
const rules = {
  album: { petId: ID, originalId: ID, thumbId: string, date: optionalDate, caption: string, optimized: bool },
  terraria: {
    name: ID, kind, length: size, width: size, height: size, depth: positive, ...descriptions,
    hide: oneOf('', 'yes', 'no'), water: oneOf('', 'yes', 'no'), started: optionalDate, photoId: string, thumbId: string,
    tempMin: temperature, tempMax: temperature, humidityMin: humidity, humidityMax: humidity
  },
  placements: { petId: ID, fromId: string, toId: string, date: isDate, at: validAt, note: string },
  growth: { petId: ID, date: isDate, metric, size: value => value !== null && size(value), note: string },
  environment: { terrariumId: ID, date: isDate, time: optionalTime, temperature, humidity, note: string },
  maintenance: { terrariumId: ID, date: isDate, time: optionalTime, type: ID, note: string },
  feeds: { name: ID, size: string, acquired: optionalDate, price: positive, location: string, note: string,
    currency: value => value === undefined || (string(value) && /^[A-Z]{3}$/.test(value)) },
  stock: { feedId: ID, delta: value => Number.isSafeInteger(value) && value !== 0, eventId: string, undoOf: string,
    kind: oneOf('add', 'remove', 'dead', 'correct', 'feeding', 'undo'), date: isDate, time: optionalTime, note: string }
};

function checkedRows(data, key, spec) {
  const rows = data[key];
  if (!Array.isArray(rows)) throw new Error('В копии отсутствует раздел «' + key + '».');
  const ids = new Map();
  for (const row of rows) {
    if (!row || !ID(row.id) || ids.has(row.id) || Object.entries(spec).some(([field, check]) => !check(row[field]))) {
      throw new Error('Повреждённая или повторяющаяся запись в разделе «' + key + '».');
    }
    ids.set(row.id, row);
  }
  return ids;
}

const petRules = {
  name: ID, archived: bool, sizeCm: size, metric, origin: string, age: string, behavior: string,
  maturity: oneOf('', 'juvenile', 'adult'), confidence: oneOf('unknown', 'tentative', 'confirmed'),
  sex: oneOf('unknown', 'male', 'female'), scientific: string, species: string, stage: string, size: string,
  acquired: string, lastMolt: string, lastFeeding: string, notes: string, photoId: string,
  history: rows => Array.isArray(rows) && rows.every(item => item && string(item.at) &&
    Array.isArray(item.fields) && item.fields.every(string) && (item.values === undefined ||
      (Array.isArray(item.values) && item.values.every(field => field && string(field.label) &&
        string(field.before) && string(field.after)))))
};

export function validate(data, photos) {
  const pets = checkedRows(data, 'pets', petRules);
  const events = checkedRows(data, 'events', { petId: ID, type: ID, date: string, time: string, detail: string, note: string });
  checkedRows(data, 'reminders', { title: ID, date: ID, petId: string, time: string, note: string, done: bool });
  const tables = Object.fromEntries(lists.map(key => [key, checkedRows(data, key, rules[key])]));
  const exists = (table, key) => !key || table.has(key);
  for (const row of [...data.album, ...data.placements, ...data.growth]) {
    if (!pets.has(row.petId)) throw new Error('В копии отсутствует связанная карточка паука.');
  }
  for (const row of data.placements) {
    if (!exists(tables.terraria, row.fromId) || !exists(tables.terraria, row.toId)) {
      throw new Error('В истории переселений отсутствует террариум.');
    }
  }
  for (const row of data.terraria) {
    if (!range(row.tempMin, row.tempMax) || !range(row.humidityMin, row.humidityMax)) {
      throw new Error('Нижняя граница диапазона выше верхней.');
    }
  }
  for (const row of [...data.environment, ...data.maintenance]) {
    if (!tables.terraria.has(row.terrariumId) || (row.temperature === null && row.humidity === null)) {
      throw new Error('Некорректная запись террариума.');
    }
  }
  for (const event of data.events) {
    if (event.molt !== undefined) {
      const row = event.molt;
      if (event.type !== 'Линька' || !row || !metric(row.metric) || !size(row.before) || !size(row.after) ||
          !string(row.condition) || !Array.isArray(row.photoIds) ||
          row.photoIds.some(id => tables.album.get(id)?.petId !== event.petId)) {
        throw new Error('Некорректная запись линьки или ссылка на её фото.');
      }
    }
    if (event.sign !== undefined && !string(event.sign)) throw new Error('Некорректный признак подготовки к линьке.');
  }
  const balances = new Map();
  const seenStock = new Map();
  const undone = new Set();
  const debits = new Set();
  for (const row of data.stock) {
    if ((row.kind === 'feeding') !== Boolean(row.eventId) || (row.kind === 'undo') !== Boolean(row.undoOf) ||
        (row.kind === 'add' && row.delta < 0) || (['remove', 'dead'].includes(row.kind) && row.delta > 0)) {
      throw new Error('В копии обнаружена некорректная операция с кормом.');
    }
    if (!tables.feeds.has(row.feedId) || (row.eventId && (events.get(row.eventId)?.type !== 'Кормление' ||
        row.kind !== 'feeding' || row.delta >= 0))) throw new Error('Некорректная связь учёта кормов.');
    if (row.eventId) {
      const key = JSON.stringify([row.feedId, row.eventId]);
      if (debits.has(key)) throw new Error('Найдено повторное списание корма.');
      debits.add(key);
    }
    if (row.undoOf) {
      const source = seenStock.get(row.undoOf);
      if (!source || source.undoOf || row.kind !== 'undo' || source.feedId !== row.feedId ||
          source.delta !== -row.delta || undone.has(row.undoOf)) throw new Error('Некорректная отмена операции с кормом.');
      undone.add(row.undoOf);
    }
    const balance = (balances.get(row.feedId) ?? 0) + row.delta;
    if (!Number.isSafeInteger(balance) || balance < 0) throw new Error('В копии обнаружен некорректный остаток корма.');
    balances.set(row.feedId, balance);
    seenStock.set(row.id, row);
  }
  occupancy(data);
  if (photos && [...photoKeys(data)].some(key => !photos.has(key))) {
    throw new Error('В копии отсутствует файл фотографии.');
  }
}

function merge(existing, incoming, project = row => row, compatible = () => true) {
  const used = new Map(existing.map(row => [row.id, row]));
  const ids = new Map();
  for (const original of incoming) {
    const row = project({ ...original });
    for (let index = 0; ; index++) {
      row.id = index ? original.id + ':import:' + index : original.id;
      const previous = used.get(row.id);
      if (previous && (!same(previous, row) || !compatible(previous, original))) continue;
      if (!previous) {
        existing.push(row);
        used.set(row.id, row);
      }
      ids.set(original.id, row.id);
      break;
    }
  }
  return ids;
}
const remap = (ids, key) => ids.get(key) ?? key;

export function mergeCollections(current, incoming, files) {
  const byPhoto = (row, keys) => {
    for (const key of keys) row[key] = remap(files, row[key]);
    return row;
  };
  const existingOwners = occupancy(current);
  const incomingOwners = occupancy(incoming);
  const pets = merge(current.pets, incoming.pets, row => byPhoto(row, ['photoId']));
  const applyPet = row => ({ ...row, petId: remap(pets, row.petId) });
  const terraria = merge(current.terraria, incoming.terraria, row => byPhoto(row, ['photoId', 'thumbId']),
    (previous, source) => {
      const assigned = incomingOwners.get(source.id);
      const occupant = existingOwners.get(previous.id);
      return !assigned || !occupant || remap(pets, assigned) === occupant;
    });
  const album = merge(current.album, incoming.album,
    row => byPhoto(applyPet(row), ['originalId', 'thumbId']));
  const events = merge(current.events, incoming.events, row => {
    if (row.molt) row.molt = { ...row.molt, photoIds: row.molt.photoIds.map(id => remap(album, id)) };
    return applyPet(row);
  });
  merge(current.reminders, incoming.reminders, applyPet);
  merge(current.growth, incoming.growth, applyPet);
  merge(current.placements, incoming.placements, row => ({
    ...applyPet(row), fromId: remap(terraria, row.fromId), toId: remap(terraria, row.toId)
  }));
  for (const key of ['environment', 'maintenance']) {
    merge(current[key], incoming[key], row => ({ ...row, terrariumId: remap(terraria, row.terrariumId) }));
  }
  const feeds = merge(current.feeds, incoming.feeds, undefined, (previous, source) => {
    const saved = current.stock.filter(row => row.feedId === previous.id);
    const received = incoming.stock.filter(row => row.feedId === source.id);
    const matched = new Map();
    let prefix = true;
    received.forEach((original, index) => {
      const expected = { ...original, feedId: previous.id, eventId: remap(events, original.eventId),
        undoOf: remap(matched, original.undoOf) };
      const found = saved.find(row => (row.id === original.id || row.id.startsWith(original.id + ':lot:' + previous.id)) &&
        same(row, { ...expected, id: row.id }));
      if (found) matched.set(original.id, found.id);
      if (index < saved.length && (!found || saved[index].id !== found.id)) prefix = false;
    });
    if (prefix && received.length >= saved.length) return true;
    if (matched.size === received.length) return true;
    return false;
  });
  const usedStock = new Map(current.stock.map(row => [row.id, row]));
  const stockIds = new Map();
  for (const original of incoming.stock) {
    const feedId = remap(feeds, original.feedId);
    const standard = usedStock.get(original.id);
    const row = { ...original, feedId, eventId: remap(events, original.eventId), undoOf: remap(stockIds, original.undoOf) };
    if ((standard && !same(standard, row)) || feedId !== original.feedId) row.id += ':lot:' + feedId;
    for (let index = 1; usedStock.has(row.id) && !same(usedStock.get(row.id), row); index++) {
      row.id = original.id + ':lot:' + feedId + ':' + index;
    }
    stockIds.set(original.id, row.id);
    if (!usedStock.has(row.id)) {
      usedStock.set(row.id, row);
      current.stock.push(row);
    }
  }
}
