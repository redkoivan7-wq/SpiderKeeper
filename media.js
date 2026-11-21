import { decodePhoto, inspectPhoto, photoKey } from './storage.js';
import { photoKeys } from './model.js';
import { button, h, muted } from './ui.js';

const extensions = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif', gif: 'image/gif', avif: 'image/avif' };
const highEfficiency = type => type === 'image/heic' || type === 'image/heif';

function resize(image, max, quality) {
  const scale = Math.min(1, max / Math.max(image.width, image.height));
  const canvas = h('canvas', { width: Math.max(1, Math.round(image.width * scale)),
    height: Math.max(1, Math.round(image.height * scale)) });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#171d18';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      canvas.width = canvas.height = 1;
      if (blob) resolve(blob);
      else reject(new Error('Не удалось обработать фото. Выберите более компактный файл.'));
    }, 'image/jpeg', quality);
  });
}

export async function preparePhoto(file, optimize) {
  if (!file?.size) return null;
  let original = file.type ? file : new Blob([file], { type: extensions[file.name.split('.').at(-1).toLowerCase()] });
  await inspectPhoto(original);
  let thumbnail;
  let optimized = false;
  let warning = '';
  let image;
  try { image = await decodePhoto(original); }
  catch {
    if (!highEfficiency(original.type)) throw new Error('Браузер не смог открыть это изображение.');
    if (optimize) throw new Error('Браузер не может преобразовать HEIC. Выберите оригинал либо загрузите JPG.');
    warning = 'Оригинал HEIC сохранён. Просмотр зависит от браузера.';
  }
  if (image) {
    try {
      thumbnail = await resize(image, 320, .78);
      if (optimize) {
        original = await resize(image, 1600, .86);
        optimized = true;
      }
    } finally { image.close?.(); }
  }
  return {
    originalId: await photoKey(original), original,
    thumbId: thumbnail ? await photoKey(thumbnail) : '', thumbnail, optimized, warning
  };
}

export function storeMedia(photos, media) {
  if (!media) return;
  photos.put(media.original, media.originalId);
  if (media.thumbnail) photos.put(media.thumbnail, media.thumbId);
}
export function releaseMedia(state, photos, ids) {
  const remaining = photoKeys(state);
  for (const id of new Set(ids)) {
    if (id && !remaining.has(id)) photos.delete(id);
  }
}
export function photoOptions(control, text = 'Фотография') {
  return [
    control('photo', text + ' · до 20 МБ', '', { type: 'file', accept: 'image/*,.heic,.heif' }),
    control('encoding', 'Хранение изображения', 'original', {
      choices: [['original', 'Оригинал'], ['optimized', 'Уменьшенная копия · до 1600 px']]
    })
  ];
}

export function mediaScope(readFile) {
  const urls = new Set();
  const waiting = new Map();
  let disposed = false;
  const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    for (const row of entries) {
      if (!row.isIntersecting) continue;
      observer.unobserve(row.target);
      const load = waiting.get(row.target);
      waiting.delete(row.target);
      load?.();
    }
  }, { rootMargin: '120px' }) : null;

  function picture(key, title, eager = false) {
    if (!key) return h('span', { class: 'media-placeholder' }, 'Без фото');
    const box = h('div', { class: 'media-slot' });
    const img = h('img', { alt: title, decoding: 'async' });
    const fail = () => box.replaceChildren(h('small', { class: 'media-placeholder' }, 'Фото недоступно в этом браузере.'));
    img.addEventListener('error', fail, { once: true });
    const load = async () => {
      try {
        const file = await readFile(key);
        if (disposed || !box.isConnected) return;
        if (!file) return fail();
        const url = URL.createObjectURL(file);
        urls.add(url);
        img.src = url;
        box.replaceChildren(img);
      } catch { if (!disposed) fail(); }
    };
    if (observer && !eager) {
      waiting.set(box, load);
      observer.observe(box);
    } else queueMicrotask(load);
    return box;
  }
  function dispose() {
    disposed = true;
    observer?.disconnect();
    waiting.clear();
    for (const url of urls) URL.revokeObjectURL(url);
    urls.clear();
  }

  return { picture, dispose };
}

export function enlarge(readFile, key, title, details) {
  const media = mediaScope(readFile);
  const close = button('Закрыть фото', () => viewer.close(), 'secondary');
  const viewer = h('dialog', { class: 'lightbox', 'aria-label': title },
    h('div', { class: 'lightbox-head' }, h('h2', {}, title), close),
    media.picture(key, title, true), details && muted(details));
  viewer.addEventListener('close', () => { media.dispose(); viewer.remove(); }, { once: true });
  document.body.append(viewer);
  viewer.showModal();
}
