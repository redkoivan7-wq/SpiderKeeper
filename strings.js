export const ru = {
  collection: 'Моя коллекция', passport: 'Паспорт питомца', album: 'Фотоальбом', compare: 'До и после линьки',
  terraria: 'Мои террариумы', feeds: 'Кормовая база', analytics: 'Статистика',
  active: 'Активные', archive: 'Архив', date: 'Дата', time: 'Время', note: 'Комментарий',
  name: 'Название', photo: 'Фотография', unknown: 'Неизвестно',
  temperature: 'Температура, °C', humidity: 'Относительная влажность, %',
  measurement: 'Записать измерение', molt: 'Линька', feeding: 'Кормление', refusal: 'Отказ от корма',
  premolt: 'Подготовка к линьке', placement: 'Переселение питомца',
  emptyHome: 'Террариум не назначен', noData: 'За выбранный период данных нет.',
  choose: 'Выберите значение', back: 'Назад'
};
export const labels = {
  sex: { unknown: 'Пол неизвестен', male: 'Самец', female: 'Самка' },
  maturity: { '': 'Возрастная группа неизвестна', juvenile: 'Молодая особь', adult: 'Взрослая особь' },
  confidence: { unknown: 'Неизвестен', tentative: 'Предположительно определён', confirmed: 'Подтверждён' },
  metric: { legs: 'Размах лап', body: 'Длина тела' },
  terrarium: { '': ru.unknown, ground: 'Наземный', tree: 'Древесный', burrow: 'Норный', universal: 'Универсальный' },
  boolean: { '': ru.unknown, yes: 'Да', no: 'Нет' },
  handling: {
    clean: 'Уборка', substrate: 'Замена субстрата', water: 'Замена воды',
    air: 'Обслуживание вентиляции', equipment: 'Перемещение оборудования', note: 'Заметка'
  },
  stock: { add: 'Приход', remove: 'Расход', dead: 'Погибшие насекомые', correct: 'Коррекция',
    feeding: 'Кормление', undo: 'Отмена операции' },
  period: { month: 'Месяц', quarter: '3 месяца', year: 'Год', all: 'Весь период' }
};
export const petFields = {
  name: 'Имя', scientific: 'Научное название', species: 'Распространённое название',
  confidence: 'Достоверность определения вида', origin: 'Предполагаемое происхождение', sex: 'Пол',
  age: 'Возраст', maturity: 'Возрастная группа', stage: 'Стадия развития',
  size: 'Прежняя запись о размере', sizeCm: 'Размер, см', metric: 'Способ измерения',
  acquired: 'Дата приобретения', lastMolt: 'Последняя известная линька', lastFeeding: 'Последнее известное кормление',
  behavior: 'Особенности поведения', notes: 'Комментарии владельца', photoId: ru.photo
};
export const terrariumFields = {
  name: ru.name, kind: 'Тип', length: 'Длина, см', width: 'Ширина, см', height: 'Высота, см',
  substrate: 'Субстрат', depth: 'Толщина субстрата, см', hide: 'Укрытие', water: 'Поилка',
  ventilation: 'Вентиляция', equipment: 'Оборудование', location: 'Местоположение',
  started: 'Дата запуска', note: ru.note, tempMin: 'Температура от, °C', tempMax: 'Температура до, °C',
  humidityMin: 'Влажность от, %', humidityMax: 'Влажность до, %'
};
export const signs = ['Отказ от корма', 'Изменение поведения', 'Длительное укрытие', 'Изменение внешнего вида', 'Другие наблюдения'];
