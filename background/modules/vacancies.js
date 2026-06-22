import { logMessage } from './logger.js';
import { isVacancyViewed, markVacancyAsViewed } from './storage.js';

const delay = (ms) => new Promise(res => setTimeout(res, ms));

function safeRemoveTab(tabId) {
  if (!tabId) return;
  chrome.tabs.remove(tabId, () => {
    if (chrome.runtime.lastError) {
      console.log("Ожидаемое поведение: закрытие вкладки подавлено.", chrome.runtime.lastError.message);
    }
  });
}

function extractVacancyId(url) {
  try {
    const match = url.match(/\/vacancy\/(\d+)/);
    return match ? match[1] : null;
  } catch (_) {
    return null;
  }
}

export async function viewRecommendedVacancies(config) {
  await logMessage(`[Просмотр вакансий] Получение списка подходящих вакансий для резюме "${config.name}"...`, "info");
  const searchUrl = `https://hh.ru/search/vacancy?resume=${config.id}`;
  
  const links = await harvestVacancyLinks(searchUrl);
  if (!links || links.length === 0) {
    await logMessage("[Просмотр вакансий] Не удалось получить ссылки. Страница пуста или заблокирована капчей.", "warning");
    return;
  }

  // Фильтрация через кеш просмотренных вакансий
  const unviewedVacancies = [];
  for (const url of links) {
    const id = extractVacancyId(url);
    if (id) {
      const alreadyViewed = await isVacancyViewed(id);
      if (!alreadyViewed) {
        unviewedVacancies.push({ url, id });
      }
    }
  }

  if (unviewedVacancies.length === 0) {
    await logMessage("[Просмотр вакансий] Все найденные на странице вакансии уже были просмотрены ранее.", "info");
    return;
  }

  const baseDuration = config.vacancyViewDuration || 15;
  await logMessage(`[Просмотр вакансий] Собрано новых уникальных ссылок: ${unviewedVacancies.length}. Начинаем автоматический обход...`, "success");

  for (let i = 0; i < unviewedVacancies.length; i++) {
    const vacancy = unviewedVacancies[i];
    
    // Рандомизация задержки
    const jitter = Math.floor(Math.random() * 7) - 3; 
    const actualDuration = Math.max(5, baseDuration + jitter);

    await logMessage(`[Просмотр] (${i + 1}/${unviewedVacancies.length}) Открываем вакансию на ${actualDuration} сек...`, "info");
    await viewSingleVacancy(vacancy.url, actualDuration, config);
    await markVacancyAsViewed(vacancy.id);
    
    // Пауза перед следующей вкладкой
    const nextTabDelay = 2000 + Math.floor(Math.random() * 3000);
    await delay(nextTabDelay);
  }
  await logMessage("[Просмотр вакансий] Все новые вакансии успешно обработаны.", "success");
}

function harvestVacancyLinks(url) {
  return new Promise((resolve) => {
    chrome.tabs.create({ url, active: false }, (tab) => {
      if (chrome.runtime.lastError || !tab || !tab.id) { 
        resolve([]); 
        return; 
      }
      const tabId = tab.id;

      const listener = async (updatedTabId, changeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);

          setTimeout(async () => {
            try {
              const results = await chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: () => {
                  const anchors = Array.from(document.querySelectorAll('a[href*="/vacancy/"]'));
                  const urls = anchors
                    .map(a => a.href)
                    .filter(href => href && href.includes('/vacancy/'))
                    .map(href => {
                      try {
                        const u = new URL(href);
                        return u.origin + u.pathname; 
                      } catch (_) {
                        return href;
                      }
                    });
                  return Array.from(new Set(urls)); 
                }
              });

              safeRemoveTab(tabId);
              const links = results && results[0] && results[0].result ? results[0].result : [];
              resolve(links);
            } catch (e) {
              console.error("[Просмотр вакансий] Ошибка сбора ссылок:", e);
              safeRemoveTab(tabId);
              resolve([]);
            }
          }, 3000);
        }
      };

      chrome.tabs.onUpdated.addListener(listener);

      setTimeout(async () => {
        chrome.tabs.onUpdated.removeListener(listener);
        safeRemoveTab(tabId);
        resolve([]);
      }, 20000);
    });
  });
}

export function viewSingleVacancy(url, durationSeconds, config) {
  return new Promise((resolve) => {
    chrome.tabs.create({ url, active: false }, (tab) => {
      if (chrome.runtime.lastError || !tab || !tab.id) { 
        resolve(); 
        return; 
      }
      const tabId = tab.id;

      const listener = async (updatedTabId, changeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);

          setTimeout(async () => {
            try {
              let likedStatus = null;

              if (config.autoLikeVacancies === true && config.likeKeywords) {
                const results = await chrome.scripting.executeScript({
                  target: { tabId: tabId },
                  func: async (keywordsStr, minMatches, minLikePercentage) => {
                    const delay = (ms) => new Promise(res => setTimeout(res, ms));
                    const keywords = keywordsStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
                    const bodyText = (document.body.textContent || '').toLowerCase();
                    
                    // 1. Попытка парсинга блока ключевых навыков вакансии
                    let vacancySkills = [];
                    const skillsContainer = document.querySelector('[data-qa="skills-container"]') || 
                                            document.querySelector('.bloko-tag-list') ||
                                            document.querySelector('.vacancy-skills-list');
                    if (skillsContainer) {
                      const tags = skillsContainer.querySelectorAll('[data-qa="bloko-tag__text"], .bloko-tag__text, span');
                      vacancySkills = Array.from(tags)
                        .map(el => el.textContent.trim().toLowerCase())
                        .filter(Boolean);
                    } else {
                      // Поиск тегов по классам (на случай, если обертка не найдена)
                      const tags = document.querySelectorAll('[data-qa="bloko-tag__text"], .bloko-tag__text');
                      vacancySkills = Array.from(tags)
                        .map(el => el.textContent.trim().toLowerCase())
                        .filter(text => text && text.length > 1 && !['полная занятость', 'опыт работы', 'удаленная'].some(b => text.includes(b)));
                    }
                    vacancySkills = Array.from(new Set(vacancySkills));

                    let matchedSkills = [];
                    let isPercentageMatch = false;
                    let finalPercentage = 0;

                    if (vacancySkills.length > 0) {
                      // Процентный метод сопоставления
                      vacancySkills.forEach(vSkill => {
                        const isMatch = keywords.some(keyword => vSkill.includes(keyword) || keyword.includes(vSkill));
                        if (isMatch) {
                          matchedSkills.push(vSkill);
                        }
                      });
                      finalPercentage = Math.round((matchedSkills.length / vacancySkills.length) * 100);
                      isPercentageMatch = finalPercentage >= minLikePercentage;
                    } else {
                      // Резервный метод (поиск прямых вхождений в описание вакансии)
                      keywords.forEach(keyword => {
                        if (bodyText.includes(keyword)) {
                          matchedSkills.push(keyword);
                        }
                      });
                    }

                    const shouldLike = vacancySkills.length > 0 
                      ? isPercentageMatch 
                      : (matchedSkills.length >= minMatches);

                    if (shouldLike) {
                      let favBtn = document.querySelector('[data-qa="vacancy-favorite-button"]') || 
                                   document.querySelector('[data-qa="favorite-button"]') || 
                                   document.querySelector('button[title*="избранное" i]') ||
                                   document.querySelector('button[aria-label*="избранное" i]');
                      if (!favBtn) {
                        const buttons = Array.from(document.querySelectorAll('button'));
                        favBtn = buttons.find(b => (b.textContent || '').toLowerCase().includes('избранное'));
                      }

                      if (favBtn) {
                        const label = (favBtn.getAttribute('aria-label') || favBtn.getAttribute('title') || favBtn.textContent || '').toLowerCase();
                        const isAlreadyFavorited = label.includes('удалить') || 
                                                   label.includes('убрать') || 
                                                   label.includes('удалено') || 
                                                   label.includes('в избранном') ||
                                                   favBtn.classList.contains('active') ||
                                                   favBtn.classList.contains('vacancy-action-button_active');
                        
                        if (!isAlreadyFavorited) {
                          favBtn.click();
                          await delay(1200); 
                          return { 
                            liked: true, 
                            usingPercentage: (vacancySkills.length > 0),
                            percentage: finalPercentage,
                            matchesCount: matchedSkills.length, 
                            matchedSkills 
                          };
                        }
                        return { 
                          liked: false, 
                          alreadyFavorited: true, 
                          usingPercentage: (vacancySkills.length > 0),
                          percentage: finalPercentage,
                          matchesCount: matchedSkills.length, 
                          matchedSkills 
                        };
                      }
                    }
                    return { 
                      liked: false, 
                      usingPercentage: (vacancySkills.length > 0),
                      percentage: finalPercentage,
                      matchesCount: matchedSkills.length, 
                      matchedSkills 
                    };
                  },
                  args: [config.likeKeywords, config.minLikeMatches || 3, config.minLikePercentage || 60]
                });

                likedStatus = results && results[0] && results[0].result ? results[0].result : null;
              }

              // Вывод подробных результатов в консоль
              if (likedStatus) {
                const methodStr = likedStatus.usingPercentage 
                  ? `Покрытие навыков вакансии: ${likedStatus.percentage}%` 
                  : `Резервный поиск: совпало ${likedStatus.matchesCount} навыков`;

                if (likedStatus.liked) {
                  await logMessage(`[Авто-лайк] Добавлено в Избранное! ${methodStr} (${likedStatus.matchedSkills.join(', ')})`, "success");
                } else if (likedStatus.alreadyFavorited) {
                  await logMessage(`[Авто-лайк] Соответствует критериям (${methodStr}), но вакансия уже в Избранном.`, "info");
                } else {
                  const neededStr = likedStatus.usingPercentage 
                    ? `нужно >= ${config.minLikePercentage || 60}%` 
                    : `нужно >= ${config.minLikeMatches || 3} совп.`;
                  await logMessage(`[Просмотр] Пропускаем лайк. ${methodStr} (${neededStr}).`, "info");
                }
              }

              safeRemoveTab(tabId);
              resolve();
            } catch (e) {
              console.error("Ошибка при работе с вкладкой вакансии:", e);
              safeRemoveTab(tabId);
              resolve();
            }
          }, durationSeconds * 1000);
        }
      };

      chrome.tabs.onUpdated.addListener(listener);

      setTimeout(async () => {
        chrome.tabs.onUpdated.removeListener(listener);
        safeRemoveTab(tabId);
        resolve();
      }, (durationSeconds + 10) * 1000);
    });
  });
}