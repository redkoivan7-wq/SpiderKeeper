export const LEGACY_KEY = 'spiderkeeper_v1';
export const BACKUP_FORMAT = 'spiderkeeper';
export const SCHEMA = 2;
export const MAX_PHOTO = 20 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/heic', 'image/heif']);
const DEFAULTS = { motion: true };
export const uid = () => crypto.randomUUID();
const field = value => String(value ?? '');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = value => (typeof value === 'string' && value.trim() !== '') || Number.isFinite(value);

export function normalize(raw, modern = false) {
  if (!object(raw) || !Array.isArray(raw.pets) ||
      (raw.events !== undefined && !Array.isArray(raw.events)) ||
      (modern && (!Array.isArray(raw.events) || !Array.isArray(raw.reminders)))) {
    throw new Error('В файле отсутствуют списки питомцев или событий.');
  }
  const occurrences = new Map();
  const pets = raw.pets.map(pet => {
    if (!object(pet) || !validId(pet.id) || typeof pet.name !== 'string' || !pet.name.trim()) {
      throw new Error('Встречена карточка без имени или идентификатора.');
    }
    const history = modern && Array.isArray(pet.history) ? pet.history.map(change => {
      if (!object(change) || !Array.isArray(change.fields)) throw new Error('Некорректная история карточки.');
      const historyEntry = { at: field(change.at), fields: change.fields.map(field) };
      if (Array.isArray(change.values)) {
        historyEntry.values = change.values.filter(object).map(value => ({
          label: field(value.label), before: field(value.before), after: field(value.after)
        }));
      }
      return historyEntry;
    }) : [];
    return {
      id: String(pet.id), name: pet.name, scientific: field(pet.scientific),
      species: field(pet.species), sex: ['male', 'female'].includes(pet.sex) ? pet.sex : 'unknown',
      stage: field(pet.stage), acquired: field(pet.acquired), size: field(pet.size),
      lastMolt: field(pet.lastMolt), lastFeeding: field(pet.lastFeeding), notes: field(pet.notes),
      photoId: modern ? field(pet.photoId) : '', history
    };
  });
  const events = (raw.events || []).map(event => {
    if (!object(event) || !validId(event.petId) || typeof event.type !== 'string' || !event.type ||
        typeof event.date !== 'string' || (modern && !validId(event.id))) {
      throw new Error('Встречено событие без питомца, типа, даты или идентификатора.');
    }
    const record = {
      petId: String(event.petId), type: event.type, date: event.date,
      time: field(event.time), detail: field(event.detail), note: field(event.note)
    };
    if (modern) return { id: String(event.id), ...record };
    const signature = JSON.stringify(record);
    const count = (occurrences.get(signature) || 0) + 1;
    occurrences.set(signature, count);
    return { id: 'legacy:' + signature + ':' + count, ...record };
  });
  const reminders = modern ? raw.reminders.map(reminder => {
    if (!object(reminder) || !validId(reminder.id) || typeof reminder.title !== 'string' ||
        !reminder.title.trim() || typeof reminder.date !== 'string' || !reminder.date) {
      throw new Error('Встречено напоминание без названия, даты или идентификатора.');
    }
    return {
      id: String(reminder.id), petId: field(reminder.petId), title: reminder.title,
      date: reminder.date, time: field(reminder.time), note: field(reminder.note), done: reminder.done === true
    };
  }) : [];
  for (const list of [pets, events, reminders]) {
    if (new Set(list.map(item => item.id)).size !== list.length) {
      throw new Error('Повторяются идентификаторы записей.');
    }
  }
  return { pets, events, reminders, settings: { ...DEFAULTS, motion: raw.settings?.motion !== false } };
}

export function readLegacy() {
  const saved = localStorage.getItem(LEGACY_KEY);
  return saved === null ? normalize({ pets: [], events: [] }) : normalize(JSON.parse(saved));
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('spiderkeeper', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('journal');
      request.result.createObjectStore('photos');
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Закройте другие окна SpiderKeeper и обновите страницу.'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

function transaction(db, mode, action) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['journal', 'photos'], mode);
    const journal = tx.objectStore('journal');
    const photos = tx.objectStore('photos');
    let result;
    let cause;
    const run = fn => {
      try { return fn(); }
      catch (error) {
        cause = error;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(cause || tx.error || new Error('Операция с данными прервана.'));
    run(() => action(journal, photos, value => { result = value; }, run));
  });
}

export async function openJournal() {
  const db = await openDatabase();
  const change = mutate => transaction(db, 'readwrite', (journal, photos, result, run) => {
    const request = journal.get('data');
    request.onsuccess = () => run(() => {
      const data = request.result || readLegacy();
      mutate?.(data, photos);
      journal.put(data, 'data');
      result(data);
    });
  });
  try {
    await change();
  } catch (error) {
    db.close();
    throw error;
  }
  return {
    change,
    async snapshot() {
      return transaction(db, 'readonly', (journal, photos, result, run) => {
        const data = journal.get('data');
        const keys = photos.getAllKeys();
        const blobs = photos.getAll();
        blobs.onsuccess = () => run(() => result({
          data: data.result, photos: new Map(keys.result.map((key, index) => [key, blobs.result[index]]))
        }));
      });
    }
  };
}

export function validatePhoto(blob) {
  if (!IMAGE_TYPES.has(blob.type) || !blob.size || blob.size > MAX_PHOTO) {
    throw new Error('Выберите фото JPG, PNG, WebP, GIF, AVIF или HEIC размером до 20 МБ.');
  }
}

export async function photoKey(blob) {
  validatePhoto(blob);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  return blob.type + ':' + [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function toDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function createBackup(snapshot, record) {
  const photos = await Promise.all([...snapshot.photos].map(async ([id, blob]) => [id, await toDataURL(blob)]));
  return JSON.stringify({
    format: BACKUP_FORMAT, version: SCHEMA, exportedAt: new Date().toISOString(),
    ...snapshot.data, photos, record
  }, null, 2);
}

export function parseBackup(text) {
  const raw = JSON.parse(text);
  if (!object(raw)) throw new Error('Некорректный файл резервной копии.');
  const modern = Object.hasOwn(raw, 'format');
  if (modern && (raw.format !== BACKUP_FORMAT || raw.version !== SCHEMA || !Array.isArray(raw.photos))) {
    throw new Error('Эта версия резервной копии не поддерживается.');
  }
  const data = normalize(raw, modern);
  const photos = new Map();
  for (const pair of modern ? raw.photos : []) {
    if (!Array.isArray(pair) || pair.length !== 2 || !validId(pair[0]) || typeof pair[1] !== 'string') {
      throw new Error('Некорректная запись фотографии.');
    }
    const [id, content] = pair;
    const match = /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(content);
    if (!match || photos.has(String(id)) || match[2].length > Math.ceil(MAX_PHOTO / 3) * 4) {
      throw new Error('Повреждённая или слишком большая фотография в копии.');
    }
    const bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0));
    const blob = new Blob([bytes], { type: match[1] });
    validatePhoto(blob);
    photos.set(String(id), blob);
  }
  if (data.pets.some(pet => pet.photoId && !photos.has(pet.photoId))) {
    throw new Error('В копии отсутствует фотография одной из карточек.');
  }
  return {
    data, photos, modern,
    record: modern && Number.isSafeInteger(raw.record) && raw.record >= 0 ? raw.record : 0
  };
}

function mergeRows(existing, incoming, transform = item => item) {
  const used = new Map(existing.map(item => [item.id, item]));
  const remap = new Map();
  for (const source of incoming) {
    const item = transform({ ...source });
    for (let index = 0; ; index++) {
      const id = index ? source.id + ':import:' + index : source.id;
      item.id = id;
      const previous = used.get(id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(item)) continue;
      if (!previous) {
        existing.push(item);
        used.set(id, item);
      }
      remap.set(source.id, id);
      break;
    }
  }
  return remap;
}

export function mergeBackup(current, incoming, photoIds) {
  const petIds = mergeRows(current.pets, incoming.pets, pet => {
    if (pet.photoId) pet.photoId = photoIds.get(pet.photoId);
    return pet;
  });
  const remapPet = item => ({ ...item, petId: petIds.get(item.petId) ?? item.petId });
  mergeRows(current.events, incoming.events, remapPet);
  mergeRows(current.reminders, incoming.reminders, remapPet);
}

export async function storeBackup(journal, backup) {
  const keys = new Map(await Promise.all([...backup.photos].map(async ([id, blob]) => [id, await photoKey(blob)])));
  return journal.change((current, photoStore) => {
    mergeBackup(current, backup.data, keys);
    if (backup.modern) current.settings = backup.data.settings;
    for (const pet of backup.data.pets) {
      if (pet.photoId) photoStore.put(backup.photos.get(pet.photoId), keys.get(pet.photoId));
    }
  });
}
