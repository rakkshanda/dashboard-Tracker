// Job scraper with TikTok override + selected boards only
(function () {
  // === TikTok job scraper (internal helper) ===
  function __scrapeTikTokJob_internal() {
    const container = document.querySelector('.jobDetail.positionDetail__1AqfZ, .jobDetail__1UFk5');
    if (!container) {
      // Return a consistent shape even if not found
      return {
        company: 'TikTok',
        title: '',
        location: '',
        url: document.location.href,
        description: '',
        jobId: ''
      };
    }

    const titleEl = container.querySelector('[data-test="jobTitle"]');
    const jobTitle = titleEl ? titleEl.textContent.trim() : '';

    let location = '';
    const locEl = container.querySelector('.job-info .content__3ZUKJ.clamp-content');
    if (locEl) location = locEl.textContent.trim();

    // Robust jobId extraction – mandatory field in the result
    let jobId = '';
    const jobInfoRoot = container.querySelector('.job-info') || container;

    // Pass 1: scan all descendants of .job-info (or container) for "Job ID:"
    const infoNodes = jobInfoRoot.querySelectorAll('*');
    for (const node of infoNodes) {
      const text = (node.textContent || '').trim();
      const match = text.match(/Job ID[:\s]*([A-Za-z0-9\-]+)/i);
      if (match && match[1]) {
        jobId = match[1];
        break;
      }
    }

    // Pass 2: fallback to full text of jobInfoRoot if still missing
    if (!jobId) {
      const fullText = (jobInfoRoot.textContent || '').trim();
      const match = fullText.match(/Job ID[:\s]*([A-Za-z0-9\-]+)/i);
      if (match && match[1]) {
        jobId = match[1];
      }
    }

    const descParts = [];
    const blocks = container.querySelectorAll('.block-title, .block-content');
    blocks.forEach(el => {
      const t = (el.textContent || '').trim();
      if (t) descParts.push(t);
    });
    const jobDescription = descParts.join('\n\n');

    return {
      company: 'TikTok',
      title: jobTitle,
      location,
      url: document.location.href,
      description: jobDescription,
      jobId: jobId || '' // key always present
    };
  }

  const TLD = location.hostname.replace(/^www\./, "");

  const txt = (el) => (el ? (el.textContent || "").trim() : "");
  const attr = (sel, name) => {
    const el = document.querySelector(sel);
    return el ? (el.getAttribute(name) || "").trim() : "";
  };
  const first = (...sels) => {
    for (const s of sels) {
      try {
        const el = document.querySelector(s);
        if (el) return el;
      } catch {
        continue;
      }
    }
    return null;
  };
  const allSafe = (sel) => {
    try { return document.querySelectorAll(sel); } catch { return []; }
  };
  const clean = (s = "") =>
    s.replace(/\s+/g, " ").replace(/\u00A0/g, " ").trim();

  // JSON-LD JobPosting
  function fromJsonLd() {
    const nodes = Array.from(
      document.querySelectorAll('script[type="application/ld+json"]')
    );
    for (const n of nodes) {
      try {
        const data = JSON.parse(n.textContent);
        const items = Array.isArray(data) ? data : [data];
        for (const d of items) {
          if (!d || (d["@type"] !== "JobPosting" && !(d.type === "JobPosting")))
            continue;
          const company =
            d.hiringOrganization?.name ||
            d.hiringOrganization?.["@id"] ||
            d.employerOverview ||
            "";
          const title = d.title || d.positionTitle || "";
          const loc =
            d.jobLocation?.address?.addressLocality &&
            d.jobLocation?.address?.addressRegion
              ? `${d.jobLocation.address.addressLocality}, ${d.jobLocation.address.addressRegion}`
              : d.jobLocation?.address?.addressRegion ||
                d.jobLocation?.address?.addressLocality ||
                d.jobLocation?.address?.addressCountry ||
                d.jobLocation?.address?.addressLocalityCountry ||
                d.jobLocation ||
                "";
          const url = d.url || location.href;
          const description = (d.description || "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          if (title || company || description) {
            return {
              company: clean(company),
              title: clean(title),
              location: clean(loc),
              url: clean(url),
              description: clean(description),
            };
          }
        }
      } catch {}
    }
    return null;
  }

  // Handshake helper
  function handshakeCompanyDetection() {
    const aboutEmployerHeadings = Array.from(allSafe('h4, h3, h2, h1'))
      .filter(heading => heading.textContent && heading.textContent.toLowerCase().includes('about the employer'));
    
    for (const heading of aboutEmployerHeadings) {
      const container = heading.closest('div, section, article');
      if (container) {
        const companyElements = container.querySelectorAll('p.heading, .heading, p[class*="heading"]');
        for (const el of companyElements) {
          const text = clean(el.textContent || "");
          if (text && text.length > 1 && text.length < 100 && 
              !text.toLowerCase().includes('about') &&
              !text.toLowerCase().includes('employer') &&
              !text.toLowerCase().includes('follow')) {
            return text;
          }
        }
        
        const allText = container.querySelectorAll('p, span, div, h1, h2, h3, h4, h5, h6');
        for (const el of allText) {
          const text = clean(el.textContent || "");
          if (text && text.length > 1 && text.length < 100 && 
              !text.toLowerCase().includes('about') &&
              !text.toLowerCase().includes('employer') &&
              !text.toLowerCase().includes('follow') &&
              !text.toLowerCase().includes('job') &&
              !text.toLowerCase().includes('engineer') &&
              !text.toLowerCase().includes('developer') &&
              !text.toLowerCase().includes('posted') &&
              !text.toLowerCase().includes('employees') &&
              !text.toLowerCase().includes('internship') &&
              !text.toLowerCase().includes('spotlight')) {
            return text;
          }
        }
      }
    }
    
    const logoElements = allSafe('img[src*="logo"], img[alt*="logo"], .logo, .company-logo, .employer-logo, [class*="logo"]');
    
    for (const logo of logoElements) {
      const container = logo.closest('div, section, header, article');
      if (container) {
        const headings = container.querySelectorAll('h1, h2, h3, h4, strong, .company-name, .employer-name');
        for (const heading of headings) {
          const text = clean(heading.textContent || "");
          if (text && text.length > 1 && text.length < 50 && 
              !text.toLowerCase().includes('job') && 
              !text.toLowerCase().includes('engineer') &&
              !text.toLowerCase().includes('developer') &&
              !text.toLowerCase().includes('posted')) {
            return text;
          }
        }
      }
    }
    
    const allText = Array.from(allSafe('h1, h2, h3, strong, .company-name, .employer-name'))
      .map(el => clean(el.textContent || ""))
      .filter(text => text && text.length > 1 && text.length < 50)
      .filter(text => {
        const lower = text.toLowerCase();
        return !lower.includes('job') && 
               !lower.includes('engineer') && 
               !lower.includes('developer') &&
               !lower.includes('posted') &&
               !lower.includes('apply') &&
               !lower.includes('remote') &&
               !lower.includes('hybrid') &&
               !lower.includes('onsite') &&
               !lower.includes('salary') &&
               !lower.includes('benefits');
      });
    
    return allText[0] || "";
  }

  // Site-specific strategies (only the ones you want)
  const strategies = {
    // LinkedIn — handles both the full job detail page and the new side-panel layout.
    // The new side panel uses randomised CSS class names, so we rely on stable href
    // patterns and data-testid attributes first, then fall back to the old class selectors.
"linkedin.com": () => {

  // ---- JOB ID ----
  // Side-panel URL carries ?currentJobId=XXXXXXX; detail page has /jobs/view/XXXXXXX/
  const jobId = (() => {
    const urlParam = new URLSearchParams(location.search).get('currentJobId');
    if (urlParam) return urlParam;
    const viewLink = document.querySelector('a[href*="/jobs/view/"]:not([href*="/apply"])');
    if (viewLink) {
      const m = (viewLink.getAttribute('href') || '').match(/\/jobs\/view\/(\d+)/);
      if (m) return m[1];
    }
    const m = location.pathname.match(/\/jobs\/view\/(\d+)/);
    return m ? m[1] : '';
  })();

  // ---- COMPANY ----
  // New UI: company name is always an <a> whose href contains /company/
  const company = (() => {
    const companyLinks = Array.from(document.querySelectorAll('a[href*="/company/"]'));
    for (const link of companyLinks) {
      const t = clean(link.innerText || link.textContent || '');
      if (t && t.length > 1 && t.length < 80 && !/^(follow|see all|life|about)$/i.test(t)) {
        return t;
      }
    }
    // Old UI class-based fallbacks
    return clean(txt(first(
      ".job-details-jobs-unified-top-card__company-name",
      ".job-details-jobs-unified-top-card__company-name a",
      ".jobs-unified-top-card__company-name",
      ".jobs-unified-top-card__company-name a",
      ".job-card-container__company-name",
      ".job-card-container__company-name a",
      ".job-card-list__company-name",
      ".job-card-list__company-name a",
      ".jobs-details__main-content .jobs-details__company-name",
      ".jobs-details__main-content .jobs-details__company-name a",
      ".jobs-details__main-content h3",
      "[data-testid='company-name']",
      ".company-name",
      ".employer-name",
      ".organization-name",
      ".topcard__org-name-link"
    )));
  })();

  // ---- TITLE ----
  // New UI: job title is a link to /jobs/view/ID/ (not the /apply/ variant)
  const title = (() => {
    const jobLinks = Array.from(document.querySelectorAll('a[href*="/jobs/view/"]:not([href*="/apply"])'));
    for (const link of jobLinks) {
      const t = clean(link.innerText || link.textContent || '');
      if (t && t.length > 1 && t.length < 200) return t;
    }
    // Old UI fallbacks
    return clean(txt(first(
      ".job-details-jobs-unified-top-card__job-title",
      ".job-details-jobs-unified-top-card__job-title a",
      ".jobs-unified-top-card__job-title",
      ".jobs-unified-top-card__job-title a",
      ".job-card-container__title",
      ".job-card-container__title a",
      ".job-card-list__title",
      ".job-card-list__title a",
      ".jobs-details__main-content h1",
      ".jobs-details__main-content .jobs-details__job-title",
      "[data-testid='job-title']",
      "h1",
      ".job-title",
      ".position-title",
      ".topcard__title"
    )));
  })();

  // ---- LOCATION ----
  const normalizeLocation = (loc) => {
    if (!loc) return "";
    if (/remote/i.test(loc)) return "Remote";
    if (/hybrid/i.test(loc)) return "Hybrid";
    if (/on[-\s]?site|onsite/i.test(loc)) return "On-site";
    return loc;
  };

  const extractLocationChunk = (text) => {
    if (!text) return "";
    const parts = text.split("·").map(t => clean(t)).filter(Boolean);
    for (const p of parts) {
      if (/[A-Za-z .'-]+,\s*[A-Z]{2}\b/.test(p)) return p;
      if (/(United States|USA|Canada|UK|India|Europe|Australia)/i.test(p)) return p;
      if (/Remote/i.test(p)) return "Remote";
      if (/Hybrid/i.test(p)) return "Hybrid";
      if (/On[-\s]?site|Onsite/i.test(p)) return "On-site";
    }
    return parts[0] || "";
  };

  const locationVal = (() => {
    // New UI: metadata paragraph has pattern "City, ST · Reposted X ago · Y applicants"
    const paras = Array.from(document.querySelectorAll('p'));
    for (const p of paras) {
      const text = (p.innerText || p.textContent || '').trim();
      if (!text || text.length > 200) continue;
      const segments = text.split('·').map(s => s.trim()).filter(Boolean);
      if (segments.length >= 2) {
        const locCandidate = segments[0];
        const timeSegment = segments[1];
        if (
          /\b(ago|day|week|month|hour|minute|Reposted|Just now)\b/i.test(timeSegment) &&
          locCandidate.length > 1 && locCandidate.length < 80
        ) {
          if (
            /,\s*[A-Z]{2}\b/.test(locCandidate) ||
            /\b(Remote|Hybrid|On[-\s]?site|United States|USA|Canada|UK|India|Europe)\b/i.test(locCandidate)
          ) {
            return normalizeLocation(clean(locCandidate));
          }
        }
      }
    }

    // Old UI class-based fallbacks
    const rawLocationText = clean(txt(first(
      ".job-details-jobs-unified-top-card__primary-description-container",
      ".job-details-jobs-unified-top-card__primary-description",
      ".job-details-jobs-unified-top-card__subtitle",
      ".jobs-unified-top-card__subtitle",
      ".job-details-jobs-unified-top-card__bullet",
      ".job-details-jobs-unified-top-card__subtitle-item",
      ".top-card-layout__second-subline",
      "[data-testid='inlineHeader-companyLocation']",
      "[data-testid='job-location']",
      "[data-testid='location']",
      ".job-card-container__metadata-item",
      ".location",
      ".job-location",
      ".work-location"
    )));

    if (rawLocationText) return normalizeLocation(extractLocationChunk(rawLocationText));

    // Last resort: scan page text for location patterns
    const pageText = document.body.innerText || "";
    const patterns = [
      /(?:Location|Work Location|Office Location)\s*[:\-]\s*([^\n\r]+)/i,
      /\b(Remote|Hybrid|On[-\s]?site|Work from home|WFH)\b/i,
      /\b([A-Za-z .'-]+,\s*[A-Z]{2})\b/,
      /\b(United States|USA|Canada|UK|India|Europe|Australia)\b/i
    ];
    for (const pat of patterns) {
      const m = pageText.match(pat);
      if (m) return normalizeLocation(clean(m[1] || m[0]));
    }
    return "";
  })();

  // ---- DESCRIPTION ----
  const description = (() => {
    // New UI: stable data-testid on the expandable text box
    const expandable = document.querySelector('[data-testid="expandable-text-box"]');
    if (expandable) {
      const t = clean(txt(expandable));
      if (t.length > 50) return t;
    }
    // Old UI fallbacks
    return clean(txt(first(
      ".jobs-description-content__text",
      ".jobs-description-content",
      ".jobs-description",
      ".jobs-box__html-content",
      "[data-testid='job-description']",
      "article",
      "main"
    ))) || (() => {
      const els = document.querySelectorAll(
        ".jobs-description-content__text p, .jobs-description-content__text div, .jobs-description-content p, .jobs-description-content div"
      );
      if (els.length) {
        return Array.from(els).map(el => clean(el.textContent || "")).join(" ").trim();
      }
      return "";
    })();
  })();

  return {
    company: company || "",
    title: title || "",
    location: locationVal || "",
    url: location.href,
    description: description || "",
    job_id: jobId || ""
  };
},


    // Indeed
    "indeed.com": () => ({
      company: clean(txt(first(
        ".jobsearch-CompanyInfoWithoutHeaderImage a", 
        ".jobsearch-InlineCompanyRating div:nth-child(1)",
        "[data-testid='companyName']",
        ".jobsearch-CompanyInfoWithoutHeaderImage",
        ".companyName",
        ".jobsearch-CompanyInfo"
      ))),
      title: clean(txt(first(
        "h1.jobsearch-JobInfoHeader-title",
        "[data-testid='job-title']",
        ".jobsearch-JobInfoHeader-title",
        "h1"
      ))),
      location: clean(txt(first(
        ".jobsearch-JobInfoHeader-subtitle > div:last-child", 
        "[data-testid='inlineHeader-companyLocation']",
        ".jobsearch-JobInfoHeader-subtitle",
        ".jobsearch-JobInfoHeader-subtitle-item",
        "[data-testid='job-location']"
      ))),
      description: clean(txt(first(
        "#jobDescriptionText",
        ".jobsearch-jobDescriptionText",
        "[data-testid='job-description']",
        ".jobsearch-JobComponent-description"
      ))),
    }),

    // Microsoft Careers (new Phenom-based layout at careers.microsoft.com)
    "careers.microsoft.com": () => {
      const company = "Microsoft";

      // Title: detail panel h2 first, then first job card title
      const title = clean(txt(first(
        "h2.position-title-3TPtN",
        "[class*='position-title']",
        "div.title-1aNJK",
        "[class*='title-'][class*='aNJK']",
        "h1",
        "h2"
      )));

      // Location: detail panel div first, then job card field value
      const locationVal = (() => {
        const loc = clean(txt(first(
          "div.position-location-12ZUO",
          "[class*='position-location']",
          "div.fieldValue-3kEar",
          "[class*='fieldValue']"
        )));
        // "United States, Washington, Redmond" → keep as-is; strip "+ N more" suffix
        return loc.replace(/\s*\+\s*\d+\s+more$/i, "").trim();
      })();

      // Job ID: scan for visible "Job number" label first, then URL-based fallbacks
      const jobId = (() => {
        // Scan all elements for a "Job number" label and grab the adjacent value
        const allEls = document.querySelectorAll("span, div, p, dt, dd, li, td, th");
        for (const el of allEls) {
          if (/^job\s*number$/i.test((el.textContent || "").trim())) {
            console.log('[MS scraper] Found "Job number" label el:', el, 'parent:', el.parentElement);
            // Try next sibling
            const sibling = el.nextElementSibling;
            const sibVal = clean(txt(sibling || {}));
            console.log('[MS scraper] nextElementSibling text:', sibVal);
            if (sibVal && /^\d+$/.test(sibVal)) return sibVal;
            // Try parent's next sibling
            const parentSib = el.parentElement && el.parentElement.nextElementSibling;
            const parentSibVal = clean(txt(parentSib || {}));
            console.log('[MS scraper] parent.nextElementSibling text:', parentSibVal);
            if (parentSibVal && /^\d+$/.test(parentSibVal)) return parentSibVal;
          }
        }
        console.log('[MS scraper] No "Job number" label found in DOM');
        // Apply button has href="/careers/apply?pid=JOBID&domain=..."
        const applyLink = document.querySelector("a[href*='/careers/apply?pid=']");
        console.log('[MS scraper] applyLink:', applyLink && applyLink.href);
        if (applyLink) {
          const pid = new URL(applyLink.href, location.origin).searchParams.get("pid");
          if (pid) { console.log('[MS scraper] jobId from applyLink pid:', pid); return pid; }
        }
        // Selected card has href="/careers/job/JOBID?domain=..."
        const selectedCard = document.querySelector("a.card-F1ebU.selected-3V9EA, a[class*='selected'][href*='/careers/job/']");
        console.log('[MS scraper] selectedCard href:', selectedCard && selectedCard.getAttribute("href"));
        if (selectedCard) {
          const m = (selectedCard.getAttribute("href") || "").match(/\/careers\/job\/(\d+)/);
          if (m) { console.log('[MS scraper] jobId from selectedCard:', m[1]); return m[1]; }
        }
        // Current URL if on a job detail page
        const urlMatch = location.pathname.match(/\/careers\/job\/(\d+)/);
        console.log('[MS scraper] URL pathname:', location.pathname, '→ urlMatch:', urlMatch);
        if (urlMatch) return urlMatch[1];
        console.log('[MS scraper] ⚠ jobId not found');
        return "";
      })();
      console.log('[MS scraper] Final jobId:', jobId, '| title:', title, '| location:', locationVal);

      // Description: right-side detail container
      const description = clean(txt(first(
        "div.rightcontainer-2NrZP",
        "div.container-2ugKC",
        "[class*='rightcontainer']",
        "main",
        "article"
      )));

      return { company, title, location: locationVal, description, job_id: jobId };
    },

    // Microsoft Careers (old layout)
    "jobs.careers.microsoft.com": () => {
      const root = first('.SearchJobDetailsCard', '.SearchJobDetailsCardViewHelper', '[role="group"].SearchJobDetailsCard') || document;
      const company = "Microsoft";

      const title = (() => {
        const inCard = root.querySelector('h1');
        if (inCard && clean(txt(inCard))) return clean(txt(inCard));
        return clean(txt(first(
          "h1[data-automation-id*='job'], h1[data-automation-id*='title']",
          "[data-test-id='jobTitle']",
          "[data-automation-id='job-title'], [data-automation-id='jobTitle']",
          "h1[role='heading']",
          "header h1",
          "h1"
        )));
      })();

      const locationVal = (() => {
        const p = root.querySelector('.ms-Stack-inner p, .ms-Stack p');
        if (p && clean(txt(p))) {
          let loc = clean(txt(p));
          if (/^multiple locations/i.test(loc)) return 'Remote';
          return loc;
        }
        return clean(txt(first(
          "[data-automation-id*='location']",
          "[data-test-id='jobLocation']",
          ".job-location",
          "[class*='location']",
          "[aria-label*='Location']"
        ))) || (() => {
          const cand = first("[class*='location']", "[aria-label*='Location']");
          const txtVal = clean(txt(cand || {}));
          if (/^multiple locations/i.test(txtVal)) return 'Remote';
          return txtVal;
        })();
      })();

      const description = (() => {
        const inCard = first(
          '.fcUffXZZoGt8CJQd8GUl',
          'article',
          'main [role="main"]',
          '[data-automation-id*="jobDescription"]',
          '[data-test-id="jobDescription"]'
        );
        if (inCard) return clean(txt(inCard));
        return clean(txt(first(
          "[data-automation-id*='jobDescription']",
          "[data-test-id='jobDescription']",
          "article",
          "main [role='main']",
          "[class*='description']"
        )));
      })();

      const jobId = (() => {
        const rows = root.querySelectorAll('.IyCDaH20Khhx15uuQqgx .ms-Stack.css-303');
        for (const row of rows) {
          const label = clean(txt(row.querySelector('.ms-Stack.css-309'))).toLowerCase();
          if (label === 'job number') {
            const val = row.querySelectorAll('.ms-Stack.css-309')[1];
            const id = clean(txt(val || {}));
            if (id) return id;
          }
        }
        const all = root.querySelectorAll('.ms-Stack.css-303, .ms-Stack.css-309');
        for (const el of all) {
          const text = clean(txt(el)).toLowerCase();
          if (text === 'job number') {
            const sibling = el.nextElementSibling;
            const id = clean(txt(sibling || {}));
            if (id) return id;
          }
        }
        return '';
      })();

      return { company, title, location: locationVal, description, job_id: jobId };
    },

    // Greenhouse
    "greenhouse.io": () => ({
      company:
        clean(txt(first(".company-name"))) ||
        clean(attr('meta[property="og:site_name"]', "content")),
      title: clean(txt(first("h1.app-title, h1"))),
      location: clean(txt(first(".location, .app-title + .info"))),
      description: clean(
        txt(first("#content, .opening, .job, .content, .section-wrapper"))
      ),
    }),

    // Ashby
    "ashbyhq.com": () => ({
      company:
        clean(attr('meta[property="og:site_name"]', "content")) ||
        clean(txt(first("a[href*='company']"))) ||
        "",
      title: clean(txt(first("h1, [data-testid='JobTitle']"))),
      location: clean(txt(first("[data-testid='JobLocation'], .location"))),
      description: clean(txt(first("[data-testid='JobDescription'], .description"))),
    }),

    // Amazon (amazon.jobs)
    "amazon.jobs": () => {
      const company = "Amazon";

      // Title: h1.title inside the apply-header info block
      const title = clean(txt(first(
        "h1.title",
        "h1.job-title",
        "[data-test-id='job-title']",
        "h1"
      )));

      // Job ID: from "Job ID: XXXXX | ..." meta line, or URL path, or data-react-props JSON
      const jobId = (() => {
        const metaEl = document.querySelector("p.meta, .details-line p.meta");
        if (metaEl) {
          const m = (metaEl.textContent || "").match(/Job\s+ID[:\s]+(\d+)/i);
          if (m) return m[1];
        }
        // URL: /en/jobs/3169056/...
        const urlMatch = location.pathname.match(/\/jobs\/(\d+)/);
        if (urlMatch) return urlMatch[1];
        // data-react-props JSON fallback
        const reactEl = document.querySelector("[data-react-props*='job_id']");
        if (reactEl) {
          try {
            const props = JSON.parse(reactEl.getAttribute("data-react-props") || "{}");
            if (props.currentJob && props.currentJob.job_id) return String(props.currentJob.job_id);
          } catch {}
        }
        return "";
      })();

      // Location: sidebar associations location item
      const locationVal = (() => {
        const locItem = document.querySelector(
          ".associations .association.location-icon .association-content li, " +
          ".associations .location-icon .association-content li"
        );
        if (locItem) return clean(txt(locItem));
        // fallback
        return clean(txt(first(".job-location", ".location")));
      })();

      // Description: only the job content sections (not sidebar/related jobs)
      const description = (() => {
        const contentCol = document.querySelector(
          "#job-detail-body .col-md-7 .content, " +
          "#job-detail-body .col-lg-8 .content, " +
          "#job-detail-body .col-xl-9 .content"
        );
        if (contentCol) return clean(txt(contentCol));
        return clean(txt(first("#job-detail-body", "#job-detail", ".job-description", "main")));
      })();

      return { company, title, location: locationVal, description, job_id: jobId };
    },

    // Amazon hiring (hiring.amazon.com)
    "hiring.amazon.com": () => {
      const company = "Amazon";
      const title = clean(txt(first(
        "h1",
        "[data-testid='job-title']",
        ".job-title"
      )));
      const locationVal = clean(txt(first(
        ".job-location",
        "[data-testid='job-location']",
        ".location"
      )));
      const description = clean(txt(first(
        "[data-testid='job-description']",
        ".job-description",
        ".description",
        "main",
        "article"
      )));
      return { company, title, location: locationVal, description };
    },

    // Handshake
    "joinhandshake.com": () => {
      const bodyText = () => (document.body?.innerText || "").replace(/\s+/g, " ").trim();
      const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
      const firstText = (selector) => {
        const el = document.querySelector(selector);
        return norm(el?.textContent || "");
      };

      const findCompany = () => {
        const links = Array.from(document.querySelectorAll('a[href*="/e/"]'));
        const best = links
          .map(a => ({ a, t: norm(a.textContent) }))
          .filter(x => x.t && x.t.length > 1 && x.t.length < 80)
          .filter(x => !/education|software|internet|finance|health|fashion/i.test(x.t))
          .find(Boolean);
        return best ? best.t : "";
      };

      const findJobTitle = () => {
        return (
          firstText('a[href*="/jobs/"] h1') ||
          firstText("h1") ||
          firstText('a[href*="/jobs/"]')
        );
      };

      const sliceBetween = (full, startMarker, endMarkers) => {
        const start = full.indexOf(startMarker);
        if (start === -1) return "";
        const after = full.slice(start);
        let end = after.length;
        for (const m of endMarkers) {
          const idx = after.indexOf(m);
          if (idx !== -1 && idx < end) end = idx;
        }
        return after.slice(0, end).trim();
      };

      const findLocation = () => {
        const text = bodyText();
        const glance = sliceBetween(text, "At a glance", [
          "The Role",
          "What they're looking for",
          "About the employer",
          "Similar Jobs",
          "Alumni in similar roles"
        ]);

        if (glance) {
          let m = glance.match(/based in\s+([A-Za-z .'-]+,\s*[A-Z]{2})/i);
          if (m) return m[1];
          if (/\bRemote\b/i.test(glance)) return "Remote";
          if (/\bHybrid\b/i.test(glance)) return "Hybrid";
          if (/\bOnsite\b/i.test(glance)) return "Onsite";
          m = glance.match(/([A-Za-z .'-]+,\s*[A-Z]{2})/);
          if (m) return m[1];
        }

        const about = sliceBetween(text, "About the employer", [
          "Similar Jobs",
          "Alumni in similar roles"
        ]);
        if (about) {
          const m = about.match(/([A-Za-z .'-]+,\s*[A-Z]{2})/);
          if (m) return m[1];
        }

        const role = sliceBetween(text, "The Role", [
          "What they're looking for",
          "About the employer",
          "Similar Jobs",
          "Alumni in similar roles"
        ]);
        if (role) {
          const m =
            role.match(/Location\s+([A-Za-z0-9 .,'()/-]+?)(?=\s{1,}What You'll Do|Who You Are|How You Work|What Success Looks Like|About|$)/i) ||
            role.match(/Location\s+([A-Za-z .'-]+,\s*[A-Z]{2})/i);
          if (m) return norm(m[1]);
        }
        return "";
      };

      const findJobDescription = () => {
        // Try DOM selectors first (more reliable than text markers)
        const descSelectors = [
          '[data-testid="job-description"]',
          '[data-testid*="description"]',
          'div[class*="style__JobDetails"]',
          'div[class*="job-details"]',
          'div[class*="job_details"]',
          'section[class*="description"]',
        ];
        for (const sel of descSelectors) {
          try {
            const el = document.querySelector(sel);
            if (el) {
              const t = norm(el.textContent || "");
              if (t.length > 100) return t;
            }
          } catch {}
        }

        // Text-slicing fallback with multiple possible start markers
        const text = bodyText();
        const endMarkers = [
          "What they're looking for",
          "About the employer",
          "Similar Jobs",
          "Alumni in similar roles",
          "Apply Now",
          "Easy Apply",
        ];
        const startMarkers = [
          "The Role",
          "Job Description",
          "About the Role",
          "Position Description",
          "About this Role",
          "Role Description",
          "What You'll Do",
          "Responsibilities",
          "Overview",
        ];
        for (const marker of startMarkers) {
          const jd = sliceBetween(text, marker, endMarkers);
          if (jd && jd.length > 100) return jd;
        }
        return "";
      };

      return {
        company: findCompany(),
        title: findJobTitle(),
        location: findLocation(),
        description: findJobDescription(),
        url: location.href
      };
    },

    // Apple Jobs (jobs.apple.com)
    "jobs.apple.com": () => {
      const company = "Apple";

      const title = clean(txt(first(
        "h1#jobdetails-postingtitle",
        "h1[id*='postingtitle']",
        "h1"
      )));

      const locationVal = clean(txt(first(
        "label#jobdetails-joblocation",
        "[id*='joblocation']"
      )));

      // Job ID: from URL path /details/200661396-0836/... or DOM element
      const jobId = (() => {
        const urlMatch = location.pathname.match(/\/details\/([^/]+)\//);
        if (urlMatch) return urlMatch[1];
        const domEl = document.querySelector("strong#jobdetails-jobnumber, [id*='jobnumber']");
        if (domEl) return clean(txt(domEl));
        return "";
      })();

      // Build description from all named sections
      const description = (() => {
        const sections = [
          { id: "jobdetails-jobsummary", label: "Summary" },
          { id: "jobdetails-jobdescription", label: "Description" },
          { id: "jobdetails-responsibilities", label: "Responsibilities" },
          { id: "jobdetails-minimumqualifications", label: "Minimum Qualifications" },
          { id: "jobdetails-preferredqualifications", label: "Preferred Qualifications" },
          { id: "jobdetails-posting-footer-0", label: "Pay & Benefits" },
        ];
        const parts = [];
        for (const { id, label } of sections) {
          const el = document.getElementById(id);
          if (!el) continue;
          const contentEl = el.querySelector("[id*='content-row'], .t-body");
          const text = clean(txt(contentEl || el));
          if (text) parts.push(`${label}\n${text}`);
        }
        return parts.join("\n\n");
      })();

      return { company, title, location: locationVal, description, job_id: jobId };
    },

    "app.joinhandshake.com": () => {
      const bodyText = () => (document.body?.innerText || "").replace(/\s+/g, " ").trim();
      const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
      const firstText = (selector) => {
        const el = document.querySelector(selector);
        return norm(el?.textContent || "");
      };

      const findCompany = () => {
        const links = Array.from(document.querySelectorAll('a[href*="/e/"]'));
        const best = links
          .map(a => ({ a, t: norm(a.textContent) }))
          .filter(x => x.t && x.t.length > 1 && x.t.length < 80)
          .filter(x => !/education|software|internet|finance|health|fashion/i.test(x.t))
          .find(Boolean);
        return best ? best.t : "";
      };

      const findJobTitle = () => {
        return (
          firstText('a[href*="/jobs/"] h1') ||
          firstText("h1") ||
          firstText('a[href*="/jobs/"]')
        );
      };

      const sliceBetween = (full, startMarker, endMarkers) => {
        const start = full.indexOf(startMarker);
        if (start === -1) return "";
        const after = full.slice(start);
        let end = after.length;
        for (const m of endMarkers) {
          const idx = after.indexOf(m);
          if (idx !== -1 && idx < end) end = idx;
        }
        return after.slice(0, end).trim();
      };

      const findLocation = () => {
        const text = bodyText();
        const glance = sliceBetween(text, "At a glance", [
          "The Role",
          "What they're looking for",
          "About the employer",
          "Similar Jobs",
          "Alumni in similar roles"
        ]);

        if (glance) {
          let m = glance.match(/based in\s+([A-Za-z .'-]+,\s*[A-Z]{2})/i);
          if (m) return m[1];
          if (/\bRemote\b/i.test(glance)) return "Remote";
          if (/\bHybrid\b/i.test(glance)) return "Hybrid";
          if (/\bOnsite\b/i.test(glance)) return "Onsite";
          m = glance.match(/([A-Za-z .'-]+,\s*[A-Z]{2})/);
          if (m) return m[1];
        }

        const about = sliceBetween(text, "About the employer", [
          "Similar Jobs",
          "Alumni in similar roles"
        ]);
        if (about) {
          const m = about.match(/([A-Za-z .'-]+,\s*[A-Z]{2})/);
          if (m) return m[1];
        }

        const role = sliceBetween(text, "The Role", [
          "What they're looking for",
          "About the employer",
          "Similar Jobs",
          "Alumni in similar roles"
        ]);
        if (role) {
          const m =
            role.match(/Location\s+([A-Za-z0-9 .,'()/-]+?)(?=\s{1,}What You'll Do|Who You Are|How You Work|What Success Looks Like|About|$)/i) ||
            role.match(/Location\s+([A-Za-z .'-]+,\s*[A-Z]{2})/i);
          if (m) return norm(m[1]);
        }
        return "";
      };

      const findJobDescription = () => {
        const descSelectors = [
          '[data-testid="job-description"]',
          '[data-testid*="description"]',
          'div[class*="style__JobDetails"]',
          'div[class*="job-details"]',
          'div[class*="job_details"]',
          'section[class*="description"]',
        ];
        for (const sel of descSelectors) {
          try {
            const el = document.querySelector(sel);
            if (el) {
              const t = norm(el.textContent || "");
              if (t.length > 100) return t;
            }
          } catch {}
        }

        const text = bodyText();
        const endMarkers = [
          "What they're looking for",
          "About the employer",
          "Similar Jobs",
          "Alumni in similar roles",
          "Apply Now",
          "Easy Apply",
        ];
        const startMarkers = [
          "The Role",
          "Job Description",
          "About the Role",
          "Position Description",
          "About this Role",
          "Role Description",
          "What You'll Do",
          "Responsibilities",
          "Overview",
        ];
        for (const marker of startMarkers) {
          const jd = sliceBetween(text, marker, endMarkers);
          if (jd && jd.length > 100) return jd;
        }
        return "";
      };

      return {
        company: findCompany(),
        title: findJobTitle(),
        location: findLocation(),
        description: findJobDescription(),
        url: location.href
      };
    },
  };

  function siteSpecific() {
    console.log('[scrape.js] TLD detected:', TLD);
    for (const key in strategies) {
      if (TLD === key || TLD.endsWith('.' + key)) {
        console.log('[scrape.js] ✓ Matched strategy for:', key);
        let data = strategies[key]();
        console.log('[scrape.js] Scraped data from', key, ':', data);
        if ((key === 'jobs.careers.microsoft.com' || key === 'careers.microsoft.com') && (!data.title || data.title.length < 2)) {
          const start = Date.now();
          while (Date.now() - start < 1000) {
            data = strategies[key]();
            if (data.title && data.title.length > 1) break;
          }
        }
        return data;
      }
    }
    console.log('[scrape.js] ⚠ No site-specific strategy matched for:', TLD);
    return null;
  }

  function generic() {
    const company = (() => {
      const sels = [
        "[data-company]",
        "[data-testid='company-name']",
        "[data-testid='companyName']",
        "[data-testid='employer-name']",
        "[data-cy='company-name']",
        ".company-name",
        ".company_name", 
        ".employer-name",
        ".employer_name",
        ".job-company",
        ".job-company-name",
        ".company-title",
        ".company-header",
        ".employer-info",
        ".employer-header",
        ".topcard__org-name-link",
        ".org-name",
        ".organization-name",
        ".hiring-organization",
        ".company",
        ".employer",
        ".organization",
        ".org",
        "h2.company",
        "h3.company", 
        ".header .company",
        ".job-header .company",
        ".page-header .company",
        "a.company",
        "a[href*='company']",
        "a[href*='employer']",
        ".job-details .company",
        ".job-info .company",
        ".posting-header .company"
      ];
      for (const selector of sels) {
        const el = document.querySelector(selector);
        if (el) {
          const text = clean(el.textContent || "");
          if (text && text.length > 1 && text.length < 100) return text;
        }
      }
      return clean(attr('meta[name="company"]', "content")) ||
             clean(attr('meta[property="og:site_name"]', "content")) ||
             clean(attr('meta[name="organization"]', "content")) ||
             clean(attr('meta[name="author"]', "content"));
    })();

    const title = clean(txt(first("h1, [data-testid='job-title']")));
    const locationGuess = (() => {
      const sels = [
        "[data-testid*='location']",
        "[data-testid*='Location']",
        ".location",
        ".job-location",
        ".work-location",
        ".job-loc",
        ".loc",
        "[class*='location']",
        "[class*='Location']",
        ".subtitle",
        ".meta",
        ".job-meta",
        ".job-info",
        ".job-details",
        ".header-meta",
        ".job-header-meta"
      ];
      
      for (const selector of sels) {
        const el = document.querySelector(selector);
        if (el) {
          const text = clean(el.textContent || "");
          if (text && text.length < 100) return text;
        }
      }
      
      const cand = Array.from(
        document.querySelectorAll("li, span, div, p, dd, td, th")
      )
        .map((el) => clean(el.textContent || ""))
        .filter((t) => t && t.length > 3 && t.length < 100)
        .filter((t) =>
          /remote|hybrid|on[- ]site|work[- ]from[- ]home|wfh|full[- ]time|part[- ]time|contract|freelance|internship|[A-Za-z]+,\s*[A-Z]{2}\b|United States|USA|Canada|UK|Europe|India|Seattle|San Francisco|New York|Boston|Austin|London|Dublin|Los Angeles|Chicago|Denver|Portland|Vancouver|Toronto|Sydney|Melbourne|Berlin|Paris|Amsterdam|Singapore|Tokyo/i.test(
            t
          )
        );
      return cand[0] || "";
    })();

    let description = "";
    const blocks = [
      "#job-description",
      "[data-testid='job-description']",
      ".description, .job-description",
      "article",
      "main",
      ".content, .posting-description, .section.page",
    ];
    for (const b of blocks) {
      const el = document.querySelector(b);
      if (el && clean(el.innerText).length > 120) {
        description = clean(el.innerText);
        break;
      }
    }
    if (!description) {
      description = clean(document.body.innerText || "");
      if (description.length > 50000) description = description.slice(0, 50000);
    }

    return {
      company: company || "",
      title: title || "",
      location: locationGuess || "",
      url: location.href,
      description,
    };
  }

  function selectionAsDescription(base) {
    const sel = (window.getSelection && String(window.getSelection())) || "";
    if (sel && sel.length > 40) {
      base.description = clean(sel);
    }
    return base;
  }

  function truncateDescription(s, max = 50000) {
    if (!s) return "";
    const t = s.replace(/\s+/g, " ").trim();
    return t.length > max ? t.slice(0, max - 1) + "…" : t;
  }

  function scrape() {
    const hrefLower = String(location.href || '').toLowerCase();
    console.log('[scrape.js] Starting scrape for URL:', location.href);

    // TikTok override
    if (hrefLower.includes('lifeattiktok.com')) {
      const tiktokData = __scrapeTikTokJob_internal();
      if (tiktokData && (tiktokData.title || tiktokData.description)) {
        tiktokData.description = truncateDescription(tiktokData.description || '');
        tiktokData.company = clean(tiktokData.company || '');
        tiktokData.title = clean(tiktokData.title || '');
        tiktokData.location = clean(tiktokData.location || '');
        tiktokData.url = clean(tiktokData.url || '');
        return tiktokData;
      }
    }

    // Handshake override — bypass JSON-LD, always use site-specific scraper
    if (hrefLower.includes('joinhandshake.com')) {
      const hsKey = hrefLower.includes('app.joinhandshake.com') ? 'app.joinhandshake.com' : 'joinhandshake.com';
      let hsData = strategies[hsKey]?.() || {};
      hsData.url = location.href;
      hsData.company = clean(hsData.company || '');
      hsData.title = clean(hsData.title || '');
      hsData.location = clean(hsData.location || '');
      hsData.description = truncateDescription(hsData.description || '');
      console.log('[scrape.js] Handshake scraped data:', { title: hsData.title, company: hsData.company, hasDesc: !!hsData.description });
      return hsData;
    }

    // Apple Jobs override — skip JSON-LD and generic, use Apple scraper only
    if (hrefLower.includes('jobs.apple.com')) {
      console.log('[scrape.js] Apple Jobs detected — using Apple scraper');
      let appleData = strategies['jobs.apple.com']();
      appleData = appleData || {};
      appleData.url = location.href;
      appleData.company = clean(appleData.company || 'Apple');
      appleData.title = clean(appleData.title || '');
      appleData.location = clean(appleData.location || '');
      appleData.description = truncateDescription(appleData.description || '');
      appleData.job_id = appleData.job_id || '';
      console.log('[scrape.js] Apple scraped data:', { title: appleData.title, location: appleData.location, job_id: appleData.job_id });
      return appleData;
    }

    // 1) JSON-LD
    let data = fromJsonLd();
    console.log('[scrape.js] JSON-LD result:', data);
    // 2) Site specific
    if (!data) data = siteSpecific();
    // 3) Generic
    if (!data) data = generic();

    data = data || {};
    data.url = data.url || location.href;

    // For Microsoft pages: extract job_id from URL pid param if not already set
    if (!data.job_id && /microsoft\.com/i.test(location.hostname)) {
      const pid = new URLSearchParams(location.search).get("pid");
      if (pid) {
        data.job_id = pid;
        console.log('[scrape.js] MS job_id from URL pid:', pid);
      }
    }

    // For Amazon pages: extract job_id from URL path /jobs/XXXXX if not already set
    if (!data.job_id && /amazon\.jobs/i.test(location.hostname)) {
      const m = location.pathname.match(/\/jobs\/(\d+)/);
      if (m) {
        data.job_id = m[1];
        console.log('[scrape.js] Amazon job_id from URL:', m[1]);
      }
    }

    // For Apple pages: extract job_id from URL path /details/XXXXX/ if not already set
    if (!data.job_id && /jobs\.apple\.com/i.test(location.hostname)) {
      const m = location.pathname.match(/\/details\/([^/]+)\//);
      if (m) {
        data.job_id = m[1];
        console.log('[scrape.js] Apple job_id from URL:', m[1]);
      }
    }

    data = selectionAsDescription(data);

    data.company = clean(data.company || "");
    data.title = clean(data.title || "");
    data.location = clean(data.location || "");
    data.url = clean(data.url || "");
    data.description = truncateDescription(data.description || "");

    console.log('[scrape.js] Final scraped data:', { company: data.company, title: data.title, location: data.location, job_id: data.job_id, hasDesc: !!data.description });
    return data;
  }

  window.__scrapeJob = scrape;
})();
