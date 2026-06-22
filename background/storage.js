// Проверка наличия вакансии в кеше просмотренных
export async function isVacancyViewed(id) {
  if (!id) return false;
  const { viewedVacancies = [] } = await chrome.storage.local.get('viewedVacancies');
  return viewedVacancies.includes(id);
}

// Добавление вакансии в кеш просмотренных (с ограничением размера кеша до 2000 записей)
export async function markVacancyAsViewed(id) {
  if (!id) return;
  const { viewedVacancies = [] } = await chrome.storage.local.get('viewedVacancies');
  
  if (!viewedVacancies.includes(id)) {
    viewedVacancies.push(id);
    if (viewedVacancies.length > 2000) {
      viewedVacancies.shift(); 
    }
    await chrome.storage.local.set({ viewedVacancies });
  }
}

// Получение общего статуса включения расширения (VPN-стиль)
export async function isExtensionEnabled() {
  const { extensionEnabled = true } = await chrome.storage.local.get('extensionEnabled');
  return extensionEnabled;
}

// Реестр открытых системных вкладок (для предотвращения утечек при сбоях Service Worker)
export async function registerSystemTab(tabId) {
  if (!tabId) return;
  const { systemTabs = {} } = await chrome.storage.local.get('systemTabs');
  systemTabs[tabId] = Date.now();
  await chrome.storage.local.set({ systemTabs });
}

export async function unregisterSystemTab(tabId) {
  if (!tabId) return;
  const { systemTabs = {} } = await chrome.storage.local.get('systemTabs');
  if (systemTabs[tabId]) {
    delete systemTabs[tabId];
    await chrome.storage.local.set({ systemTabs });
  }
}

// Принудительное закрытие зависших или потерянных вкладок
export async function gcSystemTabs() {
  const { systemTabs = {} } = await chrome.storage.local.get('systemTabs');
  const now = Date.now();
  const updatedTabs = { ...systemTabs };

  for (const [tabIdStr, openedAt] of Object.entries(systemTabs)) {
    const tabId = parseInt(tabIdStr, 10);
    // Закрываем вкладку, если она удерживается открытой более 3 минут
    if (now - openedAt > 3 * 60 * 1000) {
      try {
        await chrome.tabs.remove(tabId);
      } catch (_) {
        // Вкладка могла быть закрыта пользователем вручную
      }
      delete updatedTabs[tabIdStr];
    } else {
      // Проверяем физическое существование вкладки в браузере
      try {
        await chrome.tabs.get(tabId);
      } catch (_) {
        delete updatedTabs[tabIdStr];
      }
    }
  }
  await chrome.storage.local.set({ systemTabs: updatedTabs });
}

export async function clearViewedVacancies() {
  await chrome.storage.local.set({ viewedVacancies: [] });
}