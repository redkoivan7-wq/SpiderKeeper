import { migrate, mergeCollections, photoKeys, validate } from './model.js';
export const LEGACY_KEY = 'spiderkeeper_v1';
export const BACKUP_FORMAT = 'spiderkeeper';
export const SCHEMA = 3;
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
  return migrate(saved === null ? normalize({ pets: [], events: [] }) : normalize(JSON.parse(saved)));
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) throw new Error('В этом браузере IndexedDB недоступна.');
    const request = indexedDB.open('spiderkeeper', 2);
    let blocked = false;
    let upgradeError;
    request.onupgradeneeded = event => {
      const db = request.result;
      if (event.oldVersion === 0) {
        db.createObjectStore('journal');
        db.createObjectStore('photos');
      }
      const journal = request.transaction.objectStore('journal');
      const saved = journal.get('data');
      saved.onsuccess = () => {
        if (!saved.result) return;
        try { journal.put(migrate(saved.result), 'data'); }
        catch (error) {
          upgradeError = error;
          request.transaction.abort();
        }
      };
    };
    request.onerror = () => reject(upgradeError || request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Закройте другие окна SpiderKeeper и обновите страницу.'));
    };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) return db.close();
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
      const data = request.result ? migrate(request.result) : readLegacy();
      if (mutate) {
        mutate(data, photos);
        validate(data);
      }
      if (mutate || request.result?.schema !== SCHEMA) journal.put(data, 'data');
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
    read() {
      return transaction(db, 'readonly', (journal, _photos, result) => {
        const request = journal.get('data');
        request.onsuccess = () => result(request.result);
      });
    },
    file(key) {
      return transaction(db, 'readonly', (_journal, photos, result) => {
        const request = photos.get(key);
        request.onsuccess = () => result(request.result);
      });
    },
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

export async function decodePhoto(blob, probeOnly = false) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, probeOnly ? { resizeWidth: 2, resizeHeight: 2 } : {});
    } catch { /* Safari may support a format only in img. */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally { URL.revokeObjectURL(url); }
}

export async function inspectPhoto(blob) {
  validatePhoto(blob);
  const bytes = new Uint8Array(await blob.slice(0, 40).arrayBuffer());
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  const signature = {
    'image/jpeg': () => bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
    'image/png': () => [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte),
    'image/gif': () => /^GIF8[79]a$/.test(ascii(0, 6)),
    'image/webp': () => ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP',
    'image/avif': () => ascii(4, 8) === 'ftyp' && /avif|avis/.test(ascii(8, 40)),
    'image/heic': () => ascii(4, 8) === 'ftyp' && /heic|heix|hevc|hevx|mif1|msf1/.test(ascii(8, 40)),
    'image/heif': () => ascii(4, 8) === 'ftyp' && /heic|heix|hevc|hevx|mif1|msf1/.test(ascii(8, 40))
  };
  if (!signature[blob.type]()) throw new Error('Содержимое файла не соответствует формату изображения.');
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
  const photos = [];
  for (const id of photoKeys(snapshot.data)) {
    const blob = snapshot.photos.get(id);
    if (!blob) throw new Error('Не удалось прочитать все фотографии коллекции.');
    photos.push([id, await toDataURL(blob)]);
  }
  return JSON.stringify({
    format: BACKUP_FORMAT, version: SCHEMA, exportedAt: new Date().toISOString(),
    ...snapshot.data, photos, record: Math.max(record, snapshot.data.gameRecord || 0)
  }, null, 2);
}

export function parseBackup(text) {
  const raw = JSON.parse(text);
  if (!object(raw)) throw new Error('Некорректный файл резервной копии.');
  const modern = Object.hasOwn(raw, 'format');
  if (modern && (raw.format !== BACKUP_FORMAT || ![2, SCHEMA].includes(raw.version) || !Array.isArray(raw.photos))) {
    throw new Error('Эта версия резервной копии не поддерживается.');
  }
  const current = modern && raw.version === SCHEMA;
  const { photos: _files, format: _name, version: _version, exportedAt: _exported, record: _record, ...content } = raw;
  const data = current ? { ...content, schema: SCHEMA } : migrate(normalize(raw, modern));
  if (current && (!object(data.settings) || (data.settings.motion !== undefined && typeof data.settings.motion !== 'boolean') ||
      (data.gameRecord !== undefined && (!Number.isSafeInteger(data.gameRecord) || data.gameRecord < 0)))) {
    throw new Error('Повреждены настройки или рекорд.');
  }
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
  validate(data, photos);
  return {
    data, photos, modern,
    record: modern && Number.isSafeInteger(raw.record) && raw.record >= 0 ? raw.record : 0
  };
}

export async function storeBackup(journal, backup) {
  const keys = new Map();
  for (const [id, blob] of backup.photos) {
    await inspectPhoto(blob);
    if (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(blob.type)) {
      try { (await decodePhoto(blob, true)).close?.(); }
      catch { throw new Error('В копии есть повреждённое изображение.'); }
    }
    keys.set(id, await photoKey(blob));
  }
  return journal.change((current, photoStore) => {
    mergeCollections(current, backup.data, keys);
    if (backup.modern) current.settings = { ...current.settings, ...backup.data.settings };
    current.gameRecord = Math.max(current.gameRecord || 0, backup.record, backup.data.gameRecord || 0);
    const referenced = photoKeys(current);
    for (const [id, blob] of backup.photos) {
      if (referenced.has(keys.get(id))) photoStore.put(blob, keys.get(id));
    }
  });
}
