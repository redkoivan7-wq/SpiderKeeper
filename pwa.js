import { button, h } from './ui.js';

export function setupPwa({ connection, update, notice, canReload }) {
  let installPrompt;
  let registration;
  let reloadRequested = false;
  let ready = false;
  let failure = false;
  const installAvailable = new EventTarget();

  function updateConnection() {
    connection.replaceChildren(h('span', { class: 'status-dot' }),
      !navigator.onLine ? 'Без сети' : failure ? 'Автономный режим недоступен' : ready ? 'Готово к работе без сети' : 'Подготовка автономного режима');
    connection.classList.toggle('offline', !navigator.onLine || failure);
  }
  window.addEventListener('online', updateConnection);
  window.addEventListener('offline', updateConnection);
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    installAvailable.dispatchEvent(new Event('change'));
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = undefined;
    installAvailable.dispatchEvent(new Event('change'));
  });
  updateConnection();

  function showUpdate() {
    update.replaceChildren();
    if (!registration?.waiting) return;
    update.append(h('div', { class: 'update-banner' }, h('strong', {}, 'Доступно обновление SpiderKeeper'),
      button('Обновить', () => {
        if (!canReload()) return;
        const worker = registration.waiting;
        if (!worker) return;
        reloadRequested = true;
        worker.postMessage('ACTIVATE_UPDATE');
      }, 'primary')));
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloadRequested) location.reload();
      else showUpdate();
    });
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(reg => {
      registration = reg;
      showUpdate();
      function watchInstall() {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'redundant' && !reg.active) {
            failure = true;
            updateConnection();
          }
          showUpdate();
        });
      }
      watchInstall();
      reg.addEventListener('updatefound', watchInstall);
      navigator.serviceWorker.ready.then(() => {
        ready = true;
        failure = false;
        updateConnection();
      });
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && navigator.onLine) reg.update().catch(() => {});
      });
    }).catch(() => {
      failure = true;
      updateConnection();
    });
  } else {
    failure = true;
    updateConnection();
  }
  return {
    installAvailable,
    canInstall: () => Boolean(installPrompt),
    standalone: () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
    async install() {
      if (!installPrompt) return;
      const prompt = installPrompt;
      installPrompt = undefined;
      try { await prompt.prompt(); }
      catch { notice('Откройте меню браузера, чтобы установить приложение.'); }
      finally { installAvailable.dispatchEvent(new Event('change')); }
    },
    async checkUpdates() {
      if (!registration) return notice('Автономный режим ещё не готов.');
      try {
        await registration.update();
        showUpdate();
        if (!registration.waiting && !registration.installing) notice('Установлена последняя версия.');
      } catch {
        notice('Проверить обновления не удалось. Проверьте подключение к интернету.');
      }
    }
  };
}
