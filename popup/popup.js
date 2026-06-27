function formatTime(timestamp) {
  if (!timestamp) return 'Нет данных';
  const date = new Date(timestamp);
  const timeStr = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', hour12: false });
  
  const today = new Date();
  const isToday = date.getDate() === today.getDate() && 
                  date.getMonth() === today.getMonth() && 
                  date.getFullYear() === today.getFullYear();
                  
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const isTomorrow = date.getDate() === tomorrow.getDate() && 
                     date.getMonth() === tomorrow.getMonth() && 
                     date.getFullYear() === tomorrow.getFullYear();
  
  if (isToday) {
    return timeStr;
  } else if (isTomorrow) {
    return `Завтра в ${timeStr}`;
  } else {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${day}.${month} в ${timeStr}`;
  }
}

async function renderLogs() {
  const logConsole = document.getElementById('logConsole');
  if (!logConsole) return;

  const data = await chrome.storage.local.get({ logs: [] });
  const logs = data.logs || [];

  if (logs.length === 0) {
    logConsole.innerHTML = '<div class="text-muted text-center py-2">Логи пусты.</div>';
    return;
  }

  logConsole.innerHTML = logs.map(log => {
    let color = 'text-dark';
    if (log.type === 'error') color = 'text-danger';
    if (log.type === 'success') color = 'text-success';
    if (log.type === 'warning') color = 'text-warning';
    return `<div class="${color}">[${log.timestamp}] ${log.message}</div>`;
  }).join('');
}

function toggleLogsBtnText(expanded) {
  const toggleLogsCollapse = document.getElementById('toggleLogsCollapse');
  if (toggleLogsCollapse) {
    toggleLogsCollapse.textContent = expanded ? 'Свернуть' : 'Развернуть';
  }
}

async function toggleLogsContainer(show) {
  const logConsoleContainer = document.getElementById('logConsoleContainer');
  if (!logConsoleContainer) return;
  
  if (show) {
    logConsoleContainer.classList.remove('d-none');
    toggleLogsBtnText(true);
    await chrome.storage.local.set({ logsCollapsed: false });
  } else {
    logConsoleContainer.classList.add('d-none');
    toggleLogsBtnText(false);
    await chrome.storage.local.set({ logsCollapsed: true });
  }
}

function updateGlobalStatusUI(enabled) {
  const label = document.getElementById('globalStatusLabel');
  if (label) {
    label.textContent = enabled ? 'Мониторинг активен' : 'Мониторинг остановлен';
    if (enabled) {
      label.classList.remove('text-muted');
      label.classList.add('text-dark');
    } else {
      label.classList.remove('text-dark');
      label.classList.add('text-muted');
    }
  }
}

function showForm(id, name, hours, minutes, idValue, autoView, viewDuration, autoLike, likeKeywords, minLikeMatches, minLikePercentage) {
  formTitle.textContent = id ? 'Редактировать параметры' : 'Добавить резюме';
  resumeIdInput.value = idValue || id;
  resumeNameInput.value = name;
  intervalHoursInput.value = hours;
  intervalMinutesInput.value = minutes;
  autoViewVacanciesInput.checked = autoView !== false;
  vacancyViewDurationInput.value = viewDuration || 15;
  
  autoLikeVacanciesInput.checked = autoLike === true;
  likeKeywordsInput.value = likeKeywords || '';
  minLikeMatchesInput.value = minLikeMatches || 3;
  minLikePercentageInput.value = minLikePercentage || 60;

  if (autoView !== false) {
    vacancyViewDurationContainer.classList.remove('d-none');
  } else {
    vacancyViewDurationContainer.classList.add('d-none');
  }

  if (autoLike === true) {
    autoLikeContainer.classList.remove('d-none');
  } else {
    autoLikeContainer.classList.add('d-none');
  }

  editForm.classList.remove('d-none');
}

function editConfigReset() {
  editForm.classList.add('d-none');
  resumeIdInput.value = '';
  resumeNameInput.value = '';
  intervalHoursInput.value = '4';
  intervalMinutesInput.value = '0';
  autoViewVacanciesInput.checked = true;
  vacancyViewDurationInput.value = '15';
  vacancyViewDurationContainer.classList.add('d-none');
  
  autoLikeVacanciesInput.checked = false;
  likeKeywordsInput.value = '';
  minLikeMatchesInput.value = '3';
  minLikePercentageInput.value = '60';
  autoLikeContainer.classList.add('d-none');
}

// 2. ЗАГРУЗКА ДАННЫХ СПИСКА РЕЗЮМЕ

async function loadData() {
  const data = await chrome.storage.local.get("resumes");
  const resumes = data.resumes || [];

  if (resumes.length === 0) {
    resumeList.innerHTML = '<div class="text-muted text-center py-3">Нет активных резюме. Откройте страницу вашего резюме на hh.ru и нажмите «Добавить».</div>';
    return;
  }

  resumeList.innerHTML = '';
  resumes.forEach(config => {
    const card = document.createElement('div');
    card.className = 'card mb-2 p-2 border-secondary';

    const lastExec = formatTime(config.lastExecutedAt);
    const nextExec = formatTime(config.nextExecutionAt);

    const hours = typeof config.intervalHours !== 'undefined' ? config.intervalHours : 4;
    const minutes = typeof config.intervalMinutes !== 'undefined' ? config.intervalMinutes : 0;
    const viewDuration = config.vacancyViewDuration || 15;
    
    let intervalStr = '';
    if (hours > 0) intervalStr += `${hours} ч. `;
    if (minutes > 0 || hours === 0) intervalStr += `${minutes} мин.`;

    const autoView = config.autoViewVacancies !== false;
    const autoLike = config.autoLikeVacancies === true;
    const pct = config.minLikePercentage || 60;

    let errorClass = 'text-danger';
    if (config.lastErrorMessage && (config.lastErrorMessage.includes('ожидание') || config.lastErrorMessage.includes('кулдаун') || config.lastErrorMessage.includes('Кулдаун'))) {
      errorClass = 'text-warning';
    }

    card.innerHTML = `
      <div class="d-flex justify-content-between align-items-start">
        <div>
          <h6 class="mb-1 fw-bold">${config.name}</h6>
          <div class="small text-muted mb-1">ID: <code>${config.id.substring(0, 8)}...</code></div>
          <div class="small text-muted">Интервал: каждые ${intervalStr}</div>
          <div class="small text-muted">Последнее поднятие: ${lastExec}</div>
          <div class="small text-muted">Следующее поднятие: ${nextExec}</div>
          <div class="small text-muted">Просмотр вакансий: ${autoView ? `Вкл. (по ${viewDuration} сек.)` : 'Откл.'}</div>
          <div class="small text-muted">Авто-лайк по навыкам: ${autoLike ? `Вкл. (>= ${pct}% совп.)` : 'Откл.'}</div>
          ${config.lastErrorMessage ? `<div class="small ${errorClass} mt-1">${config.lastErrorMessage}</div>` : ''}
        </div>
        <div class="d-flex flex-column gap-1 align-items-end">
          <div class="form-check form-switch">
            <input class="form-check-input" type="checkbox" ${config.isActive ? 'checked' : ''} id="switch-${config.id}">
          </div>
          <button class="btn btn-sm btn-outline-danger p-1 py-0 mt-2" id="del-${config.id}">Удалить</button>
        </div>
      </div>
    `;
    resumeList.appendChild(card);

    document.getElementById(`switch-${config.id}`).addEventListener('change', async (e) => {
      config.isActive = e.target.checked;
      config.nextExecutionAt = config.isActive ? Date.now() : null;
      await chrome.storage.local.set({ resumes });
      await loadData();
      if (config.isActive) {
        chrome.runtime.sendMessage({ action: "triggerUpdate" }).catch(() => {});
      }
    });

    document.getElementById(`del-${config.id}`).addEventListener('click', async () => {
      if (confirm('Удалить эту конфигурацию?')) {
        const updated = resumes.filter(r => r.id !== config.id);
        await chrome.storage.local.set({ resumes: updated });
        await loadData();
      }
    });
  });
}

// 3. ДОСТУП К DOM ЭЛЕМЕНТАМ И СЛУШАТЕЛИ

const resumeList = document.getElementById('resumeList');
const editForm = document.getElementById('editForm');
const addBtn = document.getElementById('addBtn');
const cancelBtn = document.getElementById('cancelBtn');
const saveBtn = document.getElementById('saveBtn');

const resumeIdInput = document.getElementById('resumeId');
const resumeNameInput = document.getElementById('resumeName');
const intervalHoursInput = document.getElementById('intervalHours');
const intervalMinutesInput = document.getElementById('intervalMinutes');
const autoViewVacanciesInput = document.getElementById('autoViewVacancies');
const vacancyViewDurationInput = document.getElementById('vacancyViewDuration');
const vacancyViewDurationContainer = document.getElementById('vacancyViewDurationContainer');

const autoLikeVacanciesInput = document.getElementById('autoLikeVacancies');
const autoLikeContainer = document.getElementById('autoLikeContainer');
const likeKeywordsInput = document.getElementById('likeKeywords');
const minLikeMatchesInput = document.getElementById('minLikeMatches');
const minLikePercentageInput = document.getElementById('minLikePercentage');

const loggingToggle = document.getElementById('loggingToggle');
const toggleLogsCollapse = document.getElementById('toggleLogsCollapse');
const logConsoleContainer = document.getElementById('logConsoleContainer');
const extensionGlobalToggle = document.getElementById('extensionGlobalToggle');

const formTitle = document.getElementById('formTitle');

const vacancyCacheToggle = document.getElementById('vacancyCacheToggle');

// Объединенный и очищенный от дублей слушатель DOMContentLoaded
document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  await renderLogs();
  
  const data = await chrome.storage.local.get({ 
    loggingEnabled: true, 
    logsCollapsed: true, 
    extensionEnabled: true,
    vacancyCacheEnabled: true 
  });
  
  if (loggingToggle) {
    loggingToggle.checked = data.loggingEnabled !== false;
  }
  
  if (extensionGlobalToggle) {
    extensionGlobalToggle.checked = data.extensionEnabled !== false;
    updateGlobalStatusUI(extensionGlobalToggle.checked);
  }

  if (vacancyCacheToggle) {
    vacancyCacheToggle.checked = data.vacancyCacheEnabled !== false;
  }
  
  if (data.logsCollapsed === true) {
    if (logConsoleContainer) logConsoleContainer.classList.add('d-none');
    toggleLogsBtnText(false);
  } else {
    if (logConsoleContainer) logConsoleContainer.classList.remove('d-none');
    toggleLogsBtnText(true);
  }
});

if (vacancyCacheToggle) {
  vacancyCacheToggle.addEventListener('change', async (e) => {
    await chrome.storage.local.set({ vacancyCacheEnabled: e.target.checked });
  });
}

if (extensionGlobalToggle) {
  extensionGlobalToggle.addEventListener('change', async (e) => {
    const isEnabled = e.target.checked;
    await chrome.storage.local.set({ extensionEnabled: isEnabled });
    updateGlobalStatusUI(isEnabled);
    
    if (isEnabled) {
      chrome.runtime.sendMessage({ action: "triggerUpdate" }).catch(() => {});
    }
  });
}

if (autoViewVacanciesInput) {
  autoViewVacanciesInput.addEventListener('change', (e) => {
    if (e.target.checked) {
      vacancyViewDurationContainer.classList.remove('d-none');
    } else {
      vacancyViewDurationContainer.classList.add('d-none');
    }
  });
}

if (autoLikeVacanciesInput) {
  autoLikeVacanciesInput.addEventListener('change', (e) => {
    if (e.target.checked) {
      autoLikeContainer.classList.remove('d-none');
    } else {
      autoLikeContainer.classList.add('d-none');
    }
  });
}

if (toggleLogsCollapse) {
  toggleLogsCollapse.addEventListener('click', async () => {
    const isHidden = logConsoleContainer.classList.contains('d-none');
    await toggleLogsContainer(isHidden);
  });
}

const headerLogsTitle = document.getElementById('headerLogsTitle');
if (headerLogsTitle) {
  headerLogsTitle.addEventListener('click', async () => {
    const isHidden = logConsoleContainer.classList.contains('d-none');
    await toggleLogsContainer(isHidden);
  });
}

if (loggingToggle) {
  loggingToggle.addEventListener('change', async (e) => {
    await chrome.storage.local.set({ loggingEnabled: e.target.checked });
  });
}

const clearLogsBtn = document.getElementById('clearLogsBtn');
if (clearLogsBtn) {
  clearLogsBtn.addEventListener('click', async () => {
    await chrome.storage.local.set({ logs: [] });
    await renderLogs();
  });
}

const clearCacheBtn = document.getElementById('clearCacheBtn');
if (clearCacheBtn) {
  clearCacheBtn.addEventListener('click', async () => {
    if (confirm('Сбросить базу данных просмотренных вакансий? Ранее обойденные вакансии снова будут расцениваться как новые. Также будет немедленно перезапущен поиск вакансий.')) {
      
      await chrome.storage.local.set({ viewedVacancies: [] });
      
      const data = await chrome.storage.local.get({ resumes: [] });
      const resumes = data.resumes;
      
      const updatedResumes = resumes.map(config => {
        config.lastVacanciesViewedAt = 0; 
        if (config.isActive) {
          config.nextExecutionAt = Date.now(); 
        }
        return config;
      });
      
      await chrome.storage.local.set({ resumes: updatedResumes });
      await loadData();
      
      alert('Кэш успешно очищен. Поиск вакансий перезапускается...');
      
      try {
        await chrome.runtime.sendMessage({ action: "triggerUpdate" }).catch(() => {});
      } catch (err) {
        console.log("Запрос к фоновому процессу отложен до инициализации.");
      }
    }
  });
}

cancelBtn.addEventListener('click', () => {
  editConfigReset();
});

addBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let parsedId = '';
  let defaultName = 'Мое резюме';
  let extractedSkills = [];

  if (tab && tab.url) {
    const match = tab.url.match(/[a-f0-9]{38}/i);
    if (match) {
      parsedId = match[0].toLowerCase();
    }
    if (tab.title) {
      defaultName = tab.title.replace('— резюме на hh.ru', '').trim();
    }

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const tagElements = Array.from(document.querySelectorAll(
            '[data-qa^="skill-tag-"], [data-qa^="skill-tag-text"], [data-qa="bloko-tag__text"], div[class^="magritte-tag__label"], .bloko-tag__text, .magritte-tag__label, [class*="tag__label"]'
          ));
          const skillsList = tagElements
            .map(el => el.textContent.trim())
            .filter(Boolean);
          
          return Array.from(new Set(skillsList));
        }
      });

      if (results && results[0] && results[0].result) {
        extractedSkills = results[0].result;
      }
    } catch (e) {
      console.log("Парсинг тегов навыков недоступен на текущей странице:", e);
    }
  }

  const skillsString = extractedSkills.length > 0 ? extractedSkills.join(', ') : '';
  showForm('', defaultName, 4, 0, parsedId, true, 15, true, skillsString, 3, 60);
});

saveBtn.addEventListener('click', async () => {
  const id = resumeIdInput.value;
  const name = resumeNameInput.value.trim() || 'Без названия';
  const hours = parseInt(intervalHoursInput.value, 10) || 0;
  const minutes = parseInt(intervalMinutesInput.value, 10) || 0;
  const autoViewVacancies = autoViewVacanciesInput.checked;
  const vacancyViewDuration = parseInt(vacancyViewDurationInput.value, 10) || 15;
  
  const autoLikeVacancies = autoLikeVacanciesInput.checked;
  const likeKeywords = likeKeywordsInput.value.trim();
  const minLikeMatches = parseInt(minLikeMatchesInput.value, 10) || 3;
  const minLikePercentage = parseInt(minLikePercentageInput.value, 10) || 60;

  if (!id || id.length !== 38) {
    alert('Неверный формат ID резюме. Откройте вкладку с вашим резюме на hh.ru и попробуйте заново.');
    return;
  }

  if (hours === 0 && minutes === 0) {
    alert('Пожалуйста, укажите интервал больше 0 минут.');
    return;
  }

  const data = await chrome.storage.local.get({ resumes: [] });
  let resumes = data.resumes;

  const existingIndex = resumes.findIndex(r => r.id === id);
  if (existingIndex > -1) {
    resumes[existingIndex].name = name;
    resumes[existingIndex].intervalHours = hours;
    resumes[existingIndex].intervalMinutes = minutes;
    resumes[existingIndex].autoViewVacancies = autoViewVacancies;
    resumes[existingIndex].vacancyViewDuration = vacancyViewDuration;
    resumes[existingIndex].autoLikeVacancies = autoLikeVacancies;
    resumes[existingIndex].likeKeywords = likeKeywords;
    resumes[existingIndex].minLikeMatches = minLikeMatches;
    resumes[existingIndex].minLikePercentage = minLikePercentage;
    resumes[existingIndex].nextExecutionAt = Date.now();
    resumes[existingIndex].lastVacanciesViewedAt = 0; 
  } else {
    resumes.push({
      id: id,
      name: name,
      intervalHours: hours,
      intervalMinutes: minutes,
      autoViewVacancies: autoViewVacancies,
      vacancyViewDuration: vacancyViewDuration,
      autoLikeVacancies: autoLikeVacancies,
      likeKeywords: likeKeywords,
      minLikeMatches: minLikeMatches,
      minLikePercentage: minLikePercentage,
      isActive: true,
      lastExecutedAt: null,
      nextExecutionAt: Date.now(),
      lastErrorMessage: null,
      lastVacanciesViewedAt: 0
    });
  }

  await chrome.storage.local.set({ resumes });
  editConfigReset();
  await loadData();

  try {
    await chrome.runtime.sendMessage({ action: "triggerUpdate" }).catch(() => {});
  } catch (err) {
    console.log("Запрос к фоновому процессу отложен до инициализации.");
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "newLog") {
    renderLogs();
  }
});