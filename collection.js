import { button, catalogView, displayDate, displayStamp, empty, eventList, h, heading, lastEvent, link, localStamp, muted, panel, recent } from './ui.js';
import { amount, day, isDate, movePet, petDefaults, placed, same } from './model.js';
import { enlarge, photoOptions, preparePhoto, releaseMedia, storeMedia } from './media.js';
import { labels, petFields, ru } from './strings.js';

export const pathFor = (area, id, page) => area + '/' + encodeURIComponent(id) + (page ? '/' + page : '');
export const fieldText = (values, key) => String(values.get(key) ?? '').trim();
export const cm = value => value === null || value === undefined ? '—' : new Intl.NumberFormat('ru', { maximumFractionDigits: 3 }).format(value) + ' см';
export const choice = (title, items, selected, change) => {
  const node = h('select', { 'aria-label': title }, items.map(([id, label]) => h('option', { value: id, selected: id === selected }, label)));
  node.addEventListener('change', () => change(node.value));
  return node;
};
export const detail = (title, value) => h('div', {}, h('dt', {}, title), h('dd', {}, value ?? '—'));
const dateLabel = date => date ? displayDate(date) : 'Дата неизвестна';
const photosFor = (data, id) => [...data.album].filter(item => item.petId === id).sort((a, b) => b.date.localeCompare(a.date));
const petPhoto = (data, pet) => data.album.find(item => item.petId === pet.id && item.originalId === pet.photoId);
const matchesText = (value, query) => String(value ?? '').toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'));
const nameOrder = (a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true });

export function collectionView(data, api, filters) {
  const results = h('div', { class: 'collection-results' });
  const state = h('p', { class: 'muted', role: 'status' });
  const search = h('input', { type: 'search', 'aria-label': 'Поиск по имени и виду', placeholder: 'Имя или вид', value: filters.query });
  const select = (name, attr, options) => choice(name, options, filters[attr], value => { filters[attr] = value; update(); });
  const scientific = [...new Set(data.pets.map(pet => pet.scientific).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const controls = h('div', { class: 'collection-filters' }, search,
    select('Пол', 'sex', [['', 'Любой пол'], ...Object.entries(labels.sex)]),
    select('Возрастная группа', 'maturity', [['', 'Любой возраст'], ['juvenile', 'Молодые'], ['adult', 'Взрослые']]),
    select('Научное название', 'species', [['', 'Все виды'], ...scientific.map(type => [type, type])]),
    select('Активные или архивные', 'availability', [['active', ru.active], ['archive', ru.archive], ['all', 'Все питомцы']]),
    select('Сортировка', 'order', [['name', 'По имени'], ['acquired', 'По приобретению'], ['molt', 'По последней линьке']]),
    select('Вид списка', 'mode', [['cards', 'Крупные карточки'], ['rows', 'Компактный список']]));
  search.addEventListener('input', () => { filters.query = search.value; update(); });
  let scope;
  function update() {
    scope?.dispose();
    scope = api.newMediaScope();
    const compare = filters.order === 'name' ? nameOrder : (a, b) => {
      const field = pet => filters.order === 'acquired' ? pet.acquired : lastEvent(data, pet, ru.molt)?.date || '';
      return field(b).localeCompare(field(a)) || nameOrder(a, b);
    };
    const filtered = data.pets.filter(pet => (
      (filters.availability === 'all' || pet.archived === (filters.availability === 'archive')) &&
      (!filters.query || [pet.name, pet.scientific, pet.species].some(value => matchesText(value, filters.query))) &&
      (!filters.sex || pet.sex === filters.sex) && (!filters.maturity || pet.maturity === filters.maturity) &&
      (!filters.species || pet.scientific === filters.species)
    )).sort(compare);
    state.textContent = 'Питомцев в списке: ' + filtered.length;
    results.classList.toggle('compact', filters.mode === 'rows');
    results.replaceChildren(...(filtered.length ? filtered.map(pet => {
      const photo = petPhoto(data, pet);
      const terrarium = data.terraria.find(item => item.id === placed(data, pet.id));
      return h('article', { class: 'pet-card collection-card' },
        h('div', { class: 'pet-art' }, scope.picture(photo?.thumbId || pet.photoId, 'Фото питомца ' + pet.name)),
        h('div', { class: 'pet-body' },
          h('h2', {}, h('a', { href: '#' + pathFor('pets', pet.id) }, pet.name)),
          pet.scientific && h('p', { class: 'scientific' }, h('i', {}, pet.scientific)),
          h('div', { class: 'tags' }, [labels.sex[pet.sex], pet.stage || labels.maturity[pet.maturity],
            pet.sizeCm !== null ? cm(pet.sizeCm) : pet.size, pet.archived && ru.archive].filter(Boolean).map(tag => h('span', {}, tag))),
          h('dl', { class: 'pet-details' }, detail(ru.molt, displayDate(lastEvent(data, pet, ru.molt)?.date)),
            detail(ru.feeding, displayDate(lastEvent(data, pet, ru.feeding)?.date)),
            detail('Террариум', terrarium?.name || '—')),
          h('div', { class: 'actions' }, link('Паспорт', pathFor('pets', pet.id), 'primary'),
            link('Дневник', pathFor('care', pet.id)), button('Изменить', () => editPet(api, pet)))
        ));
    }) : [empty(data.pets.length ? 'По вашим условиям питомцев нет.' : 'Добавьте первого питомца в коллекцию.')]));
  }
  update();
  return [
    heading(ru.collection, 'Карточки пауков и история содержания', button('Добавить паука', () => editPet(api), 'primary', 'plus')),
    h('div', { class: 'actions' }, link(ru.terraria, 'terraria'), link(ru.feeds, 'feeds'), link(ru.analytics, 'analytics')),
    h('section', { class: 'panel' }, controls, state), results, catalogView()
  ];
}

export function editPet(api, pet) {
  const { control, showForm, commit } = api;
  const c = (key, options = {}) => control(key, petFields[key], pet?.[key] ?? petDefaults[key] ?? '', options);
  const fields = [
    c('name', { required: true }), c('scientific'), c('species'),
    c('confidence', { choices: Object.entries(labels.confidence) }), c('origin'),
    c('sex', { choices: Object.entries(labels.sex) }), c('age'),
    c('maturity', { choices: Object.entries(labels.maturity) }), c('stage'),
    c('sizeCm', { type: 'number', min: '0.01', step: 'any' }), c('metric', { choices: Object.entries(labels.metric) }),
    pet?.size && c('size'),
    ...['acquired', 'lastMolt', 'lastFeeding'].map(key => c(key, { type: 'date' })),
    c('behavior', { type: 'textarea' }), c('notes', { type: 'textarea' }), ...photoOptions(control, 'Основное фото')
  ].filter(Boolean);
  const id = pet?.id || api.uid();
  const albumId = api.uid();
  showForm(pet ? 'Изменить карточку' : 'Добавить паука', fields, async input => {
    const values = {};
    for (const key of Object.keys(petFields)) {
      if (key !== 'photoId') values[key] = fieldText(input, key);
    }
    for (const key of ['acquired', 'lastMolt', 'lastFeeding']) {
      if (!values[key] && pet?.[key] && !isDate(pet[key])) values[key] = pet[key];
      else day(values[key]);
    }
    values.sizeCm = amount(input.get('sizeCm'), .01);
    if (!values.name) throw new Error('Введите имя паука.');
    const media = await preparePhoto(input.get('photo'), input.get('encoding') === 'optimized');
    await commit((current, photoStore) => {
      const index = current.pets.findIndex(item => item.id === id);
      if (pet && !same(current.pets[index], pet)) throw new Error('Карточка изменилась в другом окне. Откройте её заново.');
      if (!pet && index >= 0) return;
      const next = { ...petDefaults, ...pet, id, ...values, photoId: media?.originalId || pet?.photoId || '', history: pet?.history || [] };
      const changes = pet ? Object.keys(petFields).filter(key => next[key] !== pet[key]) : [];
      if (!pet || changes.length) {
        next.history = [...next.history, {
          at: new Date().toISOString(), fields: pet ? changes.map(key => petFields[key]) : ['Карточка создана'],
          ...(pet ? { values: changes.filter(key => key !== 'photoId').map(key => ({
            label: petFields[key], before: String(pet[key] ?? '—'), after: String(next[key] ?? '—')
          })) } : {})
        }];
      }
      if (index >= 0) current.pets[index] = next;
      else current.pets.push(next);
      if (media) {
        storeMedia(photoStore, media);
        current.album.push(albumRow(albumId, id, media, '', ''));
      }
    });
    return media?.warning || (pet ? 'Карточка обновлена.' : 'Паук добавлен.');
  });
}

export function albumRow(id, petId, media, date, caption) {
  return { id, petId, originalId: media.originalId, thumbId: media.thumbId, date, caption, optimized: media.optimized };
}
function editPhoto(api, pet, item) {
  const { control, showForm, commit } = api;
  const id = item?.id || api.uid();
  showForm(item ? 'Подпись и дата снимка' : 'Добавить фото', [
    ...(!item ? photoOptions(control, 'Фото питомца') : []),
    control('date', 'Дата фотографии', item?.date || '', { type: 'date' }),
    control('caption', 'Подпись', item?.caption || '', { type: 'textarea' })
  ], async input => {
    const date = day(input.get('date'));
    const caption = fieldText(input, 'caption');
    const media = !item && await preparePhoto(input.get('photo'), input.get('encoding') === 'optimized');
    if (!item && !media) throw new Error('Выберите фото.');
    await commit((current, photos) => {
      const owner = current.pets.find(candidate => candidate.id === pet.id);
      if (!owner) throw new Error('Карточка питомца недоступна.');
      if (item) {
        const saved = current.album.find(photo => photo.id === item.id);
        if (!same(saved, item)) throw new Error('Снимок изменён в другом окне.');
        Object.assign(saved, { date, caption });
      } else {
        if (current.album.some(photo => photo.id === id)) return;
        current.album.push(albumRow(id, pet.id, media, date, caption));
        storeMedia(photos, media);
        if (!owner.photoId) owner.photoId = media.originalId;
      }
    });
    return media?.warning || 'Фотоальбом обновлён.';
  });
}
function removePhoto(api, item) {
  api.showForm('Удалить фотографию?', [muted('Снимок исчезнет из фотоальбома. Если он прикреплён к линьке, сначала уберите его из этой записи.')],
    async () => {
      await api.commit((current, photos) => {
        if (current.events.some(event => event.molt?.photoIds.includes(item.id))) {
          throw new Error('Снимок используется в истории линьки.');
        }
        const index = current.album.findIndex(photo => photo.id === item.id);
        if (index < 0) return;
        const [deleted] = current.album.splice(index, 1);
        const owner = current.pets.find(pet => pet.id === deleted.petId);
        if (owner?.photoId === deleted.originalId) owner.photoId = photosFor(current, owner.id)[0]?.originalId || '';
        releaseMedia(current, photos, [deleted.originalId, deleted.thumbId]);
      });
      return 'Снимок удалён.';
    }, 'Удалить фото');
}
function chooseCover(api, item) {
  api.write(current => {
    if (!current.album.some(photo => photo.id === item.id)) throw new Error('Фото уже удалено.');
    const pet = current.pets.find(pet => pet.id === item.petId);
    if (!pet) throw new Error('Карточка недоступна.');
    if (pet.photoId === item.originalId) return;
    pet.photoId = item.originalId;
    pet.history.push({ at: new Date().toISOString(), fields: ['Основное фото изменено'] });
  }, 'Основное фото изменено.');
}

function archive(api, pet) {
  const archived = !pet.archived;
  api.showForm(archived ? 'Архивировать карточку?' : 'Вернуть карточку?', [
    muted(archived ? 'История сохранится. Назначенный террариум освободится.' : 'Для питомца можно будет выбрать свободный террариум.'),
    api.control('note', 'Причина', '', { type: 'textarea' })
  ], async input => {
    const movement = api.uid();
    await api.commit(current => {
      const entry = current.pets.find(item => item.id === pet.id);
      if (!entry || entry.archived === archived) return;
      if (archived) movePet(current, { id: movement, petId: entry.id, toId: '', date: localStamp().slice(0, 10),
        at: new Date().toISOString(), note: fieldText(input, 'note') || 'Перенос карточки в архив' });
      entry.archived = archived;
      entry.history.push({ at: new Date().toISOString(), fields: [archived ? 'Перенесён в архив' : 'Восстановлен из архива'],
        values: [{ label: 'Причина', before: '—', after: fieldText(input, 'note') || '—' }] });
    });
    return archived ? 'Карточка в архиве.' : 'Карточка снова активна.';
  }, archived ? 'Архивировать' : 'Восстановить');
}

function deleteArchived(data, api, pet) {
  const count = data.events.filter(row => row.petId === pet.id).length;
  api.showForm('Удалить карточку «' + pet.name + '»?', [
    muted('Будут удалены фотоальбом, напоминания, измерения, история переселений и записи ухода (' + count +
      '). Это действие нельзя отменить. Исходная резервная копия, если она есть, сохранится.')
  ], async () => {
    await api.commit((current, photoStore) => {
      const row = current.pets.find(item => item.id === pet.id);
      if (!row?.archived) throw new Error('В архиве такой карточки нет.');
      const events = new Set(current.events.filter(item => item.petId === row.id).map(item => item.id));
      if (current.stock.some(item => events.has(item.eventId))) {
        throw new Error('Карточка связана с журналом запасов. Она может храниться в архиве.');
      }
      const photoKeys = current.album.filter(item => item.petId === row.id).flatMap(item => [item.originalId, item.thumbId]);
      current.pets = current.pets.filter(item => item.id !== row.id);
      for (const key of ['events', 'reminders', 'album', 'growth', 'placements']) {
        current[key] = current[key].filter(item => item.petId !== row.id);
      }
      releaseMedia(current, photoStore, [row.photoId, ...photoKeys]);
    });
    location.hash = 'pets';
    return 'Карточка удалена из архива.';
  }, 'Удалить карточку');
}

export function passportView(data, pet, api, analytics) {
  const terrarium = data.terraria.find(item => item.id === placed(data, pet.id));
  const album = photosFor(data, pet.id);
  const gallery = album.length ? h('div', { class: 'album-grid' }, album.map(item =>
    h('article', { class: 'album-item' },
      h('button', { type: 'button', class: 'photo-button', 'aria-label': 'Открыть фото ' + (item.caption || dateLabel(item.date)),
        click: () => enlarge(api.readFile, item.originalId, item.caption || pet.name, dateLabel(item.date)) },
      api.picture(item.thumbId || item.originalId, item.caption || pet.name)),
      h('small', {}, dateLabel(item.date)), item.caption && h('p', {}, item.caption),
      h('div', { class: 'actions' },
        pet.photoId === item.originalId ? h('span', { class: 'current-cover' }, 'Основное фото')
          : button('Сделать главным', () => chooseCover(api, item)),
        button('Изменить подпись', () => editPhoto(api, pet, item), 'quiet'),
        button('Удалить', () => removePhoto(api, item), 'quiet'))))) : empty('Фотографии ещё не добавлены.');
  const personal = [
    detail(petFields.scientific, pet.scientific || '—'), detail(petFields.species, pet.species || '—'),
    detail(petFields.confidence, labels.confidence[pet.confidence]), detail(petFields.origin, pet.origin || '—'),
    detail(petFields.sex, labels.sex[pet.sex]), detail(petFields.age, pet.age || '—'),
    detail(petFields.stage, pet.stage || labels.maturity[pet.maturity]), detail('Размер', pet.sizeCm === null ? pet.size || '—' : labels.metric[pet.metric] + ' · ' + cm(pet.sizeCm)),
    detail(petFields.acquired, displayDate(pet.acquired)), detail(ru.molt, displayDate(lastEvent(data, pet, ru.molt)?.date)),
    detail(ru.feeding, displayDate(lastEvent(data, pet, ru.feeding)?.date)),
    detail('Террариум', terrarium ? h('a', { href: '#' + pathFor('terraria', terrarium.id) }, terrarium.name) : ru.emptyHome),
    detail(petFields.behavior, pet.behavior || '—'), detail(petFields.notes, pet.notes || '—')
  ];
  const history = recent(data.events.filter(event => event.petId === pet.id));
  const movement = [...data.placements].filter(item => item.petId === pet.id).reverse().map(item => {
    const name = id => data.terraria.find(value => value.id === id)?.name || 'Без террариума';
    return h('li', {}, h('div', { class: 'item-content' }, h('strong', {}, name(item.fromId) + ' → ' + name(item.toId)),
      h('small', {}, displayDate(item.date)), item.note && h('p', {}, item.note)));
  });
  const cover = petPhoto(data, pet);
  return [
    h('div', { class: 'actions section-links' }, link('К коллекции', 'pets', 'quiet', 'left'), link('Дневник', pathFor('care', pet.id)),
      link(ru.analytics, pathFor('analytics', pet.id))),
    heading(pet.name, pet.archived ? 'Паспорт · архив' : ru.passport, button('Изменить', () => editPet(api, pet))),
    h('div', { class: 'two-up passport-panels' },
      panel('Сведения', h('div', {}, h('dl', { class: 'facts' }, personal),
        h('div', { class: 'actions' }, !pet.archived && button('Переселить', () => api.move(pet)),
          button(pet.archived ? 'Вернуть из архива' : 'Архивировать', () => archive(api, pet), 'quiet'),
          pet.archived && button('Удалить карточку', () => deleteArchived(data, api, pet), 'quiet')))),
      panel('Основное фото', cover ? h('button', { type: 'button', class: 'photo-button cover-photo',
        'aria-label': 'Открыть основное фото', click: () => enlarge(api.readFile, cover.originalId, pet.name, dateLabel(cover.date)) },
      api.picture(cover.thumbId || cover.originalId, pet.name)) : empty('Выберите главное фото из альбома.'))),
    panel(ru.album, gallery, h('div', { class: 'actions' }, button('Добавить фото', () => editPhoto(api, pet), 'primary', 'plus'),
      album.length >= 2 && link(ru.compare, pathFor('pets', pet.id, 'compare')))),
    analytics,
    panel('Записи питомца', eventList(history, data, api.editEvent),
      h('div', { class: 'actions' }, button('Кормление', () => api.addEvent(pet.id, ru.feeding)),
        button('Линька', () => api.addEvent(pet.id, ru.molt)))),
    panel('Переселения', movement.length ? h('ul', { class: 'items' }, movement) : empty('Переселений пока нет.')),
    h('details', { class: 'panel' }, h('summary', {}, 'История изменений'),
      pet.history.map(entry => h('div', { class: 'history-entry' }, h('strong', {}, displayStamp(entry.at)),
        muted(entry.fields.join(', ')), (entry.values || []).map(field => muted(field.label + ' · ' + field.before + ' → ' + field.after)))))
  ];
}

export function comparisonView(data, pet, api) {
  const root = h('div', { class: 'two-up compare-pair' });
  const all = photosFor(data, pet.id).reverse();
  const options = all.map(item => [item.id, [dateLabel(item.date), item.caption].filter(Boolean).join(' · ')]);
  const ids = [all[0]?.id, all.at(-1)?.id];
  let scope;
  function update() {
    scope?.dispose();
    scope = api.newMediaScope();
    if (!ids[0] || !ids[1] || ids[0] === ids[1]) {
      root.replaceChildren(empty('Выберите две разные фотографии.'));
      return;
    }
    root.replaceChildren(...ids.map((id, index) => {
      const photo = all.find(item => item.id === id);
      return h('figure', { class: 'panel compare-photo' }, h('figcaption', {},
        h('h2', {}, index ? 'После линьки' : 'До линьки'), muted(dateLabel(photo.date)),
        photo.caption && h('p', {}, photo.caption)),
      scope.picture(photo.originalId, photo.caption || pet.name, true));
    }));
  }
  const selects = ids.map((id, index) => choice(index ? 'Фото после' : 'Фото до', options, id, value => {
    ids[index] = value;
    update();
  }));
  update();
  return [link('К паспорту', pathFor('pets', pet.id), 'quiet', 'left'), heading(ru.compare, pet.name),
    h('div', { class: 'actions' }, selects), root];
}
