import { eventLabel, eventTypes, h, localStamp, muted } from './ui.js';
import { albumRow, fieldText } from './collection.js';
import { amount, clock, day, postStock, same, stockCounts } from './model.js';
import { photoOptions, preparePhoto, storeMedia } from './media.js';
import { operation, stockLabel } from './feed.js';
import { labels, ru, signs } from './strings.js';

export function eventEditor(data, api, petId, type = ru.feeding, date, old) {
  if (!data.pets.length) {
    api.notice('Сначала добавьте паука в дневник.');
    return api.addPet();
  }
  const { control, showForm, commit } = api;
  const now = localStamp();
  const id = old?.id || api.uid();
  const newImageId = api.uid();
  const newDebitId = api.uid();
  const chosen = old?.type || type;
  const kinds = [...new Set([...eventTypes, chosen])].map(item => [item, eventLabel(item)]);
  const kind = control('type', 'Событие', chosen, { choices: kinds });
  const petSelect = control('petId', 'Паук', old?.petId || petId || '', {
    choices: data.pets.map(pet => [pet.id, pet.name + (pet.archived ? ' · архив' : '')]), required: true
  });
  const dateField = control('date', ru.date, old?.date || date || now.slice(0, 10), { type: 'date', required: true });
  const timeField = control('time', ru.time, old ? old.time : now.slice(11), { type: 'time' });
  const detail = control('detail', 'Корм', old?.detail || '');
  const pick = control('feed', 'Позиция корма', '', { choices: [['', 'Ввести вручную'],
    ...data.feeds.map(feed => [feed.id, stockLabel(feed, stockCounts(data))])] });
  const debit = h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'debit' }), 'Списать из запаса');
  const units = control('count', 'Списать, шт.', '1', { type: 'number', min: '1', step: '1' });
  const debitHelp = muted('Списание доступно для нового кормления за сегодня.');
  const stock = h('div', { class: 'form-subgroup wide' }, pick, debit, units, debitHelp);
  const albumChoices = h('fieldset', { class: 'wide attached-choices' });
  const molting = h('div', { class: 'form-subgroup wide' },
    control('metric', 'Способ измерения', old?.molt?.metric || 'legs', { choices: Object.entries(labels.metric) }),
    control('before', 'Размер до линьки, см', old?.molt?.before ?? '', { type: 'number', min: '.01', step: 'any' }),
    control('after', 'Размер после линьки, см', old?.molt?.after ?? '', { type: 'number', min: '.01', step: 'any' }),
    control('condition', 'Состояние питомца', old?.molt?.condition || ''),
    albumChoices, ...photoOptions(control, 'Прикрепить новое фото'),
    control('captureDate', 'Дата нового фото', '', { type: 'date' }), control('captureCaption', 'Подпись нового фото'));
  const sign = control('sign', 'Наблюдаемый признак', old?.sign || '', { choices: [['', 'Указать в комментарии'], ...signs.map(name => [name, name])] });
  const premolt = h('div', { class: 'form-subgroup wide' }, sign, muted('Наблюдение может иметь разные причины. Диагноз линьки по одному признаку не ставится.'));
  const typeInput = kind.querySelector('select');
  const petInput = petSelect.querySelector('select');
  const dateInput = dateField.querySelector('input');
  const timeInput = timeField.querySelector('input');
  const text = detail.querySelector('input');
  const feedInput = pick.querySelector('select');
  const checkbox = debit.querySelector('input');
  const editedPhotos = new Set(old?.molt?.photoIds || []);
  if (old && ['Температура', 'Влажность'].includes(old.type)) text.value = old.detail.replace(/\s*(°C|%)$/, '');

  function albumOptions() {
    const choices = data.album.filter(photo => photo.petId === petInput.value);
    albumChoices.replaceChildren(h('legend', {}, 'Фото из альбома'),
      ...(choices.length ? choices.map(item => h('label', { class: 'check' },
        h('input', { type: 'checkbox', name: 'attachment', value: item.id, checked: editedPhotos.has(item.id) }),
        [item.date, item.caption].filter(Boolean).join(' · ') || 'Снимок без подписи')) : [muted('У питомца пока нет фотографий.')]));
    for (const box of albumChoices.querySelectorAll('input')) box.addEventListener('change', () => {
      if (box.checked) editedPhotos.add(box.value); else editedPhotos.delete(box.value);
    });
  }

  function toggleGroup(group, hidden) {
    group.hidden = hidden;
    for (const element of group.querySelectorAll('input,select')) element.disabled = hidden;
  }
  function configure() {
    const typ = typeInput.value;
    const temp = typ === 'Температура';
    const rh = typ === 'Влажность';
    const food = typ === ru.feeding || typ === ru.refusal;
    text.type = temp || rh ? 'number' : 'text';
    text.min = rh ? '0' : temp ? '-273.15' : '';
    text.max = rh ? '100' : '';
    text.step = 'any';
    text.required = temp || rh || (typ === ru.feeding && (!feedInput.value || Boolean(old)));
    detail.querySelector('span').textContent = temp ? ru.temperature : rh ? 'Влажность, %' : 'Корм';
    detail.hidden = !food && !temp && !rh;
    toggleGroup(stock, !food || Boolean(old) || !data.feeds.length);
    const allowDebit = !stock.hidden && typ === ru.feeding && Boolean(feedInput.value) && dateInput.value === now.slice(0, 10);
    checkbox.disabled = !allowDebit;
    if (!allowDebit) checkbox.checked = false;
    debit.hidden = typ !== ru.feeding;
    toggleGroup(units, !checkbox.checked);
    units.querySelector('input').required = checkbox.checked;
    debitHelp.hidden = typ !== ru.feeding;
    toggleGroup(molting, typ !== ru.molt);
    toggleGroup(premolt, typ !== ru.premolt);
    timeInput.required = typ !== ru.molt && !old;
  }
  typeInput.addEventListener('change', () => { text.value = ''; configure(); });
  for (const input of [feedInput, checkbox, dateInput]) input.addEventListener('change', configure);
  petInput.addEventListener('change', () => { albumOptions(); configure(); });
  albumOptions();
  configure();
  showForm(old ? 'Изменить запись ухода' : 'Записать уход', [
    petSelect, kind, dateField, timeField, detail, stock, molting, premolt,
    control('note', ru.note, old?.note || '', { type: 'textarea' })
  ], async input => {
    const typed = fieldText(input, 'type');
    const eventDate = day(input.get('date'), true);
    const pet = fieldText(input, 'petId');
    const feed = !old && [ru.feeding, ru.refusal].includes(typed) ? data.feeds.find(row => row.id === input.get('feed')) : null;
    const useStock = typed === ru.feeding && eventDate === localStamp().slice(0, 10) && feed && input.has('debit');
    if (input.has('debit') && !useStock) throw new Error('Списание доступно только для кормления за сегодня.');
    const debitCount = useStock ? amount(input.get('count'), 1, Number.MAX_SAFE_INTEGER, true) : null;
    if (useStock && debitCount === null) throw new Error('Укажите количество для списания.');
    let description = detail.hidden ? '' : fieldText(input, 'detail');
    if (feed && !description) description = feed.name;
    if (typed === ru.feeding && !description) throw new Error('Укажите корм.');
    if (typed === 'Температура' || typed === 'Влажность') {
      const rh = typed === 'Влажность';
      const measurement = amount(description, rh ? 0 : -273.15, rh ? 100 : Number.MAX_SAFE_INTEGER);
      if (measurement === null) throw new Error('Введите измеренное значение.');
      description = measurement + (rh ? ' %' : ' °C');
    }
    const row = { ...old, id, petId: pet, type: typed, date: eventDate, time: clock(input.get('time')),
      detail: description, note: fieldText(input, 'note') };
    let media;
    if (typed === ru.molt) {
      media = await preparePhoto(input.get('photo'), input.get('encoding') === 'optimized');
      row.molt = { metric: fieldText(input, 'metric'), before: amount(input.get('before'), .01), after: amount(input.get('after'), .01),
        condition: fieldText(input, 'condition'), photoIds: [...input.getAll('attachment'), ...(media ? [newImageId] : [])] };
    } else delete row.molt;
    if (typed === ru.premolt) row.sign = fieldText(input, 'sign');
    else delete row.sign;
    await commit((current, photoStore) => {
      const index = current.events.findIndex(item => item.id === id);
      if (!old && index >= 0) return;
      if (!current.pets.some(owner => owner.id === pet)) throw new Error('Выберите паука.');
      if (old && !same(current.events[index], old)) throw new Error('Запись изменилась в другом окне.');
      const linked = current.stock.filter(entry => entry.eventId === id);
      if (linked.length && typed !== ru.feeding) {
        throw new Error('Запись связана с движением запаса. Можно исправить комментарий, дату или вид корма, сохранив тип «Кормление».');
      }
      if (row.molt?.photoIds.some(photo => photo !== newImageId &&
          !current.album.some(item => item.id === photo && item.petId === pet))) throw new Error('Один из снимков уже недоступен.');
      if (media) {
        current.album.push(albumRow(newImageId, pet, media, day(input.get('captureDate')),
          fieldText(input, 'captureCaption') || 'Линька · ' + eventDate));
        storeMedia(photoStore, media);
      }
      if (index >= 0) current.events[index] = row;
      else current.events.push(row);
      if (useStock) postStock(current, operation(api, 'feeding', null,
        { id: newDebitId, feedId: feed.id, eventId: row.id, delta: -debitCount, note: description }));
    });
    return media?.warning || (old ? 'Запись обновлена.' : 'Запись добавлена в дневник.');
  });
}
