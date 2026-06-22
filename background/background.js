import { logMessage } from './modules/logger.js';
import { processPendingUpdates } from './modules/scheduler.js';

chrome.runtime.onInstalled.addListener(async () => {
  chrome.alarms.create("checkUpdates", { periodInMinutes: 5 });
  await logMessage("Планировщик расширения запущен на устройстве.", "success");
  processPendingUpdates(); 
});

chrome.runtime.onStartup.addListener(async () => {
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