// Floating button content script - injected into web pages
(function() {
  'use strict';

  // Check if button already exists
  if (document.getElementById('job-tracker-floating-btn')) {
    return;
  }


  // Create floating button
  const floatingBtn = document.createElement('div');
  floatingBtn.id = 'job-tracker-floating-btn';
  floatingBtn.innerHTML = `
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor"><path d="M8 3v10M3 8h10"/></svg>
  `;

  // Styles for floating button
  const styles = `
    #job-tracker-floating-btn {
      position: fixed;
      bottom: 28px;
      right: 28px;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: #FF5C2C;
      color: #0E0E10;
      border: 2.5px solid #0E0E10;
      box-shadow: 5px 5px 0 #0E0E10;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: all .15s ease;
      cursor: pointer;
      z-index: 999998;
    }

    #job-tracker-floating-btn:hover { transform: translate(-2px, -2px); box-shadow: 7px 7px 0 #0E0E10; }
    #job-tracker-floating-btn:active { transform: translate(2px, 2px); box-shadow: 2px 2px 0 #0E0E10; }
    #job-tracker-floating-btn svg { width: 22px; height: 22px; stroke-width: 2.5; }

    #job-tracker-floating-btn.active {
      background: #FFD93D;
    }

    #job-tracker-floating-btn.saving {
      animation: shrinkPulse 0.6s ease-in-out;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    @keyframes shrinkPulse {
      0% {
        transform: scale(1);
      }
      50% {
        transform: scale(0.7);
      }
      100% {
        transform: scale(1);
      }
    }

    /* Popup container */
    #job-tracker-popup-container {
      position: fixed;
      bottom: 96px;
      right: 24px;
      width: 440px;
      height: 440px;
      max-height: 90vh;
      background: #F2EFE8;
      border: 2px solid #0E0E10;
      border-radius: 18px;
      box-shadow: 8px 8px 0 #0E0E10;
      z-index: 999999;
      overflow: hidden;
      display: none;
    }

    #job-tracker-popup-container.visible {
      display: flex;
      flex-direction: column;
    }

    #job-tracker-popup-container.dragging {
      cursor: grabbing;
      opacity: 0.95;
    }

    @keyframes slideInUp {
      from {
        opacity: 0;
        transform: translateY(20px) scale(0.95);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    /* Drag handle */
    #job-tracker-drag-handle {
      width: 100%;
      height: 36px;
      background: #FF5C2C;
      border-bottom: 1.5px solid #0E0E10;
      cursor: grab;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      flex-shrink: 0;
    }

    #job-tracker-drag-handle:active {
      cursor: grabbing;
    }

    #job-tracker-drag-handle::before {
      content: '';
      width: 40px;
      height: 4px;
      background: rgba(255, 255, 255, 0.5);
      border-radius: 2px;
    }

    #job-tracker-popup-iframe {
      width: 100%;
      height: 100%;
      border: none;
      display: block;
      flex: 1;
    }

    /* Draggable styles */
    #job-tracker-floating-btn.dragging {
      cursor: grabbing;
      opacity: 0.8;
    }
  `;

  // Add styles to page
  const styleSheet = document.createElement('style');
  styleSheet.textContent = styles;
  document.head.appendChild(styleSheet);

  // Create popup container
  const popupContainer = document.createElement('div');
  popupContainer.id = 'job-tracker-popup-container';

  // Create drag handle (top)
  const dragHandle = document.createElement('div');
  dragHandle.id = 'job-tracker-drag-handle';
  dragHandle.title = 'Drag to move popup';

  // Create iframe for popup content
  const iframe = document.createElement('iframe');
  iframe.id = 'job-tracker-popup-iframe';
  iframe.src = chrome.runtime.getURL('popup.html?standalone=1');
  
  popupContainer.appendChild(dragHandle);
  popupContainer.appendChild(iframe);

  // Add elements to page
  document.body.appendChild(floatingBtn);
  document.body.appendChild(popupContainer);

  // Track popup state
  let isPopupOpen = false;
  let scrapedData = null;

  // Listen for messages from popup (e.g., save clicked)
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'JOB_SAVED') {
      console.log('💾 Job saved! Triggering button animation...');
      floatingBtn.classList.add('saving');
      setTimeout(() => {
        floatingBtn.classList.remove('saving');
      }, 600); // Match animation duration
    }
  });

  // Toggle popup function
  async function togglePopup() {
    isPopupOpen = !isPopupOpen;
    if (isPopupOpen) {
      // Load iframe first
      iframe.src = chrome.runtime.getURL('popup.html?standalone=1&scraped=true&ts=' + Date.now());
      console.log('🎉 Popup loading with iframe src:', iframe.src);
      
      popupContainer.classList.add('visible');
      floatingBtn.classList.add('active');
      
      // Wait for iframe to load, then notify scraping started
      iframe.onload = async () => {
        console.log('📤 Notifying popup that scraping started...');
        try {
          iframe.contentWindow.postMessage({ type: 'SCRAPING_STARTED' }, '*');
        } catch (e) {
          console.error('Failed to send SCRAPING_STARTED:', e);
        }
        
        // Scrape data from current page with brief retries until complete
        console.log('🔍 Scraping job data from page with retries...');
        console.log('Current URL:', window.location.href);

        const isComplete = (d) => {
          if (!d) return false;
          const titleOk = !!(d.title && d.title.trim());
          const companyOk = !!(d.company && d.company.trim());
          const locationOk = !!(d.location && d.location.trim());
          const descOk = !!(d.description && d.description.trim());
          return titleOk && companyOk && locationOk && descOk;
        };

        const maxTries = 10; // ~2s total with 200ms delay
        const delay = (ms) => new Promise(r => setTimeout(r, ms));
        let attempt = 0;
        let last = null;
        while (attempt < maxTries) {
          attempt++;
          try {
            last = await scrapeCurrentPage();
            console.log(`🔎 Attempt ${attempt}/${maxTries} complete=`, isComplete(last));
            if (isComplete(last)) break;
          } catch (e) {
            console.warn('Scrape attempt failed:', e);
          }
          await delay(200);
        }
        scrapedData = last || {};
        
        console.log('✅ Scraped data:', scrapedData);
        console.log('Data keys:', Object.keys(scrapedData));
        console.log('Title:', scrapedData.title);
        console.log('Company:', scrapedData.company);
        
        // Send scraped data to popup
        console.log('📤 Sending scraped data to popup iframe...');
        try {
          iframe.contentWindow.postMessage({ type: 'SCRAPED_DATA', data: scrapedData }, '*');
        } catch (e) {
          console.error('Failed to send data to popup:', e);
        }
        console.log('✅ Data sent to popup');
      };
    } else {
      popupContainer.classList.remove('visible');
      floatingBtn.classList.remove('active');
      console.log('❌ Popup closed');
    }
  }

  // Scrape job data — routed through background.js to bypass page CSP (no eval needed)
  async function scrapeCurrentPage() {
    const pageUrl = window.location.href;
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'SCRAPE_TAB' }, (res) => {
          if (chrome.runtime.lastError) {
            console.warn('SCRAPE_TAB error:', chrome.runtime.lastError.message);
            resolve({ data: {} });
          } else {
            resolve(res || { data: {} });
          }
        });
      });
      const d = response?.data || {};
      return {
        url: d.url || pageUrl,
        title: d.title || '',
        company: d.company || '',
        location: d.location || '',
        description: d.description || '',
        jobId: d.job_id || d.jobId || ''
      };
    } catch (e) {
      console.error('scrapeCurrentPage failed:', e);
      return { url: pageUrl, title: '', company: '', location: '', description: '', jobId: '' };
    }
  }

  // Click handler
  floatingBtn.addEventListener('click', (e) => {
    if (!isDraggingBtn) {
      togglePopup();
    }
  });

  // Listen for messages from the popup (like close button clicks)
  window.addEventListener('message', async (e) => {
    if (e.data && e.data.type === 'CLOSE_POPUP') {
      if (isPopupOpen) {
        togglePopup();
      }
    }

    if (e.data && e.data.type === 'REDO_SCRAPE') {
      try {
        iframe.contentWindow.postMessage({ type: 'SCRAPING_STARTED' }, '*');
      } catch (_) {}

      const isComplete = (d) => {
        if (!d) return false;
        return !!(d.title?.trim() && d.company?.trim() && d.location?.trim() && d.description?.trim());
      };
      const delay = (ms) => new Promise(r => setTimeout(r, ms));
      let last = null;
      for (let i = 0; i < 10; i++) {
        try {
          last = await scrapeCurrentPage();
          if (isComplete(last)) break;
        } catch (_) {}
        await delay(200);
      }
      scrapedData = last || {};
      try {
        iframe.contentWindow.postMessage({ type: 'SCRAPED_DATA', data: scrapedData }, '*');
      } catch (_) {}
    }
  });

  // Click outside to close (optional - comment out if you want ONLY button to close)
  document.addEventListener('click', (e) => {
    if (isPopupOpen && 
        !popupContainer.contains(e.target) && 
        !floatingBtn.contains(e.target)) {
      // Optionally close when clicking outside
      // Uncomment the next line if you want this behavior:
      // togglePopup();
    }
  });

  // Make button draggable
  let isDraggingBtn = false;
  let btnCurrentX;
  let btnCurrentY;
  let btnInitialX;
  let btnInitialY;
  let btnXOffset = 0;
  let btnYOffset = 0;

  floatingBtn.addEventListener('mousedown', btnDragStart);
  floatingBtn.addEventListener('touchstart', btnDragStart);

  function btnDragStart(e) {
    if (e.type === 'touchstart') {
      btnInitialX = e.touches[0].clientX - btnXOffset;
      btnInitialY = e.touches[0].clientY - btnYOffset;
    } else {
      btnInitialX = e.clientX - btnXOffset;
      btnInitialY = e.clientY - btnYOffset;
    }

    if (e.target === floatingBtn || floatingBtn.contains(e.target)) {
      isDraggingBtn = true;
      floatingBtn.classList.add('dragging');
    }
  }

  document.addEventListener('mousemove', btnDrag);
  document.addEventListener('touchmove', btnDrag);
  document.addEventListener('mouseup', btnDragEnd);
  document.addEventListener('touchend', btnDragEnd);

  function btnDrag(e) {
    if (isDraggingBtn) {
      e.preventDefault();

      if (e.type === 'touchmove') {
        btnCurrentX = e.touches[0].clientX - btnInitialX;
        btnCurrentY = e.touches[0].clientY - btnInitialY;
      } else {
        btnCurrentX = e.clientX - btnInitialX;
        btnCurrentY = e.clientY - btnInitialY;
      }

      btnXOffset = btnCurrentX;
      btnYOffset = btnCurrentY;

      setTranslate(btnCurrentX, btnCurrentY, floatingBtn);
    }
  }

  function btnDragEnd(e) {
    if (isDraggingBtn) {
      btnInitialX = btnCurrentX;
      btnInitialY = btnCurrentY;
      isDraggingBtn = false;
      floatingBtn.classList.remove('dragging');
    }
  }

  // Make popup draggable
  let isDraggingPopup = false;
  let popupCurrentX;
  let popupCurrentY;
  let popupInitialX;
  let popupInitialY;
  let popupXOffset = 0;
  let popupYOffset = 0;

  dragHandle.addEventListener('mousedown', popupDragStart);
  dragHandle.addEventListener('touchstart', popupDragStart);

  function popupDragStart(e) {
    if (e.type === 'touchstart') {
      popupInitialX = e.touches[0].clientX - popupXOffset;
      popupInitialY = e.touches[0].clientY - popupYOffset;
    } else {
      popupInitialX = e.clientX - popupXOffset;
      popupInitialY = e.clientY - popupYOffset;
    }

    isDraggingPopup = true;
    popupContainer.classList.add('dragging');
  }

  document.addEventListener('mousemove', popupDrag);
  document.addEventListener('touchmove', popupDrag);
  document.addEventListener('mouseup', popupDragEnd);
  document.addEventListener('touchend', popupDragEnd);

  function popupDrag(e) {
    if (isDraggingPopup) {
      e.preventDefault();

      if (e.type === 'touchmove') {
        popupCurrentX = e.touches[0].clientX - popupInitialX;
        popupCurrentY = e.touches[0].clientY - popupInitialY;
      } else {
        popupCurrentX = e.clientX - popupInitialX;
        popupCurrentY = e.clientY - popupInitialY;
      }

      popupXOffset = popupCurrentX;
      popupYOffset = popupCurrentY;

      setTranslate(popupCurrentX, popupCurrentY, popupContainer);
    }
  }

  function popupDragEnd(e) {
    if (isDraggingPopup) {
      popupInitialX = popupCurrentX;
      popupInitialY = popupCurrentY;
      isDraggingPopup = false;
      popupContainer.classList.remove('dragging');
    }
  }

  function setTranslate(xPos, yPos, el) {
    el.style.transform = `translate3d(${xPos}px, ${yPos}px, 0)`;
  }

  // Some SPA pages (e.g. Greenhouse React app) re-render the body after
  // document_idle, wiping out extension-injected elements. This observer
  // watches for the button being removed and re-injects it immediately.
  const observer = new MutationObserver(() => {
    if (!document.getElementById('job-tracker-floating-btn')) {
      document.body.appendChild(floatingBtn);
      document.body.appendChild(popupContainer);
      console.log('🔄 Job Tracker button re-injected after page mutation');
    }
  });
  observer.observe(document.body, { childList: true });

  console.log('✅ Job Tracker floating button loaded');
})();
