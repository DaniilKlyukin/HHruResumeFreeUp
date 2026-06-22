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