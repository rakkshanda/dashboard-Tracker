// Background script — runs in extension context, bypasses page CSP

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Scrape the sender's tab using chrome.scripting (bypasses page CSP)
  if (request.type === 'SCRAPE_TAB') {
    const tabId = sender.tab?.id;
    if (!tabId) { sendResponse({ data: {} }); return true; }
    (async () => {
      try {
        // Inject scrape.js — runs in tab context, defines window.__scrapeJob
        await chrome.scripting.executeScript({ target: { tabId }, files: ['scrape.js'] });
        // Call the scraper and return the data
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => { try { return window.__scrapeJob?.() || {}; } catch(e) { return {}; } }
        });
        sendResponse({ data: result || {} });
      } catch (e) {
        console.error('SCRAPE_TAB error:', e.message);
        sendResponse({ data: {} });
      }
    })();
    return true; // keep channel open for async response
  }

  if (request.action === 'fetchGoogleSheetsData') {
    fetchGoogleSheetsData()
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

async function fetchGoogleSheetsData() {
  try {
    const webAppUrl = 'https://script.google.com/macros/s/AKfycbzwN1y4zUaXqc8REobORUrt7wizOfAlJwTHZBG6Y5DZCEiKPUXx_NjuVvHqALm-SLI/exec';
    
    const response = await fetch(webAppUrl, {
      method: 'GET',
      mode: 'cors'
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching from Google Sheets:', error);
    throw error;
  }
}


