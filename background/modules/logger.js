export async function logMessage(message, type = 'info') {
  const settings = await chrome.storage.local.get({ loggingEnabled: true });
  if (settings.loggingEnabled === false) {
    return;
  }

  const timestamp = new Date().toLocaleTimeString('ru-RU', { hour12: false });
  const logEntry = { timestamp, message, type };

  const data = await chrome.storage.local.get({ logs: [] });
  const logs = data.logs || [];
  logs.unshift(logEntry);

  if (logs.length > 40) {
    logs.pop(); 
  }
  await chrome.storage.local.set({ logs });

  chrome.runtime.sendMessage({ action: "newLog", log: logEntry }).catch(() => {
    // Игнорируем ошибку, если Popup в этот момент закрыт
  });
}