import { logMessage } from './logger.js';
import { isVacancyViewed, markVacancyAsViewed, registerSystemTab, unregisterSystemTab } from './storage.js';

const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function safeRemoveTab(tabId) {
  if (!tabId) return;
  await unregisterSystemTab(tabId);
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
  const baseSearchUrl = `https://hh.ru/search/vacancy?resume=${config.id}`;
  
  let unviewedVacancies = [];
  let currentPage = 0;
  const maxPagesToCheck = 5; // Ограничение глубины поиска (5 страниц = 250 вакансий) для защиты от блокировок

  // Цикл постраничного поиска новых вакансий
  while (currentPage < maxPagesToCheck) {
    const pageUrl = `${baseSearchUrl}&page=${currentPage}`;
    await logMessage(`[Просмотр] Анализ страницы поиска ${currentPage + 1}...`, "info");
    
    const links = await harvestVacancyLinks(pageUrl);
    if (!links || links.length === 0) {
      await logMessage(`[Просмотр] Страница ${currentPage + 1} пуста или недоступна. Прекращаем поиск.`, "warning");
      break;
    }

    const pageUnviewed = [];
    for (const url of links) {
      const id = extractVacancyId(url);
      if (id) {
        const alreadyViewed = await isVacancyViewed(id);
        if (!alreadyViewed) {
          pageUnviewed.push({ url, id });
        }
      }
    }

    if (pageUnviewed.length > 0) {
      // Нашли новые вакансии на этой странице! Прерываем поиск страниц и берем их в обработку
      unviewedVacancies = pageUnviewed;
      break; 
    } else {
      // Если на этой странице все вакансии уже просмотрены ранее — идем глубже
      await logMessage(`[Просмотр] На странице ${currentPage + 1} все вакансии уже просмотрены. Ищем на следующей...`, "info");
      currentPage++;
      // Небольшая случайная пауза перед загрузкой следующей страницы поиска, чтобы имитировать человека
      await delay(2000 + Math.floor(Math.random() * 2000));
    }
  }

  if (unviewedVacancies.length === 0) {
    await logMessage(`[Просмотр вакансий] Все вакансии на первых ${maxPagesToCheck} страницах рекомендаций уже были просмотрены ранее.`, "info");
    return;
  }

  const baseDuration = config.vacancyViewDuration || 15;
  await logMessage(`[Просмотр вакансий] На странице поиска ${currentPage + 1} найдено новых вакансий: ${unviewedVacancies.length}. Начинаем автоматический обход...`, "success");

  for (let i = 0; i < unviewedVacancies.length; i++) {
    const vacancy = unviewedVacancies[i];
    
    // Рандомизация времени нахождения на странице
    const jitter = Math.floor(Math.random() * 7) - 3; 
    const actualDuration = Math.max(5, baseDuration + jitter);

    await logMessage(`[Просмотр] (${i + 1}/${unviewedVacancies.length}) Открываем вакансию на ${actualDuration} сек...`, "info");
    
    try {
      await viewSingleVacancy(vacancy.url, actualDuration, config);
      await markVacancyAsViewed(vacancy.id);
    } catch (err) {
      console.error("Ошибка при обработке вкладки вакансии:", err);
    }
    
    // Пауза перед следующей вкладкой
    const nextTabDelay = 2000 + Math.floor(Math.random() * 3000);
    await delay(nextTabDelay);
  }
  await logMessage("[Просмотр вакансий] Все новые вакансии на найденной странице успешно обработаны.", "success");
}

function harvestVacancyLinks(url) {
  return new Promise((resolve) => {
    chrome.tabs.create({ url, active: false }, async (tab) => {
      if (chrome.runtime.lastError || !tab || !tab.id) { 
        resolve([]); 
        return; 
      }
      const tabId = tab.id;
      await registerSystemTab(tabId);

      const cleanUpAndResolve = async (resultLinks) => {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(safetyTimeout);
        await safeRemoveTab(tabId);
        resolve(resultLinks);
      };

      const listener = async (updatedTabId, changeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
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

              const links = results && results[0] && results[0].result ? results[0].result : [];
              await cleanUpAndResolve(links);
            } catch (e) {
              console.error("[Просмотр вакансий] Ошибка сбора ссылок:", e);
              await cleanUpAndResolve([]);
            }
          }, 3000);
        }
      };

      chrome.tabs.onUpdated.addListener(listener);

      const safetyTimeout = setTimeout(async () => {
        await cleanUpAndResolve([]);
      }, 20000);
    });
  });
}

export function viewSingleVacancy(url, durationSeconds, config) {
  return new Promise((resolve) => {
    chrome.tabs.create({ url, active: false }, async (tab) => {
      if (chrome.runtime.lastError || !tab || !tab.id) { 
        resolve(); 
        return; 
      }
      const tabId = tab.id;
      await registerSystemTab(tabId);

      const cleanUpAndResolve = async () => {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(safetyTimeout);
        await safeRemoveTab(tabId);
        resolve();
      };

      const listener = async (updatedTabId, changeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
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
                      vacancySkills.forEach(vSkill => {
                        const isMatch = keywords.some(keyword => vSkill.includes(keyword) || keyword.includes(vSkill));
                        if (isMatch) {
                          matchedSkills.push(vSkill);
                        }
                      });
                      finalPercentage = Math.round((matchedSkills.length / vacancySkills.length) * 100);
                      isPercentageMatch = finalPercentage >= minLikePercentage;
                    } else {
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
                                   document.querySelector('button[aria-label*="избранное" i]') ||
                                   document.querySelector('.vacancy-action-button-svg_favorite') ||
                                   document.querySelector('[class*="favorite-button"]') ||
                                   document.querySelector('[class*="favorite_button"]');
                      
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
                      } else {
                        return {
                          liked: false,
                          buttonNotFound: true,
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

              if (likedStatus) {
                const methodStr = likedStatus.usingPercentage 
                  ? `Покрытие навыков вакансии: ${likedStatus.percentage}%` 
                  : `Резервный поиск: совпало ${likedStatus.matchesCount} навыков`;

                if (likedStatus.liked) {
                  await logMessage(`[Авто-лайк] Добавлено в Избранное! ${methodStr} (${likedStatus.matchedSkills.join(', ')})`, "success");
                } else if (likedStatus.alreadyFavorited) {
                  await logMessage(`[Авто-лайк] Соответствует критериям (${methodStr}), но вакансия уже в Избранном.`, "info");
                } else if (likedStatus.buttonNotFound) {
                  await logMessage(`[Авто-лайк] Соответствует критериям (${methodStr}), но кнопка 'Избранное' не найдена на странице.`, "warning");
                } else {
                  const neededStr = likedStatus.usingPercentage 
                    ? `нужно >= ${config.minLikePercentage || 60}%` 
                    : `нужно >= ${config.minLikeMatches || 3} совп.`;
                  await logMessage(`[Просмотр] Пропускаем лайк. ${methodStr} (${neededStr}).`, "info");
                }
              }

              await cleanUpAndResolve();
            } catch (e) {
              console.error("Ошибка при работе с вкладкой вакансии:", e);
              await cleanUpAndResolve();
            }
          }, durationSeconds * 1000);
        }
      };

      chrome.tabs.onUpdated.addListener(listener);

      const safetyTimeout = setTimeout(async () => {
        await cleanUpAndResolve();
      }, (durationSeconds + 15) * 1000);
    });
  });
}