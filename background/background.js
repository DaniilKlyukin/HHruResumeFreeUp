import { logMessage } from './logger.js';
import { processPendingUpdates } from './scheduler.js';

async function initScheduler() {
  const alarm = await chrome.alarms.get("checkUpdates");
  if (!alarm) {
    chrome.alarms.create("checkUpdates", { periodInMinutes: 5 });
  }
}

// Функция автоматического восстановления данных из профиля Google Sync
async function restoreDataFromCloudSync() {
  try {
    const syncData = await chrome.storage.sync.get(['resumesBackup', 'viewedVacanciesBackup']);
    const localUpdate = {};

    if (syncData.resumesBackup) {
      localUpdate.resumes = syncData.resumesBackup;
    }

    if (syncData.viewedVacanciesBackup) {
      // Преобразуем сохраненную CSV-строку обратно в рабочий массив
      const array = syncData.viewedVacanciesBackup.split(',').filter(Boolean);
      localUpdate.viewedVacancies = array;
    }

    if (Object.keys(localUpdate).length > 0) {
      await chrome.storage.local.set(localUpdate);
      await logMessage("Данные успешно восстановлены из облака Google Sync при переустановке.", "success");
    }
  } catch (e) {
    console.error("Ошибка автоматического восстановления данных из облака Sync:", e);
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  // Пытаемся восстановить данные из облака Google перед запуском логики
  await restoreDataFromCloudSync();
  
  await initScheduler();
  await logMessage("Планировщик расширения запущен на устройстве.", "success");
  processPendingUpdates(); 
});

chrome.runtime.onStartup.addListener(async () => {
  await initScheduler();
  await logMessage("Браузер запущен, возобновление работы планировщика.", "info");
  processPendingUpdates(); 
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "triggerUpdate") {
    processPendingUpdates().then(() => {
      if (sendResponse) sendResponse({ success: true });
    });
    return true; 
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "checkUpdates") {
    await processPendingUpdates();
  }
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === 'local') {
    
    if (changes.resumes) {
      try {
        await chrome.storage.sync.set({ resumesBackup: changes.resumes.newValue });
      } catch (e) {
        console.error("Ошибка синхронизации настроек резюме с облаком:", e);
      }
    }
    
    if (changes.viewedVacancies) {
      try {
        const list = changes.viewedVacancies.newValue || [];
        const syncSubList = list.slice(-500); 
        await chrome.storage.sync.set({ viewedVacanciesBackup: syncSubList.join(',') });
      } catch (e) {
        console.error("Ошибка синхронизации кэша вакансий с облаком:", e);
      }
    }
    
  }
});