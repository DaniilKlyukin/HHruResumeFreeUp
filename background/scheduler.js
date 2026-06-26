import { logMessage } from './logger.js';
import { isExtensionEnabled, registerSystemTab, unregisterSystemTab, gcSystemTabs } from './storage.js';
import { viewRecommendedVacancies } from './vacancies.js';

// Специальный delay, поддерживающий активность Service Worker во время длительных ожиданий
const delay = (ms) => {
  if (ms < 8000) {
    return new Promise(res => setTimeout(res, ms));
  }
  return new Promise(res => {
    const start = Date.now();
    const interval = setInterval(() => {
      chrome.runtime.getPlatformInfo(() => {
        if (chrome.runtime.lastError) { /* подавление возможных ошибок контекста */ }
      });
      if (Date.now() - start >= ms) {
        clearInterval(interval);
        res();
      }
    }, 8000);
  });
};

async function safeRemoveTab(tabId) {
  if (!tabId) return;
  await unregisterSystemTab(tabId);
  chrome.tabs.remove(tabId, () => {
    if (chrome.runtime.lastError) {
      console.log("Ожидаемое поведение: закрытие вкладки подавлено.", chrome.runtime.lastError.message);
    }
  });
}

export async function processPendingUpdates() {
  const enabled = await isExtensionEnabled();
  if (!enabled) {
    return; 
  }

  // Очистка потенциально зависших вкладок перед началом нового сеанса работы
  try {
    await gcSystemTabs();
  } catch (err) {
    console.error("Ошибка сборщика мусора вкладок:", err);
  }

  const data = await chrome.storage.local.get({ resumes: [] });
  const resumes = data.resumes;
  const now = Date.now();
  let needSave = false;

  await delay(Math.floor(Math.random() * 5000));

  for (let config of resumes) {
    if (config.isActive && (!config.nextExecutionAt || config.nextExecutionAt <= now)) {
      await logMessage(`Проверка автообновления для резюме: "${config.name}"`, "info");
      
      const status = await executeUpdateInHiddenTab(config.id);
      needSave = true;
      
      if (status === 'clicked') {
        config.lastExecutedAt = now;
        config.lastErrorMessage = null;
        
        const hours = typeof config.intervalHours !== 'undefined' ? config.intervalHours : 4;
        const minutes = typeof config.intervalMinutes !== 'undefined' ? config.intervalMinutes : 0;
        const intervalMs = (hours * 60 * 60 * 1000) + (minutes * 60 * 1000);
        
        config.nextExecutionAt = now + intervalMs;
        await logMessage(`Резюме "${config.name}" поднято успешно! Следующая проверка: ${new Date(config.nextExecutionAt).toLocaleTimeString('ru-RU', {hour12:false})}`, "success");
        
        const lastViewed = config.lastVacanciesViewedAt || 0;
        if (config.autoViewVacancies !== false && (now - lastViewed > 60 * 60 * 1000)) {
          config.lastVacanciesViewedAt = now;
          viewRecommendedVacancies(config);
        }
        
      } else if (status === 'already_active') {
        config.lastErrorMessage = "Кулдаун активен (уже поднято ранее).";
        config.nextExecutionAt = now + (5 * 60 * 1000) - 10000; 
        await logMessage(`Кулдаун резюме "${config.name}" активен. Попытка перенесена на 5 минут.`, "warning");

        const lastViewed = config.lastVacanciesViewedAt || 0;
        if (config.autoViewVacancies !== false && (now - lastViewed > 60 * 60 * 1000)) {
          config.lastVacanciesViewedAt = now;
          viewRecommendedVacancies(config);
        }
      } else if (status === 'error_cooldown') {
        config.lastErrorMessage = "Кулдаун активен (определено по структуре кабинета).";
        config.nextExecutionAt = now + (5 * 60 * 1000) - 10000; 
        await logMessage(`Кулдаун резюме "${config.name}" активен.`, "warning");

        const lastViewed = config.lastVacanciesViewedAt || 0;
        if (config.autoViewVacancies !== false && (now - lastViewed > 60 * 60 * 1000)) {
          config.lastVacanciesViewedAt = now;
          viewRecommendedVacancies(config);
        }
      } else {
        config.lastErrorMessage = "Не удалось загрузить страницу резюме.";
        config.nextExecutionAt = now + (5 * 60 * 1000) - 10000;
        await logMessage(`Сбой загрузки страницы резюме "${config.name}". Повтор через 5 минут. Проверьте авторизацию на hh.ru.`, "error");
      }
    }
  }
  
  if (needSave) {
    await chrome.storage.local.set({ resumes });
  }
}

function executeUpdateInHiddenTab(resumeId) {
  return new Promise((resolve) => {
    chrome.tabs.create({ url: `https://hh.ru/resume/${resumeId}`, active: false }, async (tab) => {
      if (chrome.runtime.lastError || !tab || !tab.id) {
        resolve('error');
        return;
      }

      const tabId = tab.id;
      await registerSystemTab(tabId);
      let isResolved = false;

      const cleanUpAndResolve = async (status) => {
        if (isResolved) return;
        isResolved = true;
        
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(safetyTimeout);
        await safeRemoveTab(tabId);
        resolve(status);
      };

      const runScript = async () => {
        if (isResolved) return;
        
        chrome.tabs.onUpdated.removeListener(listener);

        setTimeout(async () => {
          try {
            const checkTab = await chrome.tabs.get(tabId);
            if (!checkTab) {
              await cleanUpAndResolve('error');
              return;
            }
          } catch (_) {
            await cleanUpAndResolve('error');
            return;
          }

          try {
            const results = await chrome.scripting.executeScript({
              target: { tabId: tabId },
              func: async (id) => {
                const innerDelay = (ms) => new Promise(res => setTimeout(res, ms));
                
                for (let i = 0; i < 30; i++) {
                  let btn = document.querySelector(`[data-qa="resume-update-button_${id}"]`);
                  if (!btn) {
                    btn = document.querySelector('[data-qa="resume-update-button"]');
                  }
                  if (!btn) {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    btn = buttons.find(b => {
                      const text = (b.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
                      return text.includes('поднять в поиске');
                    });
                  }

                  if (btn) {
                    const text = (btn.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
                    const isDisabled = btn.disabled || 
                                       btn.getAttribute('aria-disabled') === 'true' ||
                                       text.includes('будет доступно') || 
                                       text.includes('поднято');

                    if (isDisabled) {
                      return 'already_active';
                    }
                    
                    btn.click();
                    await innerDelay(4000); 
                    return 'clicked';
                  }
                  await innerDelay(500);
                }
                
                const pageText = document.body.textContent || '';
                const isResumePage = pageText.includes('Видимость резюме') || 
                                     pageText.includes('Подобрали для вас') || 
                                     pageText.includes('Мои резюме') ||
                                     document.querySelector('[data-qa="resume-visibility"]') !== null;

                if (isResumePage) {
                  return 'already_active'; 
                }
                
                return 'error';
              },
              args: [resumeId]
            });

            const status = results && results[0] && results[0].result;
            await cleanUpAndResolve(status || 'error');
          } catch (e) {
            const errMsg = e.message || String(e);
            // Если фрейм удален, вкладка закрыта или контекст недействителен — обрабатываем мягко
            if (errMsg.includes("Frame with ID 0 was removed") || errMsg.includes("closed") || errMsg.includes("invalidated")) {
              console.warn(`[Планировщик] Вкладка резюме ${resumeId} изменила состояние (возможен редирект или закрытие). Проверьте авторизацию на hh.ru.`);
            } else {
              console.error("Ошибка выполнения скрипта во вкладке:", e);
            }
            await cleanUpAndResolve('error');
          }
        }, 1500);
      };

      const listener = (updatedTabId, changeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          runScript();
        }
      };

      if (tab.status === 'complete') {
        runScript();
      } else {
        chrome.tabs.onUpdated.addListener(listener);
      }

      const safetyTimeout = setTimeout(async () => {
        await cleanUpAndResolve('error');
      }, 35000);
    });
  });
}