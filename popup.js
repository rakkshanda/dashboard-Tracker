const $ = (id) => document.getElementById(id);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const DEFAULT_STATUS = 'saved';

function getJobTag(title) {
  const t = (title || '').toLowerCase();
  if (/product|program|operations|project|account manager|category manager/.test(t)) return 'pm';
  if (/data|business intel|analyst/.test(t)) return 'data';
  return 'sde';
}

function getDefaultStatusForUrl(url) {
  return /linkedin\.com|joinhandshake\.com/i.test(url || '') ? 'applied' : 'saved';
}
// Buffer incoming messages until DOM + listeners are ready
let popupReady = false;
const pendingMessages = [];
let loadingTimer = null;
const LOADING_TIMEOUT_MS = 7000;

function startLoading() {
  try {
    document.getElementById('loadingMask').style.display = 'flex';
    ['company','title','location','jobId','url','description'].forEach(id => {
      const el = $(id);
      if (el) {
        el.classList.add('skeleton-loading');
        if (el.placeholder !== undefined) el.placeholder = 'Loading…';
      }
    });
    disableLocationTabs();
    disableStatusTabs();
  } catch {}
}

function stopLoading() {
  try {
    document.getElementById('loadingMask').style.display = 'none';
    ['company','title','location','jobId','url','description'].forEach(id => {
      const el = $(id);
      if (el) el.classList.remove('skeleton-loading');
    });
    enableLocationTabs();
    enableStatusTabs();
  } catch {}
}

const DRAFT_KEY = 'saveJobsDraft';
const isStandalone = location.hash.includes('standalone') || location.search.includes('standalone=1');

function saveDraft() {
  const draft = {
    company: $('company').value,
    title: $('title').value,
    location: $('location').value,
    jobId: $('jobId').value,
    status: getStatusValue(),
    source: $('source').value,
    url: $('url').value,
    description: $('description').value,
    ts: Date.now()
  };
  try { chrome.storage?.local?.set?.({ [DRAFT_KEY]: draft }); } catch {}
}

async function restoreDraft() {
  try {
    const data = await new Promise((resolve) => {
      try {
        chrome.storage?.local?.get?.(DRAFT_KEY, (res) => resolve(res?.[DRAFT_KEY]));
      } catch { resolve(null); }
    });
    if (data) {
      $('company').value = data.company || $('company').value;
      $('title').value = data.title || $('title').value;
      $('location').value = data.location || $('location').value;
      $('jobId').value = data.jobId || $('jobId').value;
      setStatusValue(data.status || $('status').value);
      $('source').value = data.source || $('source').value;
      $('url').value = data.url || $('url').value;
      $('description').value = data.description || $('description').value;
    }
  } catch {}
}

function cleanWhitespace(s = "") {
  // strip markdown bullets, headings, repeated newlines → single space
  return s
    .replace(/\r/g, "")
    .replace(/[*•●▪︎■◆]+/g, " ")        // bullets → space
    .replace(/^\s*[-–—]\s+/gm, " ")     // dash bullets → space
    .replace(/\n{2,}/g, " ")            // multi blank lines → space
    .replace(/\s*\n+\s*/g, " ")         // single newline → space
    .replace(/\s{2,}/g, " ")            // collapse spaces
    .trim();
}

function sanitizeCommas(s = "", allowCommas = false) {
  if (allowCommas) return s; // Don't remove commas from description
  return s.replace(/,/g, "").trim(); // Remove all commas from other fields
}

function setLocationTabActive(val = '') {
  const tabs = $$('#locationTabs .location-tab');
  tabs.forEach(btn => {
    const isActive = val && btn.dataset.value.toLowerCase() === val.toLowerCase();
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  });
}

function disableLocationTabs() {
  const wrap = $('locationTabs');
  if (wrap) wrap.classList.add('disabled');
  $$('#locationTabs .location-tab').forEach(btn => btn.disabled = true);
}

function enableLocationTabs() {
  const wrap = $('locationTabs');
  if (wrap) wrap.classList.remove('disabled');
  $$('#locationTabs .location-tab').forEach(btn => btn.disabled = false);
}

function setStatusValue(val = DEFAULT_STATUS) {
  const select = $('status');
  if (select) select.value = val || DEFAULT_STATUS;
  const tabs = $$('#statusTabs .status-tab');
  tabs.forEach(btn => {
    const isActive = btn.dataset.value === (val || DEFAULT_STATUS);
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  });
}

function getStatusValue() {
  const active = document.querySelector('#statusTabs .status-tab.active');
  if (active) return active.dataset.value;
  const select = $('status');
  return select ? select.value : DEFAULT_STATUS;
}

function disableStatusTabs() {
  const wrap = $('statusTabs');
  if (wrap) wrap.classList.add('disabled');
  $$('#statusTabs .status-tab').forEach(btn => btn.disabled = true);
  if ($('status')) $('status').disabled = true;
}

function enableStatusTabs() {
  const wrap = $('statusTabs');
  if (wrap) wrap.classList.remove('disabled');
  $$('#statusTabs .status-tab').forEach(btn => btn.disabled = false);
  if ($('status')) $('status').disabled = false;
}

async function getTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function runInPage(tabId, func, args = []) {
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return result;
}

// 🔧 Scrape current page using injected scrape.js and enforce TikTok jobId
async function scrapeFromPage(tabId) {
  console.log('Starting scrapeFromPage for tab:', tabId);
  
  // Inject scrape.js so window.__scrapeJob exists
  await chrome.scripting.executeScript({ target: { tabId }, files: ['scrape.js'] });

  // IMPORTANT: await runInPage so we get the actual object, not a Promise
  const scrapedData = await runInPage(tabId, () => {
    const data = window.__scrapeJob?.() || {};
    try {
      const href = location.href || '';

      // TikTok referral override: enforce company + jobId
      if (href.startsWith('https://lifeattiktok.com/referral/tiktok/')) {
        data.company = 'TikTok';

        // Derive jobId from path if missing
        if (!data.jobId && !data.job_id) {
          const parts = location.pathname.split('/').filter(Boolean);
          // e.g. /referral/tiktok/A122000 → ['referral','tiktok','A122000']
          if (parts.length >= 3) data.jobId = parts[2];
        }

        // Last-ditch fallback: try to extract "Job ID: X" from page text
        if (!data.jobId && !data.job_id) {
          const fullText = (document.body.innerText || '').trim();
          const match = fullText.match(/Job ID[:\s]*([A-Za-z0-9\-]+)/i);
          if (match && match[1]) data.jobId = match[1];
        }
      }
    } catch (e) {
      // Ignore errors; we still return whatever we have
    }
    return data;
  });
  
  console.log('Raw scraped data:', scrapedData);
  
  // Get page content for potential future use
  const pageContent = await runInPage(tabId, () => {
    const jobContent = document.querySelector('.jobs-unified-top-card, .job-details-jobs-unified-top-card, main, .jobs-description-content') || document.body;
    return jobContent.innerText || document.body.innerText || '';
  });
  
  console.log('Page content length:', pageContent.length);
  console.log('[AI] Enhancement disabled. Using scraped data only.');
  return scrapedData || {};
}

// Central message handler for data coming from the floating iframe parent
function handleParentMessage(event) {
  const msg = event.data || {};
  if (!popupReady) {
    pendingMessages.push(msg);
    return; // will be processed once ready
  }
  if (msg.type === 'SCRAPING_STARTED') {
    // Ignore auto-start signals; popup stays idle/blank until user acts
    return;
  } else if (msg.type === 'SCRAPED_DATA' && msg.data) {
    if (loadingTimer) { clearTimeout(loadingTimer); loadingTimer = null; }
    stopLoading();
    const d = msg.data || {};
    // Only populate when data is complete enough
    const complete = !!(d.title && d.company && d.location && d.description);
    if (!complete) {
      console.log('[Popup] Incomplete data received; keeping placeholders and populating best-effort.');
    }
    $('company').value = d.company || $('company').value;
    $('title').value = d.title || $('title').value;
    $('location').value = d.location || $('location').value;
    $('jobId').value = d.job_id || d.jobId || $('jobId').value;
    $('url').value = d.url || $('url').value;
    $('description').value = d.description || $('description').value;
    markMissing();
    saveDraft();
  }
}

// Attach early listener to buffer messages arriving before DOM ready
window.addEventListener('message', handleParentMessage);

// When DOM is ready, mark ready and flush any buffered messages
document.addEventListener('DOMContentLoaded', () => {
  popupReady = true;
  // Process any pending messages in order
  while (pendingMessages.length) {
    handleParentMessage({ data: pendingMessages.shift() });
  }
});

async function getMetaGuess(tabId) {
  return runInPage(tabId, () => {
    const g = (sel, attr) => (document.querySelector(sel)?.getAttribute(attr) || '').trim();
    return {
      ogSite: g('meta[property="og:site_name"]','content'),
      twitterSite: g('meta[name="twitter:site"]','content').replace(/^@/, ''),
      ogTitle: g('meta[property="og:title"]','content'),
      title: document.title || ''
    };
  });
}

function companyFromHost(host) {
  const map = {
    // Government & Education
    'auburnwa.gov': 'City of Auburn',
    'governmentjobs.com': 'City of Auburn',
    'attract.neogov.com': 'City of Auburn',
    'neogov.com': 'City of Auburn',
    'usajobs.gov': 'U.S. Government',
    'jobs.ca.gov': 'State of California',
    'nyc.gov': 'City of New York',
    
    // Tech Companies
    'joinbytedance.com': 'ByteDance',
    'tiktok.com': 'TikTok',
    'careers.google.com': 'Google',
    'amazonjobs.com': 'Amazon',
    'meta.com': 'Meta',
    'microsoft.com': 'Microsoft',
    'apple.com': 'Apple',
    'netflix.com': 'Netflix',
    'spotify.com': 'Spotify',
    'uber.com': 'Uber',
    'airbnb.com': 'Airbnb',
    'salesforce.com': 'Salesforce',
    'oracle.com': 'Oracle',
    'ibm.com': 'IBM',
    'intel.com': 'Intel',
    'nvidia.com': 'NVIDIA',
    'amd.com': 'AMD',
    'cisco.com': 'Cisco',
    'vmware.com': 'VMware',
    'adobe.com': 'Adobe',
    'autodesk.com': 'Autodesk',
    'servicenow.com': 'ServiceNow',
    'workday.com': 'Workday',
    'snowflake.com': 'Snowflake',
    'databricks.com': 'Databricks',
    'palantir.com': 'Palantir',
    'stripe.com': 'Stripe',
    'squareup.com': 'Square',
    'paypal.com': 'PayPal',
    'visa.com': 'Visa',
    'mastercard.com': 'Mastercard',
    'americanexpress.com': 'American Express',
    
    // Job Boards (empty - let scraping handle it)
    'greenhouse.io': '',
    'lever.co': '',
    'myworkdayjobs.com': '',
    'ashbyhq.com': '',
    'smartrecruiters.com': '',
    'joinhandshake.com': '',
    'app.joinhandshake.com': '',
    'wellfound.com': '',
    'angel.co': '',
    'indeed.com': '',
    'glassdoor.com': '',
    'ziprecruiter.com': '',
    'monster.com': '',
    'dice.com': '',
    'careerbuilder.com': '',
    'simplyhired.com': '',
    'flexjobs.com': '',
    'stackoverflow.com': '',
    'github.com': '',
    'remote.co': '',
    'weworkremotely.com': '',
    'remotive.io': '',
    'jobspresso.co': '',
    'pangian.com': '',
    'skip-the-line.com': '',
    'authenticjobs.com': '',
    'dribbble.com': '',
    'behance.net': '',
    'upwork.com': '',
    'freelancer.com': '',
    'fiverr.com': '',
    'toptal.com': '',
    'guru.com': '',
    'peopleperhour.com': '',
    '99designs.com': '',
    'designcrowd.com': '',
    'crowdspring.com': '',
    'moonlight.com': '',
    'gun.io': '',
    'codementor.io': '',
    'mentorcruise.com': '',
    'hackerrank.com': '',
    'leetcode.com': '',
    'codewars.com': '',
    'topcoder.com': '',
    'codechef.com': '',
    'hackerearth.com': '',
    'interviewbit.com': '',
    'geeksforgeeks.org': '',
    'freecodecamp.org': '',
    'udemy.com': '',
    'coursera.org': '',
    'edx.org': '',
    'khanacademy.org': '',
    'pluralsight.com': '',
    'linkedin.com': '',
    'twitter.com': '',
    'facebook.com': '',
    'instagram.com': '',
    'youtube.com': '',
    'tiktok.com': '',
    'snapchat.com': '',
    'pinterest.com': '',
    'reddit.com': '',
    'discord.com': '',
    'slack.com': '',
    'zoom.us': '',
    'teams.microsoft.com': '',
    'webex.com': '',
    'gotomeeting.com': '',
    'skype.com': '',
    'whatsapp.com': '',
    'telegram.org': '',
    'signal.org': '',
    'viber.com': '',
    'line.me': '',
    'wechat.com': '',
    'kik.com': ''
  };
  return map[host.replace(/^www\./, '')] ?? '';
}

function guessLocationFromText(text) {
  const t = (text || '').replace(/\s+/g, ' ');
  const patterns = [
    /\b(Remote(?:\s*-\s*[A-Za-z]+)?)\b/i,
    /\bHybrid\b/i,
    /\bOn[- ]site\b/i,
    // common cities (add more if you like)
    /\b(?:Auburn|Seattle|San Francisco|New York|Boston|Austin|Los Angeles|Chicago|London|Dublin|Bangalore|Hyderabad|Toronto|Vancouver|Montreal|Denver|Portland)(?:,\s*[A-Z]{2})?\b/i,
    /\b[A-Za-z ]+,\s*[A-Z]{2}\b/
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m) return m[0];
  }
  return '';
}

// Hardcoded GAS URL (yours)
function getWebAppUrl() {
  // Your deployed Google Apps Script Web App URL
  return 'https://script.google.com/macros/s/AKfycbzYdQ1COnYE_LhnAOTE8hPNh7hVwDYsHRXUwn9JFzlys9ocL3EH7V3JP5p_D9mNU_GkUA/exec';
}

// Supabase configuration
const SUPABASE_URL = window.ENV_SUPABASE_URL;
const SUPABASE_KEY = window.ENV_SUPABASE_KEY;

async function saveRow(payload) {
  console.log('=== SAVING JOB TO SUPABASE ===');
  console.log('Payload:', payload);
  
  // final normalization before sending
  payload.company = sanitizeCommas(payload.company);
  payload.title = sanitizeCommas(payload.title);
  payload.location = sanitizeCommas(payload.location);
  payload.jobId = sanitizeCommas(payload.jobId);
  payload.url = sanitizeCommas(payload.url);
  payload.description = cleanWhitespace(payload.description);
  
  console.log('Normalized payload:', payload);
  
  // Get today's date in YYYY-MM-DD format
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  const todayDate = `${year}-${month}-${day}`;
  
  // Prepare Supabase payload
  // Initialize status history with the first status
  const initialStatusHistory = [{
    status: payload.status || DEFAULT_STATUS,
    timestamp: new Date().toISOString(),
    date: new Date().toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }];

  const supabasePayload = {
    title: payload.title || '',
    company: payload.company || '',
    location: payload.location || '',
    job_id: payload.jobId || '',
    status: payload.status || DEFAULT_STATUS,
    applied_date: todayDate,
    url: payload.url || '',
    description: payload.description || '',
    notes: '',
    comments: '',
    source: payload.source || 'URL',
    favorite: payload.favorite || false,
    role_tag: payload.role_tag || 'sde',
    status_history: initialStatusHistory
  };
  
  console.log('Supabase payload:', supabasePayload);
  
  try {
    console.log('📊 Saving to Supabase...');
    
    // Use fetch to insert into Supabase
    const response = await fetch(`${SUPABASE_URL}/rest/v1/jobs`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(supabasePayload)
    });
    
    console.log('Supabase response status:', response.status);
    
    if (response.ok) {
      const result = await response.json();
      console.log('✅ Successfully saved to Supabase:', result);
      
      // STEP 2: Also save to Chrome storage as backup
      try {
        const storageResult = await chrome.storage.local.get(['savedJobs']);
        const savedJobs = storageResult.savedJobs || [];
        
        const jobWithId = {
          ...result[0],
          savedAt: new Date().toISOString()
        };
        
        savedJobs.push(jobWithId);
        await chrome.storage.local.set({ savedJobs });
        console.log('✅ Also saved to Chrome storage');
      } catch (storageError) {
        console.warn('Could not save to Chrome storage:', storageError);
      }
      
      // STEP 3: Notify dashboard to refresh
      notifyDashboardRefresh();
      
      return { 
        success: true, 
        message: 'Job saved to Supabase!',
        supabaseSaved: true
      };
    } else {
      const errorText = await response.text();
      console.error('❌ Supabase save failed:', response.status, errorText);
      return {
        success: false,
        message: 'Failed to save to Supabase: ' + errorText,
        supabaseSaved: false
      };
    }
  } catch (error) {
    console.error('❌ Error saving to Supabase:', error);
    return {
      success: false,
      message: 'Error: ' + error.message,
      supabaseSaved: false
    };
  }
}

async function notifyDashboardRefresh() {
  console.log('Job saved to Supabase');
}

function markMissing() {
  ['company','title','location','url'].forEach(id => {
    const el = $(id);
    el.classList.toggle('missing', !el.value.trim());
  });
}

function clearFields() {
  // Clear all form fields
  $('company').value = '';
  $('title').value = '';
  $('location').value = '';
  $('jobId').value = '';
  setStatusValue(DEFAULT_STATUS); // Reset to default
  enableStatusTabs();
  setLocationTabActive('');
  enableLocationTabs();
  $('url').value = '';
  $('description').value = '';
  
  // Clear the draft from storage
  try { chrome.storage?.local?.remove?.(DRAFT_KEY); } catch {}
  
  // Update character count
  $('descCount').textContent = '0 chars';
  
  // Remove validation styling
  ['company','title','location','jobId','url'].forEach(id => {
    $(id).classList.remove('missing');
  });
}

// Main popup init
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 Popup DOMContentLoaded - Initializing...');
  console.log('📍 Save button exists?', !!$('save'));
  console.log('📍 Clear button exists?', !!$('clearTop'));
  console.log('📍 Redo button exists?', !!$('redoTop'));
  console.log('📍 Close button exists?', !!$('close'));

  // Location tabs wiring
  const locationTabButtons = $$('#locationTabs .location-tab');
  if (locationTabButtons.length) {
    locationTabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.value || btn.textContent.trim();
        $('location').value = val;
        setLocationTabActive(val);
        saveDraft();
        markMissing();
      });
    });
  }

  // Status tabs wiring
  const statusTabButtons = $$('#statusTabs .status-tab');
  if (statusTabButtons.length) {
    statusTabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        setStatusValue(btn.dataset.value);
        saveDraft();
      });
    });
    setStatusValue(DEFAULT_STATUS);
  }
  
  // Will be populated by postMessage from floating button
  let scrapedData = null;
  
  // Skeleton loading helpers
  function showSkeletonLoading() {
    console.log('💀 Showing skeleton loading animation');
    const fields = ['company', 'title', 'location', 'url', 'description', 'source'];
    fields.forEach(id => {
      const field = $(id);
      if (field) {
        field.classList.add('skeleton-loading');
        field.disabled = true;
      }
    });
    disableLocationTabs();
    disableStatusTabs();
  }
  
  function hideSkeletonLoading() {
    console.log('✅ Hiding skeleton loading animation');
    const fields = ['company', 'title', 'location', 'url', 'description', 'source'];
    fields.forEach(id => {
      const field = $(id);
      if (field) {
        field.classList.remove('skeleton-loading');
        field.disabled = false;
      }
    });
    enableLocationTabs();
    enableStatusTabs();
  }
  
  // Auto-detect source from URL
  function detectSource(url) {
    if (!url) return 'URL';
    const urlLower = url.toLowerCase();
    if (urlLower.includes('linkedin.com')) return 'LinkedIn';
    if (urlLower.includes('handshake')) return 'Handshake';
    if (urlLower.includes('indeed.com')) return 'Indeed';
    return 'URL';
  }
  
  // Listen for scraped data from floating button (main path)
  window.addEventListener('message', (event) => {
    console.log('📨 Received message:', event.data);
    
    if (event.data && event.data.type === 'SCRAPING_STARTED') {
      console.log('🔄 Scraping started signal ignored (no auto-fill).');
      return;
    }
    
    if (event.data && event.data.type === 'SCRAPED_DATA') {
      console.log('📦 Received scraped data from floating button:', event.data.data);
      scrapedData = event.data.data || {};
      
      hideSkeletonLoading();
      
      enableStatusTabs();
      setStatusValue(getDefaultStatusForUrl(scrapedData.url));
      setLocationTabActive(scrapedData.location || '');

      // 🔐 Ensure TikTok jobId is present if this is a TikTok referral URL
      try {
        const urlStr = scrapedData.url || '';
        if (urlStr.startsWith('https://lifeattiktok.com/referral/tiktok/')) {
          scrapedData.company = scrapedData.company || 'TikTok';

          if (!scrapedData.job_id && !scrapedData.jobId) {
            const urlObj = new URL(urlStr);
            const parts = urlObj.pathname.split('/').filter(Boolean);
            // /referral/tiktok/A122000 -> ['referral','tiktok','A122000']
            if (parts.length >= 3) {
              scrapedData.jobId = parts[2];
            }
          }

          // Final fallback: try to parse from description text
          if (!scrapedData.job_id && !scrapedData.jobId && scrapedData.description) {
            const match = scrapedData.description.match(/Job ID[:\s]*([A-Za-z0-9\-]+)/i);
            if (match && match[1]) {
              scrapedData.jobId = match[1];
            }
          }
        }
      } catch (e) {
        // ignore
      }

      // Populate form with scraped data
      if (scrapedData && scrapedData.title) {
        console.log('✅ Populating form with scraped data');
        $('company').value = sanitizeCommas(scrapedData.company || '');
        $('title').value = sanitizeCommas(scrapedData.title || '');
        $('location').value = sanitizeCommas(scrapedData.location || '');
        setLocationTabActive(scrapedData.location || '');
        $('jobId').value = sanitizeCommas(scrapedData.job_id || scrapedData.jobId || '');
        $('description').value = scrapedData.description || '';
        $('url').value = scrapedData.url || '';
        
        const detectedSource = detectSource(scrapedData.url);
        $('source').value = detectedSource;
        setRoleTag(getJobTag(scrapedData.title));
        console.log('🔍 Auto-detected source:', detectedSource);
        console.log('🆔 Job ID:', scrapedData.job_id || scrapedData.jobId || 'Not found');
        
      } else {
        console.log('⚠️ Scraped data missing title; not auto-populating.');
      }
    }
  });

  const tab = await getTab();
  if (!scrapedData) {
    const currentUrl = tab.url || '';
    $('url').value = currentUrl;
    $('source').value = detectSource(currentUrl);
  }
  setStatusValue(getDefaultStatusForUrl(tab && tab.url));

  if (isStandalone) {
    document.title = 'Save Job — Sticky Editor';
  }

  // Draggable
  const dragHandle = $('dragHandle');
  if (dragHandle) {
    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;

    function startDrag(e) {
      isDragging = true;
      const rect = document.body.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
    }

    function drag(e) {
      if (!isDragging) return;
      const x = e.clientX - offsetX;
      const y = e.clientY - offsetY;
      document.body.style.position = 'fixed';
      document.body.style.left = x + 'px';
      document.body.style.top = y + 'px';
    }

    function stopDrag() {
      isDragging = false;
      savePosition();
    }

    function savePosition() {
      const rect = document.body.getBoundingClientRect();
      try {
        chrome.storage?.local?.set?.({
          popupPosition: { left: rect.left, top: rect.top }
        });
      } catch {}
    }

    async function restorePosition() {
      try {
        const data = await new Promise((resolve) => {
          try {
            chrome.storage?.local?.get?.('popupPosition', (res) => resolve(res?.popupPosition));
          } catch { resolve(null); }
        });
        if (data) {
          document.body.style.position = 'fixed';
          document.body.style.left = data.left + 'px';
          document.body.style.top = data.top + 'px';
        }
      } catch {}
    }

    dragHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startDrag(e);
    });
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', stopDrag);
    
    dragHandle.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      startDrag(touch);
    });
    document.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      drag(touch);
    });
    document.addEventListener('touchend', stopDrag);
    
    await restorePosition();
  }

  // Auto-scrape on open (same logic as redo button)
  console.log('ℹ️ Auto-scraping on popup open...');
  try {
    const autoScraped = await scrapeFromPage(tab.id);
    if (autoScraped && autoScraped.title) {
      $('company').value     = sanitizeCommas(autoScraped.company || '');
      $('title').value       = sanitizeCommas(autoScraped.title || '');
      $('location').value    = sanitizeCommas(autoScraped.location || '');
      setLocationTabActive(autoScraped.location || '');
      $('jobId').value       = sanitizeCommas(autoScraped.job_id || autoScraped.jobId || '');
      $('url').value         = sanitizeCommas(autoScraped.url || tab.url || '');
      $('description').value = autoScraped.description || '';
      $('source').value      = detectSource(autoScraped.url);
      setStatusValue(getDefaultStatusForUrl(tab.url));
    }
  } catch (e) {
    console.warn('Auto-scrape on open failed:', e);
  }
  // Auto-select role tag from title
  if ($('title').value) setRoleTag(getJobTag($('title').value));

  // Secondary guesses — only fill still-empty fields
  const meta = await getMetaGuess(tab.id);
  if (!$('company').value) {
    $('company').value = sanitizeCommas(
      meta.ogSite ||
      meta.twitterSite ||
      companyFromHost(new URL(tab.url).hostname) ||
      (meta.title.match(/\b(?:City|County|State|University|College) of [A-Za-z ]+/i)?.[0] || '')
    );
  }
  if (!$('location').value) {
    $('location').value = sanitizeCommas(
      guessLocationFromText($('description').value || meta.ogTitle || meta.title) ||
      (/auburnwa\.gov|neogov|governmentjobs\.com/i.test(tab.url) ? 'Auburn, WA' : '')
    );
  }

  await restoreDraft();

  // live counter
  const updateCount = () => $('descCount').textContent = `${$('description').value.length} chars`;
  updateCount();
  $('description').addEventListener('input', () => {
    const cur = $('description').value;
    const cleaned = cur.replace(/\r/g, '').replace(/\s*\n+\s*/g, ' ');
    if (cur !== cleaned) $('description').value = cleaned;
    updateCount();
  });

  // persist on any field change and sanitize commas in real-time
  ['company','title','location','jobId','url'].forEach(id => {
    $(id).addEventListener('input', (e) => {
      const originalValue = e.target.value;
      const sanitizedValue = sanitizeCommas(originalValue);
      if (originalValue !== sanitizedValue) {
        e.target.value = sanitizedValue;
      }
      if (id === 'location') {
        setLocationTabActive(e.target.value);
      }
      saveDraft();
    });
    $(id).addEventListener('change', saveDraft);
  });
  
  // Description field - no comma sanitization
  $('description').addEventListener('input', saveDraft);
  $('description').addEventListener('change', saveDraft);

  markMissing();

  // guess buttons (optional - only if they exist in HTML)
  const guessCompanyBtn = $('guessCompany');
  if (guessCompanyBtn) {
    guessCompanyBtn.onclick = () => {
      $('company').value ||= sanitizeCommas(
        companyFromHost(new URL(tab.url).hostname) ||
        meta.ogSite || meta.twitterSite ||
        (meta.title.match(/\b(?:City|County|State|University|College) of [A-Za-z ]+/i)?.[0] || '')
      );
      markMissing();
    };
  }
  
  const guessLocationBtn = $('guessLocation');
  if (guessLocationBtn) {
    guessLocationBtn.onclick = () => {
      $('location').value ||= sanitizeCommas(
        guessLocationFromText($('description').value || meta.ogTitle || meta.title) ||
        (/auburnwa\.gov|neogov|governmentjobs\.com/i.test(tab.url) ? 'Auburn, WA' : '')
      );
      setLocationTabActive($('location').value);
      markMissing();
    };
  }

  // sticky editor link
  const sticky = $('openStandalone');
  if (sticky) {
    sticky.onclick = async () => {
      try {
        saveDraft();
        const url = chrome.runtime.getURL('popup.html#standalone');
        await chrome.tabs.create({ url });
      } catch {
        const url = chrome.runtime.getURL('popup.html#standalone');
        try { chrome.windows.create({ url, type: 'popup', width: 440, height: 700 }); } catch {}
      }
    };
  }

  // Save
  const saveBtn = $('save');
  if (!saveBtn) {
    console.error('❌ Save button not found!');
    return;
  }
  console.log('✅ Save button found, attaching event listener');
  saveBtn.addEventListener('click', async () => {
    console.log('💾 Save button clicked!');
    const btn = $('save');
    const progress = $('progress');
    const setStatus = (type, msg) => {
      const statusEl = $('statusMessage');
      if (statusEl) statusEl.textContent = msg || '';
      btn.classList.remove('saving','success','error');
      if (type) btn.classList.add(type);
    };
  
    const payload = {
      company: $('company').value.trim(),
      title: $('title').value.trim(),
      location: $('location').value.trim(),
      jobId: $('jobId').value.trim(),
      status: getStatusValue(),
      source: $('source').value,
      url: $('url').value.trim(),
      description: $('description').value.trim(),
      favorite: isStarred,
      role_tag: getActiveRoleTag()
    };
  
    const missingTitle = !payload.title;
    const missingUrl = !payload.url;
    const hint = $('validationHint');
    if (missingTitle || missingUrl) {
      if (hint) hint.style.display = '';
      $('title').classList.toggle('missing', missingTitle);
      $('url').classList.toggle('missing', missingUrl);
      setStatus('error', 'Need at least a job title + link.');
      btn.classList.add('error');
      return;
    } else {
      if (hint) hint.style.display = 'none';
    }
  
    try {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>Saving…';
      setStatus('saving', 'Saving to Supabase…');
      progress.style.width = '35%';
  
      await saveRow(payload);
      try { chrome.storage?.local?.remove?.(DRAFT_KEY); } catch {}
      progress.style.width = '100%';
  
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'JOB_SAVED' }, '*');
        console.log('📤 Sent JOB_SAVED message to parent window');
      }
  
      setTimeout(() => {
        btn.innerHTML = 'Saved ✓';
        setStatus('success', 'Saved to Supabase & Dashboard!');
        clearFields();
      }, 150);

      setTimeout(() => {
        btn.disabled = false;
        btn.classList.remove('saving','error');
        btn.classList.add('success');
        progress.style.width = '0%';
        setTimeout(() => { btn.classList.remove('success'); btn.textContent = 'Save Job'; }, 1200);
      }, 600);
  
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Save Job';
      progress.style.width = '0%';
      setStatus('error', 'Could not save. Check your network connection.');
    }
  });
  

  // clear fields button (top)
  // Star toggle
  let isStarred = false;
  const starBtn = $('starToggle');
  if (starBtn) {
    starBtn.addEventListener('click', () => {
      isStarred = !isStarred;
      starBtn.textContent = isStarred ? '★' : '☆';
      starBtn.style.color = isStarred ? '#f5a623' : '#aaa';
      starBtn.setAttribute('aria-pressed', isStarred);
      starBtn.title = isStarred ? 'Starred — click to unstar' : 'Star this job';
    });
  }

  // Role tag tabs
  const roleTagBtns = $$('#roleTagTabs .role-tag-tab');
  function setRoleTag(tag) {
    roleTagBtns.forEach(b => {
      const active = b.dataset.tag === tag;
      b.style.opacity = active ? '1' : '0.45';
      b.style.fontWeight = active ? '700' : '500';
      b.style.boxShadow = active ? '0 0 0 2px currentColor' : 'none';
    });
  }
  function getActiveRoleTag() {
    const active = roleTagBtns.find(b => b.style.opacity === '1' || b.style.fontWeight === '700');
    return active ? active.dataset.tag : 'sde';
  }
  roleTagBtns.forEach(b => b.addEventListener('click', () => setRoleTag(b.dataset.tag)));
  // Default: sde
  setRoleTag('sde');

  const clearBtn = $('clearTop');
  if (clearBtn) {
    console.log('✅ Clear button found, attaching event listener');
    clearBtn.addEventListener('click', () => {
      console.log('🧹 Clear button clicked!');
      isStarred = false;
      if (starBtn) { starBtn.textContent = '☆'; starBtn.style.color = '#aaa'; starBtn.setAttribute('aria-pressed', false); }
      setRoleTag('sde');
      clearFields();
    });
  } else {
    console.error('❌ Clear button not found!');
  }

  // redo button (clear and refetch)
  const redoBtn = $('redoTop');
  if (redoBtn) {
    console.log('✅ Redo button found, attaching event listener');
    redoBtn.addEventListener('click', async () => {
      console.log('🔄 Redo button clicked!');
      try {
        clearFields();
        const statusMsg = $('statusMessage');
        if (statusMsg) statusMsg.textContent = 'Refetching job data...';
      
        const tab = await getTab();
        const scrapedData = await scrapeFromPage(tab.id);
      
        if (scrapedData) {
          $('company').value = sanitizeCommas(scrapedData.company || '');
          $('title').value = sanitizeCommas(scrapedData.title || '');
          $('location').value = sanitizeCommas(scrapedData.location || '');
          setLocationTabActive(scrapedData.location || '');
          $('url').value = sanitizeCommas(scrapedData.url || tab.url || '');
          $('description').value = cleanWhitespace(scrapedData.description || '');
          $('jobId').value = sanitizeCommas(scrapedData.job_id || scrapedData.jobId || '');
        
          updateCount();
        
          if (statusMsg) {
            statusMsg.textContent = 'Job data refetched successfully!';
            setTimeout(() => { statusMsg.textContent = ''; }, 2000);
          }
        } else {
          if (statusMsg) {
            statusMsg.textContent = 'No job data found on this page';
            setTimeout(() => { statusMsg.textContent = ''; }, 2000);
          }
        }
      } catch (error) {
        console.error('Error refetching job data:', error);
        if (statusMsg) {
          statusMsg.textContent = 'Error refetching data';
          setTimeout(() => { statusMsg.textContent = ''; }, 2000);
        }
      }
    });
  } else {
    console.error('❌ Redo button not found!');
  }

  // close button
  const closeBtn = $('close');
  if (closeBtn) {
    console.log('✅ Close button found, attaching event listener');
    closeBtn.addEventListener('click', () => {
      console.log('❌ Close button clicked!');
      if (isStandalone || location.search.includes('standalone=1')) {
        window.parent.postMessage({ type: 'CLOSE_POPUP' }, '*');
      } else {
        window.close();
      }
    });
  }

  // shortcuts
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); $('save').click(); }
    if (e.key === 'Escape' && !isStandalone) { e.preventDefault(); window.close(); }
  });
});
