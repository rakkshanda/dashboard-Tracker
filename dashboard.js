// Supabase Job Tracker Dashboard JavaScript
class SupabaseJobTracker {
    constructor() {
        this.jobs = [];
        this.filteredJobs = [];
        this.currentFilters = {
            search: '',
            status: ['saved'], // Default: show only saved
            company: 'all',
            location: 'all',
            source: 'all',
            tag: 'all',
            dateRange: 'all'
        };
        this.editingJobId = null;
        this.currentCommentJobId = null;
        this.statusOptions = ['saved', 'applied', 'resume_screening', 'interview', 'offer', 'rejected', 'withdrawn', 'ended'];
        this.sourceOptions = ['LinkedIn', 'Handshake', 'Indeed', 'URL'];
        this.isRefreshing = false;

        // Numbering feature
        this.isNumberingMode = false;
        this.numberingCounter = 1;
        this.activeView = 'all'; // 'all' | 'numbered'
        
        // Temporary status history (not saved until "Save Job" is clicked)
        this.tempStatusHistory = [];
        this.pendingStatusDeleteIndex = null;
        
        // Pagination
        this.currentPage = 1;
        this.itemsPerPage = 50;
        
        // Selected month for activity summary (null = current month)
        this.selectedMonth = null;
        
        // Initialize Supabase
        const SUPABASE_URL = window.ENV_SUPABASE_URL;
        const SUPABASE_KEY = window.ENV_SUPABASE_KEY;
        if (!SUPABASE_URL || !SUPABASE_KEY) {
            console.error('Supabase config missing. Create config.js from config.example.js');
            alert('Supabase config missing. Create config.js from config.example.js');
        }
        this.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        
        console.log('✅ Supabase client initialized:', this.supabase);
        
        this.setupStatusDeleteConfirmModal();
        this.init();
    }

    // Helper function to get today's date in local timezone (YYYY-MM-DD)
    getTodayDate() {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    sanitize(text) {
        if (text === null || text === undefined) return '';
        return String(text).replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[char]);
    }

    normalizeId(id) {
        if (id === null || id === undefined) {
            return '';
        }
        const str = typeof id === 'string' ? id : String(id);
        const trimmed = str.trim();
        if (!trimmed || trimmed === 'undefined' || trimmed === 'null') {
            return '';
        }
        return trimmed;
    }

    capitalizeWords(str) {
        if (!str || typeof str !== 'string') {
            return '';
        }
        return str.trim().split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
    }

    normalizeLocation(location) {
        if (!location || typeof location !== 'string') {
            return '';
        }

        let normalized = location.trim();

        // Remove state abbreviations (e.g., ", WA" or ", CA")
        // Matches patterns like "Seattle, WA" or "Seattle, Washington"
        normalized = normalized.replace(/,\s*[A-Z]{2}$/i, ''); // Removes ", WA", ", CA", etc.
        normalized = normalized.replace(/,\s*[A-Za-z\s]+$/i, (match) => {
            // Only remove if it looks like a state name (common US states)
            const states = [
                'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado',
                'connecticut', 'delaware', 'florida', 'georgia', 'hawaii', 'idaho',
                'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana',
                'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota',
                'mississippi', 'missouri', 'montana', 'nebraska', 'nevada',
                'new hampshire', 'new jersey', 'new mexico', 'new york',
                'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon',
                'pennsylvania', 'rhode island', 'south carolina', 'south dakota',
                'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington',
                'west virginia', 'wisconsin', 'wyoming'
            ];
            const stateName = match.replace(/,\s*/i, '').toLowerCase();
            return states.includes(stateName) ? '' : match;
        });

        // Trim any trailing commas or spaces
        normalized = normalized.replace(/[,\s]+$/, '').trim();

        // Capitalize first letter of each word
        normalized = this.capitalizeWords(normalized);

        return normalized;
    }

    getCompanyFilterLabel() {
        if (this.currentFilters.company === 'all') {
            return 'All Companies';
        }

        const selected = Array.isArray(this.currentFilters.company)
            ? this.currentFilters.company
            : (this.currentFilters.company ? [this.currentFilters.company] : []);
        const normalizedSelections = selected.map(name => this.normalizeCompanyName(name));

        if (normalizedSelections.length === 0) return 'All Companies';
        if (normalizedSelections.length === 1) return normalizedSelections[0];
        return `${normalizedSelections.length} companies`;
    }

    updateCompanyFilterLabel() {
        const companyBtn = document.querySelector('[data-filter="company"]');
        const labelEl = companyBtn?.querySelector('.filter-value');
        if (labelEl) {
            labelEl.textContent = this.getCompanyFilterLabel();
        }
    }

    getStatusFilterLabel() {
        if (this.currentFilters.status === 'all') {
            return 'All Status';
        }

        const selected = Array.isArray(this.currentFilters.status)
            ? this.currentFilters.status
            : (this.currentFilters.status ? [this.currentFilters.status] : []);

        if (!selected.length) return 'All Status';
        if (selected.length === 1) return this.formatStatus(selected[0]);
        return `${this.formatStatus(selected[0])} +${selected.length - 1}`;
    }

    updateStatusFilterLabel() {
        const statusBtn = document.querySelector('[data-filter="status"]');
        const labelEl = statusBtn?.querySelector('.filter-value');
        if (labelEl) {
            labelEl.textContent = this.getStatusFilterLabel();
        }
    }

    normalizeCompanyName(company) {
        if (!company || typeof company !== 'string') {
            return '';
        }
        // Capitalize first letter of each word
        return this.capitalizeWords(company.trim());
    }

    idsMatch(a, b) {
        return this.normalizeId(a) === this.normalizeId(b);
    }

    getElementJobId(element) {
        if (!element) return '';
        const directId = this.normalizeId(element.dataset?.id);
        if (directId) {
            return directId;
        }
        const row = element.closest('tr[data-id]');
        if (row) {
            return this.normalizeId(row.dataset.id);
        }
        return '';
    }

    sanitizeUrl(url) {
        if (!url) return '';
        const trimmed = String(url).trim();
        if (!trimmed) return '';
        try {
            return new URL(trimmed).toString();
        } catch (error) {
            try {
                return new URL(`https://${trimmed}`).toString();
            } catch {
                return '';
            }
        }
    }

    getHostname(url) {
        try {
            const { hostname } = new URL(url);
            return hostname.replace(/^www\./, '');
        } catch {
            return 'View job';
        }
    }

    formatDate(dateString) {
        if (!dateString) return '—';
        try {
            // Parse date as local timezone to avoid UTC conversion issues
            // Format: YYYY-MM-DD
            const parts = dateString.split('-');
            if (parts.length === 3) {
                const year = parseInt(parts[0]);
                const month = parseInt(parts[1]) - 1; // Month is 0-indexed
                const day = parseInt(parts[2]);
                const date = new Date(year, month, day);
                
                if (Number.isNaN(date.getTime())) {
                    return this.sanitize(dateString);
                }
                
                return date.toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric'
                });
            }

            // Fallback for other formats
            const date = new Date(dateString);
            if (Number.isNaN(date.getTime())) {
                return this.sanitize(dateString);
            }
            return date.toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric'
            });
        } catch {
            return this.sanitize(dateString);
        }
    }

    formatStatus(status) {
        if (!status) return 'Saved';
        const normalized = String(status);
        // Handle resume_screening separately
        if (normalized === 'resume_screening') return 'Resume Screening';
        return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    }

    getLastStatusChangeDate(job) {
        if (!job.status_history || job.status_history.length === 0) {
            return '';
        }
        
        const lastChange = job.status_history[job.status_history.length - 1];
        const date = new Date(lastChange.timestamp);
        const formattedDate = date.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric',
            year: 'numeric'
        });
        
        return formattedDate; // Just the date, no "Changed:" prefix
    }

    async init() {
        console.log('Initializing Supabase JobTracker...');
        this.setupEventListeners();
        this.startLiveClock();
        await this.loadJobs();
        this.applyFilters(); // Apply default filters (saved & applied)
        this.renderJobs();
        this.updateStats();
        this.populateFilterOptions();
        this.initSankey();
        console.log('Supabase JobTracker initialized successfully');
        console.log('✅ Default filter applied: showing only Saved & Applied jobs');
    }

    startLiveClock() {
        const updateClock = () => {
            const now = new Date();
            
            // Format: "Monday, October 28, 2024 • 3:45 PM"
            const options = { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
            };
            const dateStr = now.toLocaleDateString(undefined, options);
            
            // Format time with AM/PM
            let hours = now.getHours();
            let minutes = now.getMinutes();
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12;
            hours = hours ? hours : 12; // 0 should be 12
            minutes = minutes < 10 ? '0' + minutes : minutes;
            const timeStr = `${hours}:${minutes} ${ampm}`;
            
            const datetimeElement = document.getElementById('live-datetime');
            if (datetimeElement) {
                datetimeElement.textContent = `${dateStr} • ${timeStr}`;
            }
        };
        
        // Update immediately
        updateClock();
        
        // Update every second
        setInterval(updateClock, 1000);
    }

    initSankey() {
        // Check if Google Charts is available
        if (typeof google === 'undefined' || !google.charts) {
            console.warn('Google Charts not loaded yet, Sankey feature disabled');
            return;
        }

        // Load Google Charts
        google.charts.load('current', {'packages':['sankey']});
        
        // Set up event listeners for Sankey
        const sankeyToggleBtn = document.getElementById('sankey-toggle-btn');
        const closeSankeyBtn = document.getElementById('close-sankey-btn');
        const refreshSankeyBtn = document.getElementById('refresh-sankey-btn');
        const sankeyDateFrom = document.getElementById('sankey-date-from');
        const sankeyDateTo = document.getElementById('sankey-date-to');
        const sankeyStatusCheckboxes = document.querySelectorAll('#sankey-status-filter input[type="checkbox"]');

        if (sankeyToggleBtn) {
            sankeyToggleBtn.addEventListener('click', () => this.toggleSankey());
        }

        if (closeSankeyBtn) {
            closeSankeyBtn.addEventListener('click', () => this.hideSankey());
        }

        if (refreshSankeyBtn) {
            refreshSankeyBtn.addEventListener('click', () => this.refreshSankeyData());
        }

        // Auto-update Sankey when filters change
        if (sankeyDateFrom) {
            sankeyDateFrom.addEventListener('change', () => this.renderSankeyWithFilters());
        }

        if (sankeyDateTo) {
            sankeyDateTo.addEventListener('change', () => this.renderSankeyWithFilters());
        }

        sankeyStatusCheckboxes.forEach(checkbox => {
            checkbox.addEventListener('change', () => this.renderSankeyWithFilters());
        });
    }

    toggleSankey() {
        const sankeyContainer = document.getElementById('sankey-container');
        const isVisible = sankeyContainer && sankeyContainer.style.display === 'block';
        
        if (isVisible) {
            this.hideSankey();
        } else {
            this.showSankey();
        }
    }

    showSankey() {
        const mainContainer = document.getElementById('main-container');
        const sankeyContainer = document.getElementById('sankey-container');
        const btn = document.getElementById('sankey-toggle-btn');
        
        if (!mainContainer || !sankeyContainer) {
            console.error('Sankey containers not found');
            return;
        }
        
        mainContainer.style.display = 'none';
        sankeyContainer.style.display = 'block';
        
        if (btn) {
            btn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" style="width:14px;height:14px"><rect x="2" y="2" width="12" height="12" rx="1"/><path d="M2 6h12M6 6v8"/></svg> Tracker';
        }

        this.renderSankeyWithFilters();
    }

    hideSankey() {
        const mainContainer = document.getElementById('main-container');
        const sankeyContainer = document.getElementById('sankey-container');
        const btn = document.getElementById('sankey-toggle-btn');
        
        if (!mainContainer || !sankeyContainer) {
            console.error('Sankey containers not found');
            return;
        }
        
        sankeyContainer.style.display = 'none';
        mainContainer.style.display = 'block';
        
        if (btn) {
            btn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" style="width:14px;height:14px"><path d="M2 12L6 8l3 3 5-6"/><path d="M11 5h3v3"/></svg> Sankey';
        }
    }

    renderSankeyWithFilters() {
        // Get filter values
        const dateFrom = document.getElementById('sankey-date-from').value;
        const dateTo = document.getElementById('sankey-date-to').value;
        const selectedStatuses = Array.from(
            document.querySelectorAll('#sankey-status-filter input[type="checkbox"]:checked')
        ).map(cb => cb.value);

        // Filter jobs
        let filteredJobs = this.jobs.filter(job => {
            // Date range filter
            if (dateFrom && job.applied_date < dateFrom) return false;
            if (dateTo && job.applied_date > dateTo) return false;
            
            // Status filter (check if job ever had any of the selected statuses)
            if (selectedStatuses.length > 0) {
                const hasStatus = selectedStatuses.includes(job.status) || 
                    (job.status_history && job.status_history.some(h => selectedStatuses.includes(h.status)));
                if (!hasStatus) return false;
            }
            
            return true;
        });

        this.renderSankey(filteredJobs);
    }

    renderSankey(jobs) {
        // Check if Google Charts is loaded
        if (typeof google === 'undefined' || !google.visualization) {
            console.error('Google Charts not loaded');
            return;
        }

        const data = new google.visualization.DataTable();
        data.addColumn('string', 'From');
        data.addColumn('string', 'To');
        data.addColumn('number', 'Count');

        // Define a logical order for statuses to prevent cycles
        // Flow: Applied → Resume Screening → Interview → Offer/Rejected/Ended/Ghosted
        const statusOrder = {
            'Applied': 0,
            'Resume Screening': 1,
            'Interview': 2,
            'Offer': 3,
            'Rejected': 3,    // Terminal state (same level as Offer)
            'Withdrawn': 3,   // Terminal state (same level as Offer)
            'Ended': 3,       // Terminal state (same level as Offer)
            'Ghosted': 3      // Terminal state (same level as Offer)
        };
        
        // Aggregate all status paths - only count forward progressions to avoid cycles
        const transitions = {};
        
        jobs.forEach(job => {
            if (job.status_history && job.status_history.length > 0) {
                // Build the complete path for this job
                const statuses = [];
                
                job.status_history.forEach(entry => {
                    const currentStatus = this.formatStatus(entry.status);
                    // Skip "Saved" status - start from Applied
                    if (currentStatus === 'Saved') return;
                    
                    // Only add if different from previous
                    if (statuses.length === 0 || statuses[statuses.length - 1] !== currentStatus) {
                        statuses.push(currentStatus);
                    }
                });
                
                // Add current status if different from last history entry
                const currentStatus = this.formatStatus(job.status);
                if (currentStatus !== 'Saved' && (statuses.length === 0 || statuses[statuses.length - 1] !== currentStatus)) {
                    statuses.push(currentStatus);
                }
                
                // Check if job is still in "Applied" status (no response = ghosted)
                if (job.status === 'applied' && statuses[statuses.length - 1] === 'Applied') {
                    statuses.push('Ghosted');
                }
                
                // Only process if we have at least 2 statuses (need a transition)
                if (statuses.length >= 2) {
                    // Create transitions - ONLY forward progressions to avoid cycles
                    // (Sankey diagrams cannot handle backwards flows)
                    for (let i = 0; i < statuses.length - 1; i++) {
                        const from = statuses[i];
                        const to = statuses[i + 1];
                        
                        // Only count if it's a forward progression or to a terminal state
                        const fromOrder = statusOrder[from] || 0;
                        const toOrder = statusOrder[to] || 0;
                        
                        if (toOrder >= fromOrder || to === 'Ghosted') {
                            const key = `${from} → ${to}`;
                            transitions[key] = (transitions[key] || 0) + 1;
                        }
                    }
                }
            } else {
                // No history - check if job is in "applied" status
                const currentStatus = this.formatStatus(job.status);
                if (currentStatus === 'Applied') {
                    // Job is applied with no history = ghosted
                    const key = 'Applied → Ghosted';
                    transitions[key] = (transitions[key] || 0) + 1;
                }
            }
        });

        // Convert transitions to data array
        const rows = Object.entries(transitions).map(([key, count]) => {
            const [from, to] = key.split(' → ');
            return [from, to, count];
        });

        if (rows.length === 0) {
            // No valid transitions to display
            document.getElementById('sankey-chart').innerHTML = `
                <div style="display: flex; align-items: center; justify-content: center; height: 600px; flex-direction: column; gap: 1rem;">
                    <i class="fas fa-chart-line" style="font-size: 4rem; color: #94a3b8;"></i>
                    <p style="font-size: 1.25rem; color: #64748b;">No status transitions to display</p>
                    <p style="font-size: 0.9rem; color: #94a3b8;">Try adjusting your filters or add more job applications with status changes</p>
                </div>
            `;
            return;
        }

        data.addRows(rows);

        const options = {
            width: '100%',
            height: 600,
            sankey: {
                node: {
                    colors: ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6'],
                    label: {
                        fontName: 'Arial',
                        fontSize: 14,
                        color: '#333',
                        bold: true
                    },
                    nodePadding: 20,
                    width: 8
                },
                link: {
                    colorMode: 'gradient',
                    colors: ['#e0e7ff', '#f3e8ff', '#fce7f3', '#ffe4e6', '#fed7aa', '#d1fae5', '#cffafe', '#dbeafe']
                }
            }
        };

        const chart = new google.visualization.Sankey(document.getElementById('sankey-chart'));
        chart.draw(data, options);
        
        // Add click event listener for interactivity
        google.visualization.events.addListener(chart, 'select', () => {
            const selection = chart.getSelection();
            if (selection.length > 0) {
                const selectedItem = selection[0];
                
                if (selectedItem.row !== undefined) {
                    // Clicked on a link (transition between statuses)
                    const rowData = data.getValue(selectedItem.row, 0); // from status
                    const toStatus = data.getValue(selectedItem.row, 1); // to status
                    const count = data.getValue(selectedItem.row, 2); // count
                    
                    console.log(`Clicked on transition: ${rowData} → ${toStatus} (${count} jobs)`);
                    
                    // Convert formatted status back to internal format
                    const fromStatusInternal = this.reverseFormatStatus(rowData);
                    const toStatusInternal = this.reverseFormatStatus(toStatus);
                    
                    // Filter jobs that have this specific transition
                    this.filterByTransition(fromStatusInternal, toStatusInternal);
                } else if (selectedItem.name !== undefined) {
                    // Clicked on a node (status)
                    const statusName = selectedItem.name;
                    console.log(`Clicked on status: ${statusName}`);
                    
                    // Convert formatted status back to internal format
                    const statusInternal = this.reverseFormatStatus(statusName);
                    
                    // Filter jobs with this status
                    this.filterByStatus(statusInternal);
                }
            }
        });
    }

    reverseFormatStatus(formattedStatus) {
        // Convert formatted status back to internal format
        const statusMap = {
            'Saved': 'saved',
            'Applied': 'applied',
            'Resume Screening': 'resume_screening',
            'Interview': 'interview',
            'Offer': 'offer',
            'Rejected': 'rejected',
            'Withdrawn': 'withdrawn',
            'Ended': 'ended'
        };
        return statusMap[formattedStatus] || formattedStatus.toLowerCase();
    }

    filterByTransition(fromStatus, toStatus) {
        console.log(`Filtering by transition: ${fromStatus} → ${toStatus}`);
        
        // Find all jobs that have this specific transition in their history
        const matchingJobs = this.jobs.filter(job => {
            if (!job.status_history || job.status_history.length === 0) {
                // Check if it's a simple Saved → current status transition
                if (fromStatus === 'saved' && job.status === toStatus) {
                    return true;
                }
                return false;
            }
            
            // Build the status path for this job
            const statuses = ['saved']; // Start with saved
            job.status_history.forEach(entry => {
                if (statuses[statuses.length - 1] !== entry.status) {
                    statuses.push(entry.status);
                }
            });
            
            // Add current status if different
            if (statuses[statuses.length - 1] !== job.status) {
                statuses.push(job.status);
            }
            
            // Check if this transition exists in the path
            for (let i = 0; i < statuses.length - 1; i++) {
                if (statuses[i] === fromStatus && statuses[i + 1] === toStatus) {
                    return true;
                }
            }
            
            return false;
        });
        
        console.log(`Found ${matchingJobs.length} jobs with this transition`);
        
        // Apply the filter and switch to tracker view
        this.filteredJobs = matchingJobs;
        this.currentPage = 1;
        this.hideSankey();
        this.renderJobs();
        this.updateStats();
        
        // Show a message
        const message = `Showing ${matchingJobs.length} job(s) with transition: ${this.formatStatus(fromStatus)} → ${this.formatStatus(toStatus)}`;
        this.showFilterMessage(message);
    }

    filterByStatus(status) {
        console.log(`Filtering by status: ${status}`);
        
        // Find all jobs that either have this status or had it in their history
        const matchingJobs = this.jobs.filter(job => {
            // Check current status
            if (job.status === status) return true;
            
            // Check status history
            if (job.status_history && job.status_history.length > 0) {
                return job.status_history.some(entry => entry.status === status);
            }
            
            return false;
        });
        
        console.log(`Found ${matchingJobs.length} jobs with status ${status}`);
        
        // Apply the filter and switch to tracker view
        this.filteredJobs = matchingJobs;
        this.currentPage = 1;
        this.hideSankey();
        this.renderJobs();
        this.updateStats();
        
        // Show a message
        const message = `Showing ${matchingJobs.length} job(s) with status: ${this.formatStatus(status)}`;
        this.showFilterMessage(message);
    }

    showFilterMessage(message) {
        // Create or update filter message
        let messageDiv = document.getElementById('sankey-filter-message');
        if (!messageDiv) {
            messageDiv = document.createElement('div');
            messageDiv.id = 'sankey-filter-message';
            messageDiv.style.cssText = `
                position: fixed;
                top: 80px;
                right: 20px;
                background: #6366f1;
                color: white;
                padding: 1rem 1.5rem;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
                z-index: 1000;
                font-size: 0.9rem;
                font-weight: 500;
                display: flex;
                align-items: center;
                gap: 0.75rem;
            `;
            document.body.appendChild(messageDiv);
        }
        
        messageDiv.innerHTML = `
            <i class="fas fa-filter"></i>
            <span>${message}</span>
            <button onclick="this.parentElement.remove()" style="background: none; border: none; color: white; cursor: pointer; font-size: 1.2rem; margin-left: 0.5rem;">&times;</button>
        `;
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (messageDiv && messageDiv.parentElement) {
                messageDiv.remove();
            }
        }, 5000);
    }

    async refreshSankeyData() {
        console.log('🔄 Refreshing Sankey data...');
        
        const refreshBtn = document.getElementById('refresh-sankey-btn');
        const icon = refreshBtn?.querySelector('i');
        
        // Add spinning animation
        if (refreshBtn) {
            refreshBtn.classList.add('spinning');
        }
        
        try {
            // Fetch fresh data from Supabase
            await this.loadJobs({ silent: true });
            console.log('✅ Data loaded from Supabase');
            
            // Re-render the Sankey diagram with current filters
            this.renderSankeyWithFilters();
            console.log('✅ Sankey diagram refreshed');
            
            // Show success feedback
            this.showFilterMessage('✅ Sankey data refreshed!');
            
        } catch (error) {
            console.error('Error refreshing Sankey data:', error);
            alert('Failed to refresh data: ' + error.message);
        } finally {
            // Remove spinning animation after a short delay
            setTimeout(() => {
                if (refreshBtn) {
                    refreshBtn.classList.remove('spinning');
                }
            }, 600);
        }
    }

    // Data Management
    async loadJobs({ silent = false } = {}) {
        try {
            if (!silent) {
                console.log('🔄 Loading jobs from Supabase...');
                console.log('Supabase client:', this.supabase);
            }
            
            const { data, error } = await this.supabase
                .from('jobs')
                .select('*')
                .order('applied_date', { ascending: false })
                .order('created_at', { ascending: false });
            
            if (error) {
                console.error('❌ Supabase error:', error);
                throw error;
            }
            
            console.log('📦 Raw data from Supabase:', data);
            
            const normalizedData = (data || []).map(job => ({
                ...job,
                company: this.normalizeCompanyName(job.company || '')
            }));
            
            this.jobs = normalizedData;
            this.filteredJobs = [...this.jobs];
            
            console.log('✅ Loaded', this.jobs.length, 'jobs from Supabase');
            console.log('First job:', this.jobs[0]);
            
        } catch (error) {
            console.error('❌ Error loading jobs from Supabase:', error);
            alert('Error loading jobs from Supabase: ' + error.message);
            this.jobs = [];
            this.filteredJobs = [];
        }
    }

    async saveJobs() {
        try {
            // Save to Chrome storage (backup)
            if (typeof chrome !== 'undefined' && chrome.storage) {
                await chrome.storage.local.set({ savedJobs: this.jobs });
                console.log('Saved jobs to Chrome storage');
            }

            // Save to localStorage as backup
            localStorage.setItem('jobTrackerJobs', JSON.stringify(this.jobs));
            console.log('Saved jobs to localStorage:', this.jobs.length);
        } catch (error) {
            console.error('Error saving jobs:', error);
        }
    }

    // Utility function to normalize all existing entries in Supabase
    async normalizeAllEntries() {
        try {
            console.log('🔄 Starting normalization of all entries...');

            // Fetch all jobs
            const { data: allJobs, error: fetchError } = await this.supabase
                .from('jobs')
                .select('*');

            if (fetchError) {
                throw fetchError;
            }

            console.log(`Found ${allJobs.length} jobs to normalize`);

            let updatedCount = 0;
            let skippedCount = 0;

            for (const job of allJobs) {
                const normalizedLocation = this.normalizeLocation(job.location || '');
                const normalizedCompany = this.normalizeCompanyName(job.company || '');

                // Only update if something changed
                if (normalizedLocation !== job.location || normalizedCompany !== job.company) {
                    const { error: updateError } = await this.supabase
                        .from('jobs')
                        .update({
                            location: normalizedLocation,
                            company: normalizedCompany
                        })
                        .eq('id', job.id);

                    if (updateError) {
                        console.error(`Error updating job ${job.id}:`, updateError);
                    } else {
                        updatedCount++;
                        console.log(`✅ Updated: "${job.company}" → "${normalizedCompany}", "${job.location}" → "${normalizedLocation}"`);
                    }
                } else {
                    skippedCount++;
                }
            }

            console.log(`\n✅ Normalization complete!`);
            console.log(`   Updated: ${updatedCount} jobs`);
            console.log(`   Skipped: ${skippedCount} jobs (already normalized)`);

            // Reload jobs to reflect changes
            await this.loadJobs();
            this.renderJobs();
            this.updateStats();
            this.populateFilterOptions();

            alert(`Normalization complete!\nUpdated: ${updatedCount} jobs\nSkipped: ${skippedCount} jobs`);

        } catch (error) {
            console.error('Error normalizing entries:', error);
            alert('Error normalizing entries: ' + error.message);
        }
    }

    // Update clear filters button visibility
    updateClearFiltersButton() {
        const clearBtn = document.getElementById('clear-filters-btn');
        if (!clearBtn) return;
        
        // Check if any filter is different from default
        const isDefaultStatus = Array.isArray(this.currentFilters.status) && 
            this.currentFilters.status.length === 2 &&
            this.currentFilters.status.includes('saved') &&
            this.currentFilters.status.includes('applied');

        const hasCompanyFilter = Array.isArray(this.currentFilters.company)
            ? this.currentFilters.company.length > 0
            : this.currentFilters.company !== 'all';
        
        const hasActiveFilters =
            this.currentFilters.search !== '' ||
            !isDefaultStatus ||
            hasCompanyFilter ||
            this.currentFilters.location !== 'all' ||
            this.currentFilters.source !== 'all' ||
            this.currentFilters.tag !== 'all' ||
            this.currentFilters.dateRange !== 'all';
        
        // Show/hide button based on filter state
        clearBtn.style.display = hasActiveFilters ? 'inline-flex' : 'none';
    }

    // Event Listeners
    setupEventListeners() {
        // Search input
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.currentFilters.search = e.target.value.toLowerCase();
                this.applyFilters();
                this.updateClearFiltersButton();
            });
        }

        // Filter buttons and dropdowns
        document.addEventListener('click', (e) => {
            // Close all dropdowns when clicking filter button
            if (e.target.classList.contains('filter-btn') || e.target.closest('.filter-btn') ||
                e.target.classList.contains('chip') || e.target.closest('.chip')) {
                const btn = e.target.classList.contains('filter-btn') ? e.target
                    : e.target.closest('.filter-btn') ? e.target.closest('.filter-btn')
                    : e.target.classList.contains('chip') ? e.target
                    : e.target.closest('.chip');
                const dropdown = btn?.nextElementSibling;
                
                // Close all other dropdowns first
                document.querySelectorAll('.filter-dropdown.show').forEach(dd => {
                    if (dd !== dropdown) {
                        dd.classList.remove('show');
                    }
                });
                
                // Toggle current dropdown
                dropdown?.classList.toggle('show');
                if (dropdown?.dataset.multiselect === 'company' && dropdown.classList.contains('show')) {
                    const searchField = dropdown.querySelector('.filter-search-input');
                    if (searchField) {
                        setTimeout(() => searchField.focus(), 0);
                    }
                }
                e.stopPropagation();
                return;
            }

            // Handle multi-select action buttons
            if (e.target.classList.contains('filter-action-btn')) {
                const filterType = e.target.dataset.filter;
                if (filterType === 'company' || filterType === 'status') {
                    const dropdown = e.target.closest('.filter-dropdown');
                    const checkboxes = dropdown?.querySelectorAll('input[type="checkbox"]') || [];
                    if (e.target.classList.contains('apply')) {
                        const selected = Array.from(checkboxes)
                            .filter(cb => cb.checked)
                            .map(cb => filterType === 'company'
                                ? this.normalizeCompanyName(cb.value)
                                : cb.value)
                            .filter(Boolean);
                        if (filterType === 'company') {
                            this.currentFilters.company = selected.length ? selected : 'all';
                            this.updateCompanyFilterLabel();
                        } else {
                            this.currentFilters.status = selected.length ? selected : 'all';
                            this.updateStatusFilterLabel();
                        }
                    } else if (e.target.classList.contains('clear')) {
                        Array.from(checkboxes).forEach(cb => { cb.checked = false; });
                        if (filterType === 'company') {
                            const searchField = dropdown?.querySelector('.filter-search-input');
                            if (searchField) searchField.value = '';
                            dropdown?.querySelectorAll('.filter-checkbox').forEach(option => {
                                option.style.display = '';
                            });
                            this.currentFilters.company = 'all';
                            this.updateCompanyFilterLabel();
                        } else {
                            this.currentFilters.status = 'all';
                            this.updateStatusFilterLabel();
                        }
                    }
                    this.applyFilters();
                    this.updateClearFiltersButton();
                    dropdown?.classList.remove('show');
                    e.stopPropagation();
                    return;
                }
            }
            
            // Handle filter option selection
            if (e.target.classList.contains('filter-option')) {
                const dropdown = e.target.closest('.filter-dropdown');
                const filterBtn = dropdown?.previousElementSibling;
                const filterType = filterBtn?.dataset.filter;
                if (!filterBtn || !filterType) return;
                const value = e.target.dataset.value;
                const text = e.target.textContent;
                const filterValueSpan = filterBtn.querySelector('.filter-value');

                if (filterType === 'company' && value === 'all') {
                    dropdown?.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                        cb.checked = false;
                    });
                    const searchField = dropdown?.querySelector('.filter-search-input');
                    if (searchField) searchField.value = '';
                    dropdown?.querySelectorAll('.filter-checkbox').forEach(option => {
                        option.style.display = '';
                    });
                    this.currentFilters.company = 'all';
                    this.updateCompanyFilterLabel();
                    if (filterValueSpan) {
                        filterValueSpan.textContent = this.getCompanyFilterLabel();
                    }
                } else if (filterType === 'status' && value === 'all') {
                    dropdown?.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                        cb.checked = false;
                    });
                    this.currentFilters.status = 'all';
                    this.updateStatusFilterLabel();
                    if (filterValueSpan) {
                        filterValueSpan.textContent = this.getStatusFilterLabel();
                    }
                    this.applyFilters();
                    this.updateClearFiltersButton();
                    dropdown?.classList.remove('show');
                    e.stopPropagation();
                    return;
                } else if (filterValueSpan) {
                    filterValueSpan.textContent = text;
                }
                
                // Map 'date' filter to 'dateRange' in currentFilters
                const filterKey = filterType === 'date' ? 'dateRange' : filterType;
                this.currentFilters[filterKey] = value;
                if (filterType === 'company') {
                    this.updateCompanyFilterLabel();
                } else if (filterType === 'status') {
                    this.updateStatusFilterLabel();
                }
                
                this.applyFilters();
                this.updateClearFiltersButton();
                
                // Close the dropdown
                dropdown?.classList.remove('show');
                e.stopPropagation();
                return;
            }
            
            // Close dropdowns when clicking outside of both button and dropdown content
            document.querySelectorAll('.filter-dropdown.show').forEach(dropdown => {
                const button = dropdown.previousElementSibling;
                const clickedInsideDropdown = dropdown.contains(e.target);
                const clickedButton = button?.contains(e.target);
                if (!clickedInsideDropdown && !clickedButton) {
                    dropdown.classList.remove('show');
                }
            });
            // Close custom status dropdowns
            if (!e.target.closest('.status-custom-dd')) {
                document.querySelectorAll('.status-dd-menu.open').forEach(m => {
                    m.classList.remove('open');
                    m.style.top = '';
                    m.style.left = '';
                });
            }
        });

        document.addEventListener('input', (e) => {
            if (e.target.classList.contains('filter-search-input')) {
                const query = e.target.value.toLowerCase();
                const dropdown = e.target.closest('.filter-dropdown');
                dropdown?.querySelectorAll('.filter-checkbox').forEach(option => {
                    const labelText = option.textContent.toLowerCase();
                    option.style.display = labelText.includes(query) ? '' : 'none';
                });
            }
        });

        document.addEventListener('change', (e) => {
            const checkbox = e.target;
            if (checkbox.type !== 'checkbox') return;
            const dropdown = checkbox.closest('.filter-dropdown[data-multiselect="status"]');
            if (!dropdown) return;
            const selected = Array.from(dropdown.querySelectorAll('input[type="checkbox"]'))
                .filter(cb => cb.checked)
                .map(cb => cb.value)
                .filter(Boolean);
            this.currentFilters.status = selected.length ? selected : 'all';
            this.updateStatusFilterLabel();
            this.applyFilters();
            this.updateClearFiltersButton();
        });

        // Multi-select functionality
        const selectAllCheckbox = document.getElementById('select-all-checkbox');
        if (selectAllCheckbox) {
            selectAllCheckbox.addEventListener('change', () => {
                this.selectAllJobs(selectAllCheckbox.checked);
            });
        }
        
        // Month selector for activity summary
        const monthSelector = document.getElementById('month-selector');
        if (monthSelector) {
            monthSelector.addEventListener('change', (e) => {
                const [year, month] = e.target.value.split('-');
                this.selectedMonth = { year: parseInt(year), month: parseInt(month) };
                this.updateActivitySummary();
            });

            const shiftMonth = (delta) => {
                if (!monthSelector.options.length) return;
                let idx = monthSelector.selectedIndex;
                if (idx === -1) idx = 0;
                const newIdx = Math.min(Math.max(idx + delta, 0), monthSelector.options.length - 1);
                if (newIdx === idx) return;
                monthSelector.selectedIndex = newIdx;
                const [y, m] = monthSelector.value.split('-');
                this.selectedMonth = { year: parseInt(y), month: parseInt(m) };
                this.updateActivitySummary();
            };

            const prevBtn = document.getElementById('month-prev');
            const nextBtn = document.getElementById('month-next');
            prevBtn?.addEventListener('click', () => shiftMonth(-1));
            nextBtn?.addEventListener('click', () => shiftMonth(1));
        }

    }

    // Filtering
    applyFilters() {
        // Reset to page 1 when filters change
        this.currentPage = 1;

        const companyFilterRaw = this.currentFilters.company === 'all'
            ? null
            : (Array.isArray(this.currentFilters.company)
                ? this.currentFilters.company
                : (this.currentFilters.company ? [this.currentFilters.company] : []));
        const companyFilterValues = companyFilterRaw && companyFilterRaw.length
            ? companyFilterRaw.map(name => this.normalizeCompanyName(name).toLowerCase())
            : null;
        
        // Numbered view: only ranked jobs, sorted by rank
        if (this.activeView === 'numbered') {
            this.filteredJobs = this.jobs
                .filter(j => j.priority_rank != null)
                .sort((a, b) => a.priority_rank - b.priority_rank);
            this.renderJobs();
            this.updateStats();
            this.updateNumberedTabCount();
            return;
        }

        // Active view: in-progress statuses
        const activeStatuses = ['saved', 'applied', 'resume_screening', 'interview'];
        if (this.activeView === 'active') {
            this.filteredJobs = this.jobs.filter(j => activeStatuses.includes((j.status || 'saved').toLowerCase()));
            this.renderJobs();
            this.updateStats();
            this.updateNumberedTabCount();
            return;
        }

        // Archive view: terminal statuses
        const archiveStatuses = ['rejected', 'withdrawn', 'ended', 'ghosted', 'offer'];
        if (this.activeView === 'archive') {
            this.filteredJobs = this.jobs.filter(j => archiveStatuses.includes((j.status || 'saved').toLowerCase()));
            this.renderJobs();
            this.updateStats();
            this.updateNumberedTabCount();
            return;
        }

        this.filteredJobs = this.jobs.filter(job => {
            // Search filter
            const matchesSearch = !this.currentFilters.search || 
                (job.title || '').toLowerCase().includes(this.currentFilters.search) ||
                (job.company || '').toLowerCase().includes(this.currentFilters.search) ||
                (job.location || '').toLowerCase().includes(this.currentFilters.search);

            // Status filter
            const matchesStatus = this.currentFilters.status === 'all' || 
                (Array.isArray(this.currentFilters.status) 
                    ? this.currentFilters.status.includes(job.status || 'saved')
                    : (job.status || 'saved') === this.currentFilters.status);

            // Company filter
            const jobCompanyLower = this.normalizeCompanyName(job.company || '').toLowerCase();
            const matchesCompany = !companyFilterValues || companyFilterValues.includes(jobCompanyLower);

            // Location filter
            const matchesLocation = this.currentFilters.location === 'all' || 
                (job.location || '') === this.currentFilters.location;

            // Source filter
            const matchesSource = this.currentFilters.source === 'all' ||
                (job.source || '') === this.currentFilters.source;

            // Tag filter
            const matchesTag = this.currentFilters.tag === 'all' ||
                (job.role_tag || getJobTag(job.title)) === this.currentFilters.tag;

            // Date range filter
            let matchesDateRange = true;
            if (this.currentFilters.dateRange !== 'all') {
                if (!job.applied_date) {
                    // Jobs without applied_date don't match specific date filters
                    matchesDateRange = false;
                } else {
                    // Parse date in local timezone (avoid UTC conversion)
                    const parts = job.applied_date.split('-');
                    const jobDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
                    const now = new Date();
                    now.setHours(0, 0, 0, 0); // Reset to start of day
                    jobDate.setHours(0, 0, 0, 0); // Reset to start of day
                    const daysDiff = Math.floor((now - jobDate) / (1000 * 60 * 60 * 24));
                    
                    switch (this.currentFilters.dateRange) {
                        case 'today':
                            matchesDateRange = daysDiff === 0;
                            break;
                        case 'week':
                            // This week: Monday to Sunday of current week
                            const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
                            const mondayOffset = currentDay === 0 ? 6 : currentDay - 1; // Days since Monday
                            const weekStart = new Date(now);
                            weekStart.setDate(now.getDate() - mondayOffset);
                            weekStart.setHours(0, 0, 0, 0);
                            const weekEnd = new Date(weekStart);
                            weekEnd.setDate(weekStart.getDate() + 6); // Sunday
                            weekEnd.setHours(23, 59, 59, 999);
                            matchesDateRange = jobDate >= weekStart && jobDate <= weekEnd;
                            break;
                        case 'month':
                            matchesDateRange = daysDiff <= 30;
                            break;
                        case '3months':
                            matchesDateRange = daysDiff <= 90;
                            break;
                        default:
                            matchesDateRange = true;
                    }
                }
            }

            return matchesSearch && matchesStatus && matchesCompany &&
                   matchesLocation && matchesSource && matchesTag && matchesDateRange;
        });

        this.renderJobs();
        this.updateStats();
        this.updateNumberedTabCount();
    }

    // Job Management
    async addJob(jobData) {
        try {
            const normalizedStatus = ((jobData.status || 'saved') + '').toLowerCase();
            const newJobData = {
                title: jobData.title || '',
                company: this.normalizeCompanyName(jobData.company || ''),
                location: this.normalizeLocation(jobData.location || ''),
                job_id: jobData.jobId || '',
                status: normalizedStatus,
                applied_date: jobData.appliedDate || this.getTodayDate(),
                url: jobData.url || '',
                description: jobData.description || '',
                notes: jobData.notes || '',
                comments: jobData.comments || '',
                source: jobData.source || 'Manual Entry'
            };

            console.log('Adding job to Supabase:', newJobData);

            const { data, error } = await this.supabase
                .from('jobs')
                .insert([newJobData])
                .select()
                .single();

            if (error) {
                throw error;
            }

            const normalizedJob = {
                ...data,
                company: this.normalizeCompanyName(data?.company || '')
            };
            this.jobs.unshift(normalizedJob);
            await this.saveJobs();
            this.applyFilters();
            this.populateFilterOptions();
            console.log('✅ Job added successfully:', data);
            return data;
        } catch (error) {
            console.error('Error adding job:', error);
            alert('Could not add job. Please try again.');
            return null;
        }
    }

    async updateJobStatus(id, newStatus) {
        try {
            const normalizedId = this.normalizeId(id);
            if (!normalizedId) {
                console.error('Invalid job id supplied for status update:', id);
                alert('Unable to update status because this job is missing a valid id. Please refresh and try again.');
                return false;
            }
            console.log(`=== UPDATING JOB STATUS ===`);
            console.log('Job ID:', normalizedId);
            console.log('New status:', newStatus);

            // Get current job data to access status history
            const job = this.jobs.find(j => this.idsMatch(j.id, normalizedId));
            if (!job) {
                throw new Error('Job not found');
            }

            let updatedHistory;
            
            // If status is changed back to "saved", clear all history (reset)
            if (newStatus === 'saved') {
                console.log('⚠️ Status reset to Saved - clearing all history');
                updatedHistory = [{
                    status: 'saved',
                    timestamp: new Date().toISOString(),
                    date: new Date().toLocaleDateString('en-US', { 
                        year: 'numeric', 
                        month: 'short', 
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    })
                }];
            } else {
                // Build status history entry
                const statusHistoryEntry = {
                    status: newStatus,
                    timestamp: new Date().toISOString(),
                    date: new Date().toLocaleDateString('en-US', { 
                        year: 'numeric', 
                        month: 'short', 
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    })
                };

                // Get existing history or initialize empty array
                const currentHistory = job.status_history || [];
                updatedHistory = [...currentHistory, statusHistoryEntry];
            }

            const { data, error } = await this.supabase
                .from('jobs')
                .update({ 
                    status: newStatus,
                    status_history: updatedHistory
                })
                .eq('id', normalizedId)
                .select()
                .single();

            if (error) {
                throw error;
            }

            // Update local data
            const jobIndex = this.jobs.findIndex(j => this.idsMatch(j.id, normalizedId));
            if (jobIndex !== -1) {
                this.jobs[jobIndex] = data;
            }

            // When status becomes "applied", clear this job's rank and shift others down
            if (newStatus === 'applied' && job.priority_rank != null) {
                const removedRank = job.priority_rank;
                this.jobs[jobIndex].priority_rank = null;
                this.jobs.filter(j => j.priority_rank != null && j.priority_rank > removedRank)
                    .forEach(j => j.priority_rank--);
                this.numberingCounter = Math.max(1, this.jobs.filter(j => j.priority_rank != null).length + 1);
                await this.updateJobRank(normalizedId, null);
                await Promise.all(
                    this.jobs.filter(j => j.priority_rank != null).map(j => this.updateJobRank(j.id, j.priority_rank))
                );
                this.updateNumberedTabCount();
            }

            await this.saveJobs();
            this.applyFilters();
            this.populateFilterOptions();

            console.log('✅ Status updated successfully in Supabase with history');
            return true;
        } catch (error) {
            console.error('Error updating job status:', error);
            alert('Could not update status. Please try again.');
            return false;
        }
    }

    async updateJobFavorite(id, favorite) {
        try {
            const normalizedId = this.normalizeId(id);
            if (!normalizedId) return false;
            const { data, error } = await this.supabase
                .from('jobs')
                .update({ favorite })
                .eq('id', normalizedId)
                .select()
                .single();
            if (error) {
                console.error('Error updating favorite:', error);
                alert('Could not update favorite. Please try again.');
                return false;
            }
            const idx = this.jobs.findIndex(j => this.idsMatch(j.id, normalizedId));
            if (idx !== -1) {
                this.jobs[idx] = { ...this.jobs[idx], favorite: data.favorite };
            }
            return true;
        } catch (error) {
            console.error('Exception updating favorite:', error);
            alert('Could not update favorite. Please try again.');
            return false;
        }
    }

    async updateJobRank(id, rank) {
        try {
            const normalizedId = this.normalizeId(id);
            if (!normalizedId) return false;
            const { data, error } = await this.supabase
                .from('jobs')
                .update({ priority_rank: rank })
                .eq('id', normalizedId)
                .select()
                .single();
            if (error) { console.error('Error updating rank:', error); return false; }
            const idx = this.jobs.findIndex(j => this.idsMatch(j.id, normalizedId));
            if (idx !== -1) this.jobs[idx] = { ...this.jobs[idx], priority_rank: data.priority_rank };
            return true;
        } catch (e) {
            console.error('Exception updating rank:', e);
            return false;
        }
    }

    // Fire-and-forget rank persist — does NOT update local state (use after optimistic update)
    _persistRank(id, rank) {
        const normalizedId = this.normalizeId(id);
        if (!normalizedId) return;
        this.supabase.from('jobs').update({ priority_rank: rank }).eq('id', normalizedId).then(({ error }) => {
            if (error) console.error('Error persisting rank:', error);
        });
    }

    async reorderRanks(draggedId, targetId) {
        const dragged = this.jobs.find(j => this.idsMatch(j.id, draggedId));
        const target = this.jobs.find(j => this.idsMatch(j.id, targetId));
        if (!dragged || !target || dragged === target) return;

        // Get ranked jobs sorted by current rank
        const ranked = this.jobs
            .filter(j => j.priority_rank != null)
            .sort((a, b) => a.priority_rank - b.priority_rank);

        // Remove dragged from its position, insert before target
        const from = ranked.findIndex(j => this.idsMatch(j.id, draggedId));
        const to = ranked.findIndex(j => this.idsMatch(j.id, targetId));
        if (from === -1 || to === -1) return;

        ranked.splice(from, 1);
        ranked.splice(to, 0, dragged);

        // Reassign ranks 1..n optimistically
        ranked.forEach((j, i) => { j.priority_rank = i + 1; });
        this.numberingCounter = ranked.length + 1;
        this.updateNumberingCounter();
        this.applyFilters();

        // Persist (fire-and-forget, no local state overwrite)
        ranked.forEach(j => this._persistRank(j.id, j.priority_rank));
        this.updateNumberedTabCount();
    }

    clearAllRanks() {
        const ranked = this.jobs.filter(j => j.priority_rank != null);
        // Optimistic: clear locally and re-render immediately
        ranked.forEach(j => { j.priority_rank = null; });
        this.numberingCounter = 1;
        this.updateNumberedTabCount();
        this.applyFilters();
        // Persist (fire-and-forget, no local state overwrite)
        ranked.forEach(j => this._persistRank(j.id, null));
    }

    toggleNumberingMode() {
        this.isNumberingMode = !this.isNumberingMode;
        const btn = document.getElementById('numbering-btn');
        const banner = document.getElementById('numbering-banner');
        const table = document.querySelector('.jobs-table');

        if (this.isNumberingMode) {
            this.numberingCounter = (this.jobs.filter(j => j.priority_rank != null).length) + 1;
            btn && btn.classList.add('active');
            banner && banner.classList.add('visible');
            table && table.closest('.table-container').classList.add('numbering-mode');
            this.updateNumberingCounter();
            // Switch to all view so rows are visible
            this.setActiveView('all');
        } else {
            btn && btn.classList.remove('active');
            banner && banner.classList.remove('visible');
            table && table.closest('.table-container').classList.remove('numbering-mode');
            this.updateNumberedTabCount();
            this.renderJobs();
        }
    }

    updateNumberingCounter() {
        const el = document.getElementById('numbering-counter');
        if (el) el.textContent = `#${this.numberingCounter}`;
    }

    updateNumberedTabCount() {
        const numbered = this.jobs.filter(j => j.priority_rank != null).length;
        const activeStatuses = ['saved', 'applied', 'resume_screening', 'interview'];
        const archiveStatuses = ['rejected', 'withdrawn', 'ended', 'ghosted', 'offer'];

        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set('numbered-jobs-count', numbered);
        set('all-jobs-count', this.jobs.length);
        set('all-jobs-count-badge', this.jobs.length);
        set('active-jobs-count', this.jobs.filter(j => activeStatuses.includes((j.status || 'saved').toLowerCase())).length);
        set('archive-jobs-count', this.jobs.filter(j => archiveStatuses.includes((j.status || 'saved').toLowerCase())).length);

        const infoEl = document.getElementById('pagination-info-text');
        if (infoEl) infoEl.textContent = `${this.filteredJobs.length} of ${this.jobs.length} applications`;
    }

    renderCards() {
        const container = document.getElementById('jobs-cards');
        if (!container) return;
        const logoColors = ['c1','c2','c3','c4','c5','c6'];
        const html = this.filteredJobs.map(job => {
            const company = this.sanitize(job.company || '—');
            const title = this.sanitize(job.title || 'Untitled role');
            const location = this.sanitize(job.location || '—');
            const status = (job.status || 'saved').toLowerCase();
            const source = this.sanitize(job.source || '');
            const logoLetter = company.charAt(0).toUpperCase();
            const logoColor = logoColors[company.charCodeAt(0) % 6];
            const logoInner = getCompanyLogoHTML(company, logoLetter);
            const favorite = !!job.favorite;
            const jobId = this.normalizeId(job.id);
            const dateStr = this.formatDate(job.applied_date);
            const url = this.sanitizeUrl(job.url);

            return `
                <div class="job-card">
                    <div class="job-card-head">
                        <div style="display:flex;gap:10px;align-items:flex-start;">
                            <div class="logo ${logoColor}">${logoInner}</div>
                            <div>
                                <div class="role">${title}</div>
                                <div class="meta-row" style="margin-top:3px;">
                                    <strong style="color:var(--f-ink);font-family:var(--f-display);">${company}</strong>
                                    <span class="sep">·</span>
                                    <span>${location}</span>
                                </div>
                            </div>
                        </div>
                        <button class="star-btn ${favorite ? 'on' : ''} favorite-toggle" data-id="${jobId}" title="${favorite ? 'Unstar' : 'Star'}">
                            <svg viewBox="0 0 16 16" fill="${favorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.4"><path d="M8 1.5l2 4.5 5 .5-3.7 3.4 1.1 4.9L8 12.4 3.6 14.8l1.1-4.9L1 6.5l5-.5z"></path></svg>
                        </button>
                    </div>
                    <div class="meta-row">
                        <span class="status-badge ${status}">${this.formatStatus(status)}</span>
                        ${source ? `<span class="sep">·</span><span style="font-family:var(--f-mono);font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--f-ink3);font-weight:600;">${source}</span>` : ''}
                    </div>
                    <div class="job-card-foot">
                        <span style="font-family:var(--f-mono);font-size:11px;color:var(--f-ink3);">${dateStr}</span>
                        <div style="display:flex;gap:4px;">
                            ${url ? `<a class="row-action" href="${url}" target="_blank" rel="noopener noreferrer" title="URL"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 3h4v4M13 3l-6 6"></path></svg></a>` : ''}
                            <button class="row-action edit" data-id="${jobId}" title="Edit"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 2l3 3-8 8H3v-3z"></path></svg></button>
                            <button class="row-action danger delete" data-id="${jobId}" title="Delete"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4h10M6 4V2h4v2M5 4l1 10h4l1-10"></path></svg></button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        container.innerHTML = html || '<div class="empty-state"><i class="fas fa-inbox"></i><h3>No jobs found</h3></div>';
        this.addJobCardEventListeners();
    }

    setActiveView(view) {
        this.activeView = view;
        document.querySelectorAll('.f-tab, .view-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.view === view);
        });
        this.applyFilters();
    }

    async handleRankClick(jobId) {
        const job = this.jobs.find(j => this.idsMatch(j.id, jobId));
        if (!job) return;

        if (job.priority_rank != null) {
            const removedRank = job.priority_rank;
            // Optimistic
            job.priority_rank = null;
            const toShift = this.jobs.filter(j => j.priority_rank != null && j.priority_rank > removedRank);
            toShift.forEach(j => j.priority_rank--);
            this.numberingCounter = this.jobs.filter(j => j.priority_rank != null).length + 1;
            this.updateNumberingCounter();
            this.renderJobs();
            this.updateNumberedTabCount();
            // Persist (fire-and-forget, no local state overwrite)
            this._persistRank(jobId, null);
            toShift.forEach(j => this._persistRank(j.id, j.priority_rank));
        } else {
            const newRank = this.numberingCounter;
            // Optimistic
            job.priority_rank = newRank;
            this.numberingCounter++;
            this.updateNumberingCounter();
            this.renderJobs();
            this.updateNumberedTabCount();
            // Persist (fire-and-forget, no local state overwrite)
            this._persistRank(jobId, newRank);
        }
    }

    showToast(message, type = 'success') {
        const existing = document.getElementById('resume-toast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.id = 'resume-toast';
        toast.textContent = message;
        toast.style.cssText = `
            position:fixed;bottom:24px;right:24px;z-index:99999;
            padding:10px 18px;border-radius:10px;font-size:13px;font-weight:500;
            color:#fff;box-shadow:0 4px 16px rgba(0,0,0,0.18);
            background:${type === 'error' ? '#dc2626' : '#16a34a'};
            opacity:0;transition:opacity 0.2s ease;
        `;
        document.body.appendChild(toast);
        requestAnimationFrame(() => { toast.style.opacity = '1'; });
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    async uploadResume(jobId, file) {
        const normalizedId = this.normalizeId(jobId);
        if (!normalizedId || !file) return;

        const ext = file.name.split('.').pop();
        const path = `${normalizedId}/resume.${ext}`;

        // Show uploading state immediately
        const cell = document.querySelector(`.resume-file-input[data-id="${jobId}"]`)?.closest('.resume-cell');
        if (cell) cell.innerHTML = `<span class="resume-uploading"><i class="fas fa-spinner fa-spin"></i> Uploading…</span>`;

        const { error: uploadError } = await this.supabase.storage
            .from('resumes')
            .upload(path, file, { upsert: true, contentType: 'application/pdf' });

        if (uploadError) {
            console.error('Resume upload error:', uploadError);
            this.showToast(`Upload failed: ${uploadError.message || JSON.stringify(uploadError)}`, 'error');
            this.applyFilters();
            return;
        }

        const { data: urlData } = this.supabase.storage.from('resumes').getPublicUrl(path);
        const publicUrl = urlData?.publicUrl;
        if (!publicUrl) {
            this.showToast('Upload failed — could not get URL.', 'error');
            this.applyFilters();
            return;
        }

        const { error: dbError } = await this.supabase
            .from('jobs')
            .update({ resume_url: publicUrl })
            .eq('id', normalizedId);

        if (dbError) {
            console.error('Resume URL save error:', dbError);
            this.showToast('Resume saved to storage but failed to link to job.', 'error');
            this.applyFilters();
            return;
        }

        const idx = this.jobs.findIndex(j => this.idsMatch(j.id, normalizedId));
        if (idx !== -1) this.jobs[idx].resume_url = publicUrl;
        const fidx = this.filteredJobs?.findIndex(j => this.idsMatch(j.id, normalizedId));
        if (fidx !== -1 && fidx != null) this.filteredJobs[fidx].resume_url = publicUrl;
        this.showToast('Resume uploaded successfully!');
        this.applyFilters();
    }

    async downloadResume(url) {
        try {
            const response = await fetch(url);
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = 'resume.pdf';
            a.click();
            URL.revokeObjectURL(blobUrl);
        } catch (e) {
            console.error('Download failed:', e);
            window.open(url, '_blank');
        }
    }

    async deleteResume(jobId) {
        const normalizedId = this.normalizeId(jobId);
        if (!normalizedId) return;

        const { error: dbError } = await this.supabase
            .from('jobs')
            .update({ resume_url: null })
            .eq('id', normalizedId);

        if (dbError) {
            console.error('Delete resume error:', dbError);
            this.showToast('Failed to delete resume.', 'error');
            return;
        }

        const idx = this.jobs.findIndex(j => this.idsMatch(j.id, normalizedId));
        if (idx !== -1) this.jobs[idx].resume_url = null;
        this.showToast('Resume deleted.');
        this.applyFilters();
    }

    async updateJobSource(id, newSource) {
        try {
            const normalizedId = this.normalizeId(id);
            if (!normalizedId) {
                console.error('Invalid job id supplied for source update:', id);
                alert('Unable to update source because this job is missing a valid id. Please refresh and try again.');
                return false;
            }
            console.log(`=== UPDATING JOB SOURCE ===`);
            console.log('Job ID:', normalizedId);
            console.log('New source:', newSource);

            const { data, error } = await this.supabase
                .from('jobs')
                .update({ source: newSource })
                .eq('id', normalizedId)
                .select()
                .single();

            if (error) {
                throw error;
            }

            // Update local data
            const jobIndex = this.jobs.findIndex(j => this.idsMatch(j.id, normalizedId));
            if (jobIndex !== -1) {
                this.jobs[jobIndex] = data;
            }

            await this.saveJobs();
            this.applyFilters();
            this.populateFilterOptions();
            
            console.log('✅ Source updated successfully in Supabase');
            return true;
        } catch (error) {
            console.error('Error updating job source:', error);
            alert('Could not update source. Please try again.');
            return false;
        }
    }

    async deleteJob(id) {
        try {
            const normalizedId = this.normalizeId(id);
            if (!normalizedId) {
                console.error('Delete requested without valid id:', id);
                alert('Unable to determine which job to delete. Please refresh and try again.');
                return;
            }

            let job = this.jobs.find(j => this.idsMatch(j.id, normalizedId));
            if (!job) {
                job = this.filteredJobs.find(j => this.idsMatch(j.id, normalizedId));
            }
            if (!job) {
                console.error('Job not found with id:', normalizedId);
                alert('Could not locate this job locally. Please refresh the dashboard and try again.');
                return;
            }

            console.log('=== DELETING JOB (modal) ===');
            console.log('Job to delete:', job.title, 'ID:', job.id);

            // Show modal and wait for confirmation
            const confirmed = await new Promise((resolve) => {
                const modal = document.getElementById('delete-job-modal');
                const btnConfirm = document.getElementById('confirm-delete-job');
                const btnCancel = document.getElementById('cancel-delete-job');
                const btnClose = document.getElementById('close-delete-job-modal');
                if (!modal) return resolve(false);

                const cleanup = () => {
                    btnConfirm?.removeEventListener('click', onYes);
                    btnCancel?.removeEventListener('click', onNo);
                    btnClose?.removeEventListener('click', onNo);
                };
                const onYes = () => { cleanup(); modal.style.display = 'none'; resolve(true); };
                const onNo = () => { cleanup(); modal.style.display = 'none'; resolve(false); };
                btnConfirm?.addEventListener('click', onYes, { once: true });
                btnCancel?.addEventListener('click', onNo, { once: true });
                btnClose?.addEventListener('click', onNo, { once: true });
                modal.style.display = 'flex';
            });

            if (!confirmed) return;

            const { error } = await this.supabase
                .from('jobs')
                .delete()
                .eq('id', normalizedId);

            if (error) {
                throw error;
            }

            // Remove from local data
            this.jobs = this.jobs.filter(j => !this.idsMatch(j.id, normalizedId));
            await this.saveJobs();
            this.applyFilters();
            this.populateFilterOptions();
            
            console.log('✅ Job deleted successfully from Supabase');
        } catch (error) {
            console.error('Error deleting job:', error);
            alert('Could not delete job. Please try again.');
        }
    }

    async deleteStatusHistoryEntry(jobId, entryIndex) {
        try {
            const normalizedId = this.normalizeId(jobId);
            if (!normalizedId) {
                console.error('Invalid job id supplied for status history delete:', jobId);
                alert('Unable to delete status history because this job is missing a valid id. Please refresh and try again.');
                return;
            }
            if (!confirm('Are you sure you want to delete this status change from history?')) {
                return;
            }

            const job = this.jobs.find(j => this.idsMatch(j.id, normalizedId));
            if (!job) {
                throw new Error('Job not found');
            }

            console.log('=== DELETING STATUS HISTORY ENTRY ===');
            console.log('Job ID:', normalizedId);
            console.log('Entry index:', entryIndex);

            // Get current status history
            const currentHistory = job.status_history || [];
            
            // Remove the entry at the specified index
            const updatedHistory = currentHistory.filter((_, index) => index !== entryIndex);

            // Update in Supabase
            const { data, error } = await this.supabase
                .from('jobs')
                .update({ status_history: updatedHistory })
                .eq('id', normalizedId)
                .select()
                .single();

            if (error) {
                throw error;
            }

            // Update local data
            const jobIndex = this.jobs.findIndex(j => this.idsMatch(j.id, normalizedId));
            if (jobIndex !== -1) {
                this.jobs[jobIndex] = data;
            }

            await this.saveJobs();
            
            // Re-open the modal with updated data
            this.openAddJobModal(data);
            
            console.log('✅ Status history entry deleted successfully');
        } catch (error) {
            console.error('Error deleting status history entry:', error);
            alert('Could not delete status history entry. Please try again.');
        }
    }

    async addStatusToHistory(jobId) {
        try {
            const newStatusSelect = document.getElementById('new-status-select');
            const newStatusDate = document.getElementById('new-status-date');
            
            if (!newStatusSelect || !newStatusDate) {
                throw new Error('Form fields not found');
            }
            
            const newStatus = newStatusSelect.value;
            const newDateTime = newStatusDate.value;
            
            if (!newStatus || !newDateTime) {
                alert('Please select both a status and date/time');
                return;
            }
            
            const normalizedId = this.normalizeId(jobId);
            if (!normalizedId) {
                console.error('Invalid job id supplied for status history add:', jobId);
                alert('Unable to update status history because this job is missing a valid id. Please refresh and try again.');
                return;
            }
            const job = this.jobs.find(j => this.idsMatch(j.id, normalizedId));
            if (!job) {
                throw new Error('Job not found');
            }
            
            console.log('=== ADDING STATUS TO HISTORY ===');
            console.log('Job ID:', normalizedId);
            console.log('New status:', newStatus);
            console.log('Date/Time:', newDateTime);
            
            // Create new status entry
            const newEntry = {
                status: newStatus,
                timestamp: new Date(newDateTime).toISOString(),
                date: new Date(newDateTime).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                })
            };
            
            // Get current history and add new entry
            const currentHistory = job.status_history || [];
            const updatedHistory = [...currentHistory, newEntry];
            
            // Sort by timestamp to keep chronological order
            updatedHistory.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            
            // Update in Supabase
            const { data, error } = await this.supabase
                .from('jobs')
                .update({ 
                    status: newStatus, // Also update the current status
                    status_history: updatedHistory 
                })
                .eq('id', normalizedId)
                .select()
                .single();
            
            if (error) {
                throw error;
            }
            
            // Update local data
            const jobIndex = this.jobs.findIndex(j => this.idsMatch(j.id, normalizedId));
            if (jobIndex !== -1) {
                this.jobs[jobIndex] = data;
            }
            
            await this.saveJobs();
            this.applyFilters();
            this.renderJobs();
            
            // Re-open the modal with updated data
            this.openAddJobModal(data);
            
            console.log('✅ Status added to history successfully');
        } catch (error) {
            console.error('Error adding status to history:', error);
            alert('Could not add status to history. Please try again.');
        }
    }

    // Rendering (same as before)
    renderJobs() {
        const jobsContainer = document.getElementById('jobs-container');
        if (!jobsContainer) return;

        if (this.filteredJobs.length === 0) {
            jobsContainer.innerHTML = `
                <tr class="empty-row">
                    <td colspan="9">
                        <div class="empty-state">
                            <i class="fas fa-inbox"></i>
                            <h3>No jobs found</h3>
                            <p>Try adjusting your filters or add a new job application.</p>
                        </div>
                    </td>
                </tr>
            `;
            this.renderPagination();
            return;
        }

        // Calculate pagination
        const totalPages = Math.ceil(this.filteredJobs.length / this.itemsPerPage);
        const startIndex = (this.currentPage - 1) * this.itemsPerPage;
        const endIndex = startIndex + this.itemsPerPage;
        const paginatedJobs = this.filteredJobs.slice(startIndex, endIndex);

        const rows = paginatedJobs.map(job => {
            const jobId = this.normalizeId(job.id);
            const title = this.sanitize(job.title || 'Untitled role');
            const company = this.sanitize(job.company || '—');
            const location = this.sanitize(job.location || '—');
            const status = job.status ? job.status.toLowerCase() : 'saved';
            const source = job.source || '';
            const appliedDate = this.formatDate(job.applied_date);
            const safeComments = this.sanitize(job.comments || '');
            const url = this.sanitizeUrl(job.url);
            const jobIdMarkup = job.job_id ? `<div class="job-meta">ID: ${this.sanitize(job.job_id)}</div>` : '';
            const commentTitle = job.comments ? safeComments.replace(/\r?\n/g, '&#10;') : 'Add comment';
            const linkMarkup = url
                ? `<a href="${url}" class="job-link" target="_blank" rel="noopener noreferrer" title="${this.sanitize(url)}"><i class="fas fa-external-link-alt"></i> View here</a>`
                : '<span class="job-link muted">No link</span>';
            const resumeUrl = job.resume_url ? this.sanitizeUrl(job.resume_url) : null;
            const resumeMarkup = resumeUrl
                ? `<div class="resume-cell-inner"><a href="${resumeUrl}" target="_blank" rel="noopener noreferrer" class="resume-link" title="View resume"><i class="fas fa-file-pdf"></i> View</a><button class="resume-download-btn" data-url="${resumeUrl}" title="Download resume"><i class="fas fa-download"></i></button><button class="resume-delete-btn" data-id="${jobId}" title="Remove resume">✕</button></div>`
                : `<label class="resume-upload-btn upload-empty" title="Upload resume"><i class="fas fa-upload"></i> Upload<input type="file" accept="application/pdf" class="resume-file-input" data-id="${jobId}" style="display:none;"></label>`;
            const favorite = !!job.favorite;
            const favoriteIconClass = favorite ? 'fas' : 'far';
            const favoriteLabel = favorite ? 'Unstar job' : 'Star job';
            
            const statusOptions = this.statusOptions.map(option => {
                const optionValue = option.toLowerCase();
                const isSelected = optionValue === status;
                return `<option value="${optionValue}"${isSelected ? ' selected' : ''}>${this.sanitize(this.formatStatus(optionValue))}</option>`;
            }).join('');
            
            const sourceOptions = this.sourceOptions.map(option => {
                const isSelected = option === source;
                return `<option value="${option}"${isSelected ? ' selected' : ''}>${this.sanitize(option)}</option>`;
            }).join('');

            const rank = job.priority_rank;
            const rankColors = ['#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#3b82f6','#8b5cf6','#ec4899','#14b8a6','#f59e0b'];
            const rankColor = rank != null ? rankColors[(rank - 1) % rankColors.length] : '#ccc';
            // Always render badge to reserve space; hide it when unranked
            const rankBadge = `<span class="rank-badge" style="background:${rankColor};${rank == null ? 'visibility:hidden;' : ''}">${rank ?? ''}</span>`;
            const rankCell = ``;
            const rowClass = rank != null ? 'is-ranked' : '';
            const isDraggable = this.activeView === 'numbered' && rank != null;

            const tag = (job.role_tag || getJobTag(job.title)).toUpperCase();
            const logoLetter = company.charAt(0).toUpperCase();
            const logoColor = 'c' + ((company.charCodeAt(0) % 6) + 1);
            const logoInner = getCompanyLogoHTML(company, logoLetter);
            const dateParts = appliedDate.split(' ');
            const dateDay = dateParts.slice(0, 2).join(' ');
            const dateYear = dateParts[2] || '';
            const [city, ...countryParts] = location.split(',');
            const country = countryParts.join(',').trim() || '';

            return `
                <tr data-id="${jobId}" class="${rowClass}" ${isDraggable ? 'draggable="true"' : ''}>
                    <td><input type="checkbox" class="job-checkbox" data-id="${jobId}"></td>
                    <td>
                        <div class="cell-date"><strong>${dateDay}</strong>${dateYear}</div>
                    </td>
                    <td>
                        <div class="star-rank-cell">
                            <button class="star-btn ${favorite ? 'on' : ''} favorite-toggle" data-id="${jobId}" title="${favoriteLabel}" aria-label="${favoriteLabel}">
                                <svg viewBox="0 0 16 16" fill="${favorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.4"><path d="M8 1.5l2 4.5 5 .5-3.7 3.4 1.1 4.9L8 12.4 3.6 14.8l1.1-4.9L1 6.5l5-.5z"></path></svg>
                            </button>
                            ${rankBadge}
                        </div>
                    </td>
                    <td>
                        <div class="company-cell">
                            <div class="logo ${logoColor}">${logoInner}</div>
                            <div>
                                <span class="name">${company}</span>
                                <span class="tag">${tag}</span>
                            </div>
                        </div>
                    </td>
                    <td>
                        <div class="title-cell">
                            <span class="role">${title}</span>
                            ${job.job_id ? `<span class="id">ID #${this.sanitize(job.job_id)}</span>` : ''}
                        </div>
                    </td>
                    <td>
                        <span class="loc-city">${city}</span>
                        ${country ? `<span class="loc-country">${country}</span>` : ''}
                    </td>
                    <td class="status-cell">
                        <div class="status-custom-dd" data-id="${jobId}">
                            <button class="status-dd-trigger" data-id="${jobId}">
                                <span class="status-badge ${status}">${this.formatStatus(status)}</span>
                                <svg viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.5" style="width:9px;height:9px;flex-shrink:0;"><path d="M1 1l4 4 4-4"></path></svg>
                            </button>
                            <div class="status-dd-menu">
                                ${this.statusOptions.map(opt => `<div class="status-dd-option" data-id="${jobId}" data-value="${opt.toLowerCase()}">${this.formatStatus(opt.toLowerCase())}</div>`).join('')}
                            </div>
                        </div>
                        <div class="status-date" data-id="${jobId}">${this.getLastStatusChangeDate(job)}</div>
                    </td>
                    <td class="source-cell">
                        <div class="src-select">
                            <select class="source-dropdown" data-id="${jobId}">
                                <option value="">Source</option>
                                ${sourceOptions}
                            </select>
                        </div>
                    </td>
                    <td class="url-cell">${linkMarkup}</td>
                    <td class="resume-cell">${resumeMarkup}</td>
                    <td class="actions-cell">
                        <div class="actions-cell-content">
                            <button class="row-action edit" data-id="${jobId}" title="Edit">
                                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 2l3 3-8 8H3v-3z"></path></svg>
                            </button>
                            <button class="row-action danger delete" data-id="${jobId}" title="Delete">
                                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4h10M6 4V2h4v2M5 4l1 10h4l1-10"></path></svg>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        jobsContainer.innerHTML = rows;
        this.addJobCardEventListeners();
        this.renderPagination();
    }

    addJobCardEventListeners() {
        // Checkbox change
        document.querySelectorAll('.job-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                this.updateSelectionUI();
            });
        });

        // Status change
        document.querySelectorAll('.status-dropdown').forEach(dropdown => {
            dropdown.addEventListener('change', async (e) => {
                const target = e.currentTarget;
                if (!target) return;
                const id = this.getElementJobId(target);
                if (!id) return;
                
                const job = this.jobs.find(j => this.idsMatch(j.id, id));
                const previousStatus = job ? job.status : 'saved';
                const newStatus = target.value;
                
                // Close the dropdown immediately
                target.blur();
                
                const success = await this.updateJobStatus(id, newStatus);
                if (!success && job) {
                    target.value = previousStatus;
                } else {
                    // Update the date display below the dropdown (just date, no time)
                    const statusDateElement = document.querySelector(`.status-date[data-id="${id}"]`);
                    if (statusDateElement) {
                        const now = new Date();
                        const formattedDate = now.toLocaleDateString('en-US', { 
                            month: 'short', 
                            day: 'numeric',
                            year: 'numeric'
                        });
                        statusDateElement.textContent = formattedDate;
                        statusDateElement.style.color = '#10b981'; // Green color for fresh change
                        setTimeout(() => {
                            statusDateElement.style.color = ''; // Reset to default after 2s
                        }, 2000);
                    }
                }
            });
        });

        // Custom status dropdown — open/close
        document.querySelectorAll('.status-dd-trigger').forEach(trigger => {
            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                const menu = trigger.nextElementSibling;
                const isOpen = menu.classList.contains('open');
                document.querySelectorAll('.status-dd-menu.open').forEach(m => {
                    m.classList.remove('open');
                    m.style.top = '';
                    m.style.left = '';
                });
                if (!isOpen) {
                    const rect = trigger.getBoundingClientRect();
                    menu.style.top = (rect.bottom + 6) + 'px';
                    menu.style.left = rect.left + 'px';
                    menu.classList.add('open');
                }
            });
        });

        // Custom status dropdown — option selected
        document.querySelectorAll('.status-dd-option').forEach(opt => {
            opt.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = opt.dataset.id;
                const newStatus = opt.dataset.value;
                const menu = opt.closest('.status-dd-menu');
                const trigger = menu?.previousElementSibling;
                const job = this.jobs.find(j => this.idsMatch(j.id, id));
                if (!job) return;
                menu.classList.remove('open');
                menu.style.top = '';
                menu.style.left = '';

                const success = await this.updateJobStatus(id, newStatus);
                if (success && trigger) {
                    trigger.querySelector('.status-badge').className = `status-badge ${newStatus}`;
                    trigger.querySelector('.status-badge').textContent = this.formatStatus(newStatus);
                    const statusDateEl = document.querySelector(`.status-date[data-id="${id}"]`);
                    if (statusDateEl) {
                        const now = new Date();
                        statusDateEl.textContent = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                        statusDateEl.style.color = '#10b981';
                        setTimeout(() => { statusDateEl.style.color = ''; }, 2000);
                    }
                }
            });
        });

        // Favorite toggle
        document.querySelectorAll('.favorite-toggle').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                const id = btn.dataset.id;
                if (!id) return;
                const job = this.jobs.find(j => this.idsMatch(j.id, id));
                if (!job) return;
                const nextValue = !job.favorite;
                btn.classList.add('updating');
                const success = await this.updateJobFavorite(id, nextValue);
                btn.classList.remove('updating');
                if (!success) return;
                job.favorite = nextValue;
                btn.classList.toggle('active', nextValue);
                const icon = btn.querySelector('i');
                if (icon) {
                    icon.classList.toggle('fas', nextValue);
                    icon.classList.toggle('far', !nextValue);
                }
                btn.setAttribute('title', nextValue ? 'Unstar job' : 'Star job');
                btn.setAttribute('aria-label', nextValue ? 'Unstar job' : 'Star job');
            });
        });

        // Source change
        document.querySelectorAll('.source-dropdown').forEach(dropdown => {
            dropdown.addEventListener('change', async (e) => {
                const target = e.currentTarget;
                if (!target) return;
                const id = this.getElementJobId(target);
                if (!id) return;
                
                const job = this.jobs.find(j => this.idsMatch(j.id, id));
                const previousSource = job ? job.source : '';
                const newSource = target.value;
                
                // Close the dropdown immediately
                target.blur();
                
                const success = await this.updateJobSource(id, newSource);
                if (!success && job) {
                    target.value = previousSource;
                }
            });
        });

        // Comment modal
        document.querySelectorAll('.comment-text').forEach(comment => {
            comment.addEventListener('click', (e) => {
                const target = e.currentTarget;
                if (!target) return;
                const id = this.getElementJobId(target);
                if (id) {
                    this.openCommentModal(id);
                }
            });
        });

        // Edit job
        document.querySelectorAll('.edit').forEach(editBtn => {
            editBtn.addEventListener('click', (e) => {
                const target = e.currentTarget;
                if (!target) return;
                const id = this.getElementJobId(target);
                if (id) {
                    this.editJob(id);
                }
            });
        });

        // Delete job
        document.querySelectorAll('.delete').forEach(deleteBtn => {
            deleteBtn.addEventListener('click', async (e) => {
                const target = e.currentTarget;
                if (!target) return;
                const id = this.getElementJobId(target);
                if (!id) {
                    console.warn('Delete icon clicked but no job id found', target);
                    alert('Unable to determine which job to delete. Please refresh and try again.');
                    return;
                }
                await this.deleteJob(id);
            });
        });
    }

    // Multi-select functionality
    getSelectedJobIds() {
        const checkboxes = document.querySelectorAll('.job-checkbox:checked');
        return Array.from(checkboxes)
            .map(cb => {
                const directId = this.normalizeId(cb.dataset.id);
                return directId || this.getElementJobId(cb);
            })
            .filter(Boolean);
    }

    selectAllJobs(select) {
        const checkboxes = document.querySelectorAll('.job-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.checked = select;
        });
        
        const selectAllCheckbox = document.getElementById('select-all-checkbox');
        if (selectAllCheckbox) {
            selectAllCheckbox.checked = select;
        }
        
        this.updateSelectionUI();
    }

    updateSelectionUI() {
        const selectedIds = this.getSelectedJobIds();
        
        // Update select-all checkbox state
        const checkboxes = document.querySelectorAll('.job-checkbox');
        const selectAllCheckbox = document.getElementById('select-all-checkbox');
        if (selectAllCheckbox && checkboxes.length > 0) {
            const allChecked = Array.from(checkboxes).every(cb => cb.checked);
            const someChecked = Array.from(checkboxes).some(cb => cb.checked);
            selectAllCheckbox.checked = allChecked;
            selectAllCheckbox.indeterminate = someChecked && !allChecked;
        }
        
        // Show/hide delete selected button
        const deleteSelectedBtn = document.getElementById('delete-selected-btn');
        const selectedCountSpan = document.getElementById('selected-count');
        if (deleteSelectedBtn && selectedCountSpan) {
            if (selectedIds.length > 0) {
                deleteSelectedBtn.style.display = 'flex';
                selectedCountSpan.textContent = selectedIds.length;
            } else {
                deleteSelectedBtn.style.display = 'none';
            }
        }
        
        console.log(`${selectedIds.length} job(s) selected`);
    }

    // Pagination
    renderPagination() {
        const paginationContainer = document.getElementById('pagination-container');
        if (!paginationContainer) return;

        const totalPages = Math.ceil(this.filteredJobs.length / this.itemsPerPage);
        
        if (totalPages <= 1) {
            paginationContainer.innerHTML = '';
            return;
        }

        // Calculate range
        const startIndex = (this.currentPage - 1) * this.itemsPerPage + 1;
        const endIndex = Math.min(this.currentPage * this.itemsPerPage, this.filteredJobs.length);
        
        let paginationHTML = `
            <div class="pagination-info">
                Showing ${startIndex}-${endIndex} of ${this.filteredJobs.length} entries
            </div>
            <div class="pagination-buttons">
        `;

        // Previous button
        paginationHTML += `
            <button class="pagination-btn" ${this.currentPage === 1 ? 'disabled' : ''} data-page="prev">
                <i class="fas fa-chevron-left"></i> Previous
            </button>
        `;

        // Page numbers
        const maxVisiblePages = 5;
        let startPage = Math.max(1, this.currentPage - Math.floor(maxVisiblePages / 2));
        let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
        
        if (endPage - startPage < maxVisiblePages - 1) {
            startPage = Math.max(1, endPage - maxVisiblePages + 1);
        }

        // First page + ellipsis
        if (startPage > 1) {
            paginationHTML += `<button class="pagination-btn" data-page="1">1</button>`;
            if (startPage > 2) {
                paginationHTML += `<span class="pagination-ellipsis">...</span>`;
            }
        }

        // Page numbers
        for (let i = startPage; i <= endPage; i++) {
            paginationHTML += `
                <button class="pagination-btn ${i === this.currentPage ? 'active' : ''}" data-page="${i}">
                    ${i}
                </button>
            `;
        }

        // Last page + ellipsis
        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                paginationHTML += `<span class="pagination-ellipsis">...</span>`;
            }
            paginationHTML += `<button class="pagination-btn" data-page="${totalPages}">${totalPages}</button>`;
        }

        // Next button
        paginationHTML += `
            <button class="pagination-btn" ${this.currentPage === totalPages ? 'disabled' : ''} data-page="next">
                Next <i class="fas fa-chevron-right"></i>
            </button>
        `;

        paginationHTML += `</div>`;
        
        paginationContainer.innerHTML = paginationHTML;

        // Add event listeners
        paginationContainer.querySelectorAll('.pagination-btn:not([disabled])').forEach(btn => {
            btn.addEventListener('click', () => {
                const page = btn.dataset.page;
                if (page === 'prev') {
                    this.goToPage(this.currentPage - 1);
                } else if (page === 'next') {
                    this.goToPage(this.currentPage + 1);
                } else {
                    this.goToPage(parseInt(page));
                }
            });
        });
    }

    goToPage(page) {
        const totalPages = Math.ceil(this.filteredJobs.length / this.itemsPerPage);
        if (page < 1 || page > totalPages) return;
        
        this.currentPage = page;
        this.renderJobs();
        
        // Scroll to top of table
        const tableContainer = document.querySelector('.table-container');
        if (tableContainer) {
            tableContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    exportToCSV(jobs, filename) {
        if (!jobs || jobs.length === 0) {
            alert('No jobs to export');
            return;
        }

        const csv = convertToCSV(jobs);
        downloadCSV(csv, filename);
    }

    async exportAllJobs() {
        console.log('📥 Starting full backup export...');

        // Get ALL jobs directly from Supabase to ensure we have the latest data
        const { data: supabaseJobs, error } = await this.supabase
            .from('jobs')
            .select('*')
            .order('applied_date', { ascending: false });

        if (error) {
            console.error('❌ Error fetching jobs from Supabase:', error);
            alert('Error fetching jobs from database. Exporting local data instead.');
            // Fallback to local data if Supabase fails
            const timestamp = new Date().toISOString().split('T')[0];
            const filename = `job-tracker-backup-${timestamp}.csv`;
            this.exportToCSV(this.jobs, filename);
            return;
        }

        console.log(`📊 Retrieved ${supabaseJobs.length} jobs from Supabase`);

        // Check if there are any local-only jobs (not in Supabase)
        const supabaseIds = new Set(supabaseJobs.map(j => j.id));
        const localOnlyJobs = this.jobs.filter(j => !supabaseIds.has(j.id));

        if (localOnlyJobs.length > 0) {
            console.warn(`⚠️ Found ${localOnlyJobs.length} jobs in local but NOT in Supabase`);
            console.warn('These jobs will be included in the backup but should be synced to Supabase!');
            console.log('💡 Run syncMissingToSupabase() to sync these jobs');
        }

        // Combine Supabase jobs + any local-only jobs
        const allJobs = [...supabaseJobs, ...localOnlyJobs];

        const timestamp = new Date().toISOString().split('T')[0];
        const filename = `job-tracker-backup-${timestamp}.csv`;

        this.exportToCSV(allJobs, filename);

        console.log(`✅ Exported ${allJobs.length} jobs to ${filename}`);
        if (localOnlyJobs.length > 0) {
            console.log(`   └─ Includes ${localOnlyJobs.length} local-only jobs (NOT in Supabase)`);
        }

        // Show alert if there are local-only jobs
        if (localOnlyJobs.length > 0) {
            alert(
                `Backup created with ${allJobs.length} jobs.\n\n` +
                `⚠️ Warning: ${localOnlyJobs.length} jobs are only in local memory (NOT in Supabase).\n\n` +
                `Run syncMissingToSupabase() in console to sync them to the database.`
            );
        }
    }

    async exportSelectedJobs() {
        const selectedIds = this.getSelectedJobIds();
        if (selectedIds.length === 0) {
            alert('Please select jobs to export');
            return;
        }

        const selectedJobs = this.jobs.filter(job => selectedIds.includes(this.normalizeId(job.id)));
        this.exportToCSV(selectedJobs, `selected-jobs-${new Date().toISOString().split('T')[0]}.csv`);
    }

    async deleteSelectedJobs() {
        console.log('🗑️ deleteSelectedJobs called');
        const selectedIds = this.getSelectedJobIds();
        console.log('Selected IDs:', selectedIds);

        if (selectedIds.length === 0) {
            alert('Please select jobs to delete');
            return;
        }

        const confirmMsg = `Are you sure you want to delete ${selectedIds.length} job(s)? This cannot be undone.`;
        console.log('Showing confirmation dialog...');
        if (!confirm(confirmMsg)) {
            console.log('User cancelled deletion');
            return;
        }
        console.log('User confirmed deletion');

        let successCount = 0;
        let errorCount = 0;

        for (const id of selectedIds) {
            const normalizedId = this.normalizeId(id);
            if (!normalizedId) {
                console.warn('Skipping delete for selected row with missing id:', id);
                continue;
            }
            try {
                const { error } = await this.supabase
                    .from('jobs')
                    .delete()
                    .eq('id', normalizedId);

                if (error) {
                    console.error('Error deleting job:', normalizedId, error);
                    errorCount++;
                } else {
                    successCount++;
                }
            } catch (error) {
                console.error('Error deleting job:', normalizedId, error);
                errorCount++;
            }
        }

        // Reload jobs
        await this.loadJobs();
        this.renderJobs();
        this.updateStats();
        this.populateFilterOptions();

        // Clear all selections after deletion
        const selectAllCheckbox = document.getElementById('select-all-checkbox');
        if (selectAllCheckbox) {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = false;
        }

        // Update selection UI to hide delete button
        this.updateSelectionUI();

        if (errorCount > 0) {
            alert(`Deleted ${successCount} job(s). ${errorCount} failed.`);
        } else {
            alert(`Successfully deleted ${successCount} job(s)`);
        }
    }

    editJob(id) {
        const normalizedId = this.normalizeId(id);
        const job = this.jobs.find(j => this.idsMatch(j.id, normalizedId));
        if (!job) return;
        this.openAddJobModal(job);
    }

    openCommentModal(id) {
        const normalizedId = this.normalizeId(id);
        const job = this.jobs.find(j => this.idsMatch(j.id, normalizedId));
        if (!job) return;

        this.currentCommentJobId = normalizedId;
        document.getElementById('comment-text').value = job.comments || '';
        document.getElementById('comment-modal').style.display = 'flex';
    }

    openAddJobModal(jobData = null) {
        this.editingJobId = jobData ? this.normalizeId(jobData.id) : null;
        
        if (jobData) {
            // Pre-fill form with job data
            document.getElementById('job-title').value = jobData.title || '';
            document.getElementById('job-company').value = jobData.company || '';
            document.getElementById('job-location').value = jobData.location || '';
            document.getElementById('job-url').value = jobData.url || '';
            document.getElementById('job-description').value = jobData.description || '';
            document.getElementById('job-notes').value = jobData.notes || '';
            document.getElementById('job-external-id').value = jobData.job_id || jobData.jobId || '';
            document.getElementById('job-status').value = jobData.status || 'applied';
            
            // Show and populate status history
            const historySection = document.getElementById('status-history-section');
            const historyList = document.getElementById('status-history-list');
            
            // Build complete history array and store in temp
            const completeHistory = [];
            
            // Always add the original "Saved" status with creation date
            const createdDate = new Date(jobData.created_at || jobData.applied_date);
            completeHistory.push({
                status: 'saved',
                timestamp: jobData.created_at || jobData.applied_date,
                date: createdDate.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                }),
                isOriginal: true
            });
            
            // Add all subsequent status changes from status_history
            if (jobData.status_history && jobData.status_history.length > 0) {
                jobData.status_history.forEach(entry => {
                    // Skip if it's the same as the original saved status
                    if (entry.status !== 'saved' || new Date(entry.timestamp).getTime() !== createdDate.getTime()) {
                        const date = new Date(entry.timestamp);
                        completeHistory.push({
                            status: entry.status,
                            timestamp: entry.timestamp,
                            date: date.toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                            }),
                            isOriginal: false
                        });
                    }
                });
            }
            
            // Store in temp history (reversed for most recent first display)
            this.tempStatusHistory = [...completeHistory].reverse();
            
            // Show history section if there's any history
            if (completeHistory.length > 0) {
                historySection.style.display = 'block';
                this.renderStatusHistory();
                
                // Add event listener for "Add Status" button
                const addStatusBtn = document.getElementById('add-status-btn');
                if (addStatusBtn) {
                    addStatusBtn.onclick = () => {
                        this.addStatusToTempHistory();
                    };
                }
                
                // Set default datetime to now
                const newStatusDate = document.getElementById('new-status-date');
                if (newStatusDate) {
                    const now = new Date();
                    const year = now.getFullYear();
                    const month = String(now.getMonth() + 1).padStart(2, '0');
                    const day = String(now.getDate()).padStart(2, '0');
                    const hours = String(now.getHours()).padStart(2, '0');
                    const minutes = String(now.getMinutes()).padStart(2, '0');
                    newStatusDate.value = `${year}-${month}-${day}T${hours}:${minutes}`;
                }
            } else {
                historySection.style.display = 'none';
            }
        } else {
            // Clear form
            document.getElementById('add-job-form').reset();
            document.getElementById('status-history-section').style.display = 'none';
        }
        
        document.getElementById('add-job-modal').style.display = 'flex';
    }

    renderStatusHistory() {
        const historyList = document.getElementById('status-history-list');
        if (!historyList) return;
        
        historyList.innerHTML = this.tempStatusHistory
            .map((entry, index) => {
                const originalBadge = entry.isOriginal ? ' <span style="font-size: 0.7rem; color: #10b981; font-weight: 600;">(Original)</span>' : '';
                const deleteBtn = !entry.isOriginal ? `<button class="delete-status-btn-temp" data-index="${index}" title="Delete this status change"><i class="fas fa-times"></i></button>` : '';
                const dragHandle = `<i class="fas fa-grip-vertical drag-handle"></i>`;
                return `
                    <div class="status-history-item" draggable="${!entry.isOriginal}" data-index="${index}">
                        ${!entry.isOriginal ? dragHandle : ''}
                        <span class="status-history-status">${this.formatStatus(entry.status)}${originalBadge}</span>
                        <div style="display: flex; align-items: center; gap: 1rem;">
                            <span class="status-history-date">${entry.date}</span>
                            ${deleteBtn}
                        </div>
                    </div>
                `;
            })
            .join('');
        
        // Add delete event listeners
        document.querySelectorAll('.delete-status-btn-temp').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const index = parseInt(btn.dataset.index);
                this.deleteFromTempHistory(index);
            });
        });
        
        // Add drag-and-drop listeners
        this.setupDragAndDrop();
    }

    setupStatusDeleteConfirmModal() {
        const modal = document.getElementById('status-delete-confirm');
        if (!modal) return;
        const cancelBtn = document.getElementById('cancel-status-delete');
        const closeBtn = document.getElementById('close-status-delete-modal');
        const confirmBtn = document.getElementById('confirm-status-delete');
        const hideModal = () => {
            modal.classList.remove('show');
            this.pendingStatusDeleteIndex = null;
        };

        cancelBtn?.addEventListener('click', hideModal);
        closeBtn?.addEventListener('click', hideModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) hideModal();
        });
        confirmBtn?.addEventListener('click', () => {
            if (this.pendingStatusDeleteIndex !== null) {
                this.performStatusDelete(this.pendingStatusDeleteIndex);
            }
            hideModal();
        });
    }

    setupDragAndDrop() {
        const items = document.querySelectorAll('.status-history-item[draggable="true"]');
        
        items.forEach(item => {
            item.addEventListener('dragstart', (e) => {
                e.target.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/html', e.target.innerHTML);
            });
            
            item.addEventListener('dragend', (e) => {
                e.target.classList.remove('dragging');
            });
            
            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                
                const dragging = document.querySelector('.dragging');
                if (dragging && dragging !== e.target) {
                    const allItems = [...document.querySelectorAll('.status-history-item')];
                    const draggingIndex = allItems.indexOf(dragging);
                    const targetIndex = allItems.indexOf(e.target);
                    
                    if (draggingIndex > targetIndex) {
                        e.target.parentNode.insertBefore(dragging, e.target);
                    } else {
                        e.target.parentNode.insertBefore(dragging, e.target.nextSibling);
                    }
                }
            });
            
            item.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // Reorder temp history based on new DOM order
                const items = document.querySelectorAll('.status-history-item');
                this.tempStatusHistory = Array.from(items).map((item, index) => {
                    const originalIndex = parseInt(item.dataset.index);
                    item.dataset.index = index;
                    return this.tempStatusHistory[originalIndex];
                });
                
                this.renderStatusHistory();
            });
        });
    }

    addStatusToTempHistory() {
        const newStatusSelect = document.getElementById('new-status-select');
        const newStatusDate = document.getElementById('new-status-date');
        
        if (!newStatusSelect || !newStatusDate) return;
        
        const newStatus = newStatusSelect.value;
        const newDateTime = newStatusDate.value;
        
        if (!newStatus || !newDateTime) {
            alert('Please select both a status and date/time');
            return;
        }
        
        const newEntry = {
            status: newStatus,
            timestamp: new Date(newDateTime).toISOString(),
            date: new Date(newDateTime).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            }),
            isOriginal: false
        };
        
        this.tempStatusHistory.push(newEntry);
        
        // Sort by timestamp (most recent first)
        this.tempStatusHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        this.renderStatusHistory();
        
        // Reset datetime to now
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        newStatusDate.value = `${year}-${month}-${day}T${hours}:${minutes}`;
    }

    deleteFromTempHistory(index) {
        const modal = document.getElementById('status-delete-confirm');
        if (modal) {
            this.pendingStatusDeleteIndex = index;
            modal.classList.add('show');
        } else {
            this.performStatusDelete(index);
        }
    }

    performStatusDelete(index) {
        if (index === undefined || index === null || Number.isNaN(index)) return;
        this.tempStatusHistory.splice(index, 1);
        this.renderStatusHistory();
    }

    // Statistics
    updateStats(skipActivityUpdate = false) {
        // Stats should show FILTERED jobs (respects current filters)
        const totalApplications = this.filteredJobs.length;
        const companies = new Set(this.filteredJobs.map(job => job.company).filter(Boolean)).size;
        const locations = new Set(this.filteredJobs.map(job => job.location).filter(Boolean)).size;

        // Calculate comprehensive streak history based on all jobs (not filtered)
        const streakHistory = this.calculateStreakHistory();

        document.getElementById('total-applications').textContent = totalApplications;
        document.getElementById('total-companies').textContent = companies;
        document.getElementById('total-locations').textContent = locations;
        document.getElementById('current-streak').textContent = streakHistory.currentStreak;
        document.getElementById('highest-streak').textContent = streakHistory.highestStreak;

        // Show notification if streak just broke
        if (streakHistory.streakJustBroke && streakHistory.lastBreakDate) {
            this.showStreakBreakNotification(streakHistory);
        }

        // Update insights metrics (always uses all jobs)
        this.updateInsights();

        // Update pie charts
        this.updatePieCharts();

        // Only update activity summary if not skipped (e.g., when clicking on a day)
        if (!skipActivityUpdate) {
            // Populate month selector
            this.populateMonthSelector();

            // Update activity summary cards
            this.updateActivitySummary();
        }
    }

    updatePieCharts() {
        this.renderJobTypePieChart();
        this.renderLocationsPieChart();
        this.renderCompaniesPieChart();
        this.renderSourcesPieChart();
    }

    renderJobTypePieChart() {
        const canvas = document.getElementById('job-type-chart');
        if (!canvas) return;

        const activeJobs = this.jobs.filter(job =>
            (job.status || '').toLowerCase() !== 'saved'
        );

        let sdeCount = 0, pmCount = 0, dataCount = 0;
        activeJobs.forEach(job => {
            const tag = job.role_tag || getJobTag(job.title);
            if (tag === 'pm') pmCount++;
            else if (tag === 'data') dataCount++;
            else sdeCount++;
        });

        if (this.jobTypeChart) this.jobTypeChart.destroy();

        this.jobTypeChart = new Chart(canvas, {
            type: 'pie',
            data: {
                labels: ['SDE', 'PM', 'Data'],
                datasets: [{
                    data: [sdeCount, pmCount, dataCount],
                    backgroundColor: ['#3b82f6', '#22c55e', '#ec4899'],
                    borderWidth: 2,
                    borderColor: '#fff'
                }]
            },
            options: this.getPieChartOptions()
        });
    }

    renderLocationsPieChart() {
        const canvas = document.getElementById('locations-chart');
        if (!canvas) return;

        // Filter to exclude jobs with "Saved" status (include everything else)
        const activeJobs = this.jobs.filter(job =>
            (job.status || '').toLowerCase() !== 'saved'
        );

        // Count jobs by location
        const locationCounts = {};
        activeJobs.forEach(job => {
            const location = job.location || 'Unknown';
            locationCounts[location] = (locationCounts[location] || 0) + 1;
        });

        // Convert to array and sort by count
        const sortedLocations = Object.entries(locationCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8); // Top 8 locations

        const labels = sortedLocations.map(([location]) => location);
        const data = sortedLocations.map(([_, count]) => count);
        const colors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

        // Destroy existing chart
        if (this.locationsChart) {
            this.locationsChart.destroy();
        }

        this.locationsChart = new Chart(canvas, {
            type: 'pie',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: colors,
                    borderWidth: 2,
                    borderColor: '#fff'
                }]
            },
            options: this.getPieChartOptions()
        });
    }

    renderCompaniesPieChart() {
        const canvas = document.getElementById('companies-chart');
        if (!canvas) return;

        // Count jobs by company (all statuses)
        const companyCounts = {};
        this.jobs.forEach(job => {
            const company = job.company || 'Unknown';
            companyCounts[company] = (companyCounts[company] || 0) + 1;
        });

        // Filter companies with 3+ applications and sort by count
        const topCompanies = Object.entries(companyCounts)
            .filter(([_, count]) => count >= 3)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10); // Top 10 companies

        // Destroy existing chart
        if (this.companiesChart) {
            this.companiesChart.destroy();
        }

        if (topCompanies.length === 0) {
            // Show empty state
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.font = '14px sans-serif';
            ctx.fillStyle = '#999';
            ctx.textAlign = 'center';
            ctx.fillText('No companies with 3+ apps', canvas.width / 2, canvas.height / 2);
            return;
        }

        const labels = topCompanies.map(([company]) => company);
        const data = topCompanies.map(([_, count]) => count);
        const colors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16'];

        this.companiesChart = new Chart(canvas, {
            type: 'pie',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: colors,
                    borderWidth: 2,
                    borderColor: '#fff'
                }]
            },
            options: this.getPieChartOptions()
        });
    }

    renderSourcesPieChart() {
        const canvas = document.getElementById('sources-chart');
        if (!canvas) return;

        // Filter to exclude jobs with "Saved" status (include everything else)
        const activeJobs = this.jobs.filter(job =>
            (job.status || '').toLowerCase() !== 'saved'
        );

        // Count jobs by source
        const sourceCounts = {};
        activeJobs.forEach(job => {
            const source = job.source || 'Unknown';
            sourceCounts[source] = (sourceCounts[source] || 0) + 1;
        });

        // Convert to array and sort by count
        const sortedSources = Object.entries(sourceCounts)
            .sort((a, b) => b[1] - a[1]);

        const labels = sortedSources.map(([source]) => source);
        const data = sortedSources.map(([_, count]) => count);
        const colors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

        // Destroy existing chart
        if (this.sourcesChart) {
            this.sourcesChart.destroy();
        }

        this.sourcesChart = new Chart(canvas, {
            type: 'pie',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: colors,
                    borderWidth: 2,
                    borderColor: '#fff'
                }]
            },
            options: this.getPieChartOptions()
        });
    }

    getPieChartOptions() {
        const isDark = document.body.classList.contains('dark-mode');
        const textColor = isDark ? '#e2e8f0' : (getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#333');
        return {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 15,
                        font: {
                            size: 12
                        },
                        color: textColor
                    }
                },
                tooltip: {
                    backgroundColor: isDark ? 'rgba(15, 23, 42, 0.9)' : 'rgba(30, 30, 30, 0.92)',
                    titleColor: '#fff',
                    bodyColor: 'rgba(255,255,255,0.85)',
                    padding: 12,
                    cornerRadius: 8,
                    displayColors: true,
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = ((value / total) * 100).toFixed(1);
                            return `${label}: ${value} (${percentage}%)`;
                        }
                    }
                }
            }
        };
    }
    
    showWeekBreakdownByDates(weekStartDate, weekEndDate, weekNumber = null) {
        // Use the provided Monday-Sunday week dates
        
        // Update title to show which week is selected
        const weekTitle = document.querySelector('.activity-card:nth-child(2) .activity-title');
        if (weekTitle && weekNumber !== null) {
            const formatWeekDate = (date) => {
                const month = date.toLocaleDateString(undefined, { month: 'short' });
                const day = date.getDate();
                return `${month} ${day}`;
            };
            const weekRangeText = `${formatWeekDate(weekStartDate)} - ${formatWeekDate(weekEndDate)}`;
            weekTitle.innerHTML = `Week ${weekNumber} <span class="week-range">${weekRangeText}</span>`;
        }
        
        // Remove 'selected' class from all week items and day items
        document.querySelectorAll('.week-item').forEach(item => item.classList.remove('selected'));
        document.querySelectorAll('.day-item').forEach(item => item.classList.remove('selected'));
        
        // Add 'selected' class to the clicked week
        if (weekNumber !== null) {
            const selectedWeekItem = document.getElementById(`week-${weekNumber}`)?.closest('.week-item');
            if (selectedWeekItem) {
                selectedWeekItem.classList.add('selected');
            }
        }
        
        // Calculate day counts for this specific week
        const dayMap = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
        const dayCounts = {
            'mon': 0, 'tue': 0, 'wed': 0, 'thu': 0, 
            'fri': 0, 'sat': 0, 'sun': 0
        };
        let weekTotal = 0;
        
        this.jobs.forEach(job => {
            if (!job.applied_date) return;
            if (job.status === 'saved') return; // Exclude saved jobs from counts
            
            const parts = job.applied_date.split('-');
            const jobDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            
            if (jobDate >= weekStartDate && jobDate <= weekEndDate) {
                weekTotal++;
                const dayOfWeek = jobDate.getDay();
                const dayKey = dayMap[dayOfWeek];
                
                // Debug logging
                console.log(`📅 Job date: ${job.applied_date} -> ${jobDate.toDateString()} -> Day ${dayOfWeek} (${dayKey})`);
                
                dayCounts[dayKey]++;
            }
        });
        
        // Update the "This Week" card with this week's data
        document.getElementById('week-total').textContent = weekTotal;
        
        // Update week range
        const formatWeekDate = (date) => {
            const month = date.toLocaleDateString(undefined, { month: 'short' });
            const day = date.getDate();
            return `${month} ${day}`;
        };
        
        const weekRangeText = `(${formatWeekDate(weekStartDate)} - ${formatWeekDate(weekEndDate)})`;
        const weekRangeElement = document.getElementById('week-range');
        if (weekRangeElement) {
            weekRangeElement.textContent = weekRangeText;
        }
        
        // Update each day's count
        Object.keys(dayCounts).forEach(day => {
            const element = document.getElementById(`day-${day}`);
            if (element) {
                element.textContent = dayCounts[day];
                
                // Remove any existing active class (since this is a custom week view)
                element.classList.remove('active');
                
                // Make clickable - add pointer cursor
                const dayItem = element.closest('.day-item');
                if (dayItem) {
                    dayItem.style.cursor = dayCounts[day] > 0 ? 'pointer' : 'default';
                    
                    // Remove old event listeners by cloning
                    const newDayItem = dayItem.cloneNode(true);
                    dayItem.parentNode.replaceChild(newDayItem, dayItem);
                    
                    // Add click handler to filter by this day
                    if (dayCounts[day] > 0) {
                        newDayItem.addEventListener('click', () => {
                            this.filterByWeekDay(day, dayMap, weekStartDate);
                        });
                    }
                }
            }
        });
    }

    filterByWeekDay(dayKey, dayMap, weekStart) {
        // Convert day key to day number (0-6)
        const dayNumber = dayMap.indexOf(dayKey);
        
        // Calculate the date for this day
        const targetDate = new Date(weekStart);
        const mondayDayNumber = 1; // Monday is day 1
        
        // Calculate days from Monday
        let daysFromMonday;
        if (dayNumber === 0) { // Sunday
            daysFromMonday = 6;
        } else {
            daysFromMonday = dayNumber - 1;
        }
        
        targetDate.setDate(weekStart.getDate() + daysFromMonday);
        targetDate.setHours(0, 0, 0, 0);
        
        // Format date for filtering
        const year = targetDate.getFullYear();
        const month = String(targetDate.getMonth() + 1).padStart(2, '0');
        const day = String(targetDate.getDate()).padStart(2, '0');
        const dateString = `${year}-${month}-${day}`;
        
        // Filter jobs by this specific date
        this.filteredJobs = this.jobs.filter(job => job.applied_date === dateString);
        this.currentPage = 1;
        this.renderJobs();
        this.updateStats(true); // Skip activity update to keep week/month cards unchanged
        
        // Remove 'selected' class from all day items
        document.querySelectorAll('.day-item').forEach(item => item.classList.remove('selected'));
        
        // Add 'selected' class to the clicked day
        const selectedDayItem = document.getElementById(`day-${dayKey}`)?.closest('.day-item');
        if (selectedDayItem) {
            selectedDayItem.classList.add('selected');
        }
    }

    populateMonthSelector() {
        const monthSelector = document.getElementById('month-selector');
        if (!monthSelector) return;
        
        // Get all unique months from jobs
        const monthsSet = new Set();
        this.jobs.forEach(job => {
            if (job.applied_date) {
                const parts = job.applied_date.split('-');
                const year = parseInt(parts[0]);
                const month = parseInt(parts[1]) - 1; // 0-indexed
                monthsSet.add(`${year}-${month}`);
            }
        });
        
        // Convert to array and sort ascending (oldest → newest)
        const months = Array.from(monthsSet)
            .map(key => {
                const [year, month] = key.split('-');
                return { year: parseInt(year), month: parseInt(month) };
            })
            .sort((a, b) => {
                if (a.year !== b.year) return a.year - b.year;
                return a.month - b.month;
            });
        
        // Populate dropdown
        monthSelector.innerHTML = '';
        months.forEach(({ year, month }) => {
            const option = document.createElement('option');
            const date = new Date(year, month, 1);
            const monthName = date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
            option.value = `${year}-${month}`;
            option.textContent = monthName;
            
            // Select current month by default
            const now = new Date();
            if (year === now.getFullYear() && month === now.getMonth()) {
                option.selected = true;
                this.selectedMonth = { year, month };
            }
            
            monthSelector.appendChild(option);
        });
        
        // If no months or current month not in data, select first option
        if (months.length > 0 && !this.selectedMonth) {
            this.selectedMonth = { year: months[0].year, month: months[0].month };
            monthSelector.selectedIndex = 0;
        }
    }

    updateActivitySummary() {
        // This Week breakdown
        const now = new Date();
        const currentDay = now.getDay();
        const mondayOffset = currentDay === 0 ? 6 : currentDay - 1;
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - mondayOffset);
        weekStart.setHours(0, 0, 0, 0);
        
        const dayCounts = { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 };
        const dayMap = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
        
        let weekTotal = 0;
        
        this.jobs.forEach(job => {
            if (!job.applied_date) return;
            if (job.status === 'saved') return; // Exclude saved jobs from counts
            
            const parts = job.applied_date.split('-');
            const jobDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            jobDate.setHours(0, 0, 0, 0);
            
            // Check if job is in this week
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            weekEnd.setHours(23, 59, 59, 999);
            
            if (jobDate >= weekStart && jobDate <= weekEnd) {
                const dayOfWeek = jobDate.getDay();
                const dayKey = dayMap[dayOfWeek];
                dayCounts[dayKey]++;
                weekTotal++;
            }
        });
        
        // Format week range
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        
        const formatWeekDate = (date) => {
            const month = date.toLocaleDateString(undefined, { month: 'short' });
            const day = date.getDate();
            return `${month} ${day}`;
        };
        
        const weekRangeText = `(${formatWeekDate(weekStart)} - ${formatWeekDate(weekEnd)})`;
        const weekRangeElement = document.getElementById('week-range');
        if (weekRangeElement) {
            weekRangeElement.textContent = weekRangeText;
        }
        
        // Update week display
        document.getElementById('week-total').textContent = weekTotal;
        Object.keys(dayCounts).forEach(day => {
            const element = document.getElementById(`day-${day}`);
            if (element) {
                element.textContent = dayCounts[day];
                
                // Highlight today with 'selected' class on initial load
                const todayKey = dayMap[currentDay];
                const dayItem = element.closest('.day-item');
                if (dayItem && day === todayKey) {
                    dayItem.classList.add('selected');
                }
                
                // Make clickable - add pointer cursor
                if (dayItem) {
                    dayItem.style.cursor = dayCounts[day] > 0 ? 'pointer' : 'default';
                    
                    // Remove old event listeners by cloning
                    const newDayItem = dayItem.cloneNode(true);
                    dayItem.parentNode.replaceChild(newDayItem, dayItem);
                    
                    // Add click handler to filter by this day
                    if (dayCounts[day] > 0) {
                        newDayItem.addEventListener('click', () => {
                            this.filterByWeekDay(day, dayMap, weekStart);
                        });
                    }
                }
            }
        });
        
        // This Month breakdown by weeks (Monday-Sunday calendar weeks)
        // Use selected month or default to current month
        const selectedDate = this.selectedMonth ? new Date(this.selectedMonth.year, this.selectedMonth.month, 1) : now;
        const monthStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
        const monthEnd = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0);
        
        // Calculate Monday-Sunday weeks that overlap with this month
        const weekStarts = [];
        
        // Find the first Monday of or before the month start
        let firstMonday = new Date(monthStart);
        const firstDayOfWeek = monthStart.getDay();
        const daysToMonday = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;
        firstMonday.setDate(monthStart.getDate() - daysToMonday);
        
        // Generate up to 6 Monday-Sunday weeks that might overlap with this month
        for (let i = 0; i < 6; i++) {
            const weekStart = new Date(firstMonday);
            weekStart.setDate(firstMonday.getDate() + (i * 7));
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            
            // Only include weeks that have at least one day in the selected month
            if (weekStart <= monthEnd && weekEnd >= monthStart) {
                weekStarts.push({ start: weekStart, end: weekEnd });
            }
        }
        
        const weekCounts = new Array(weekStarts.length).fill(0);
        let monthTotal = 0;
        
        this.jobs.forEach(job => {
            if (!job.applied_date) return;
            if (job.status === 'saved') return; // Exclude saved jobs from counts
            
            const parts = job.applied_date.split('-');
            const jobDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            
            // Check if job is in this month
            if (jobDate >= monthStart && jobDate <= monthEnd) {
                monthTotal++;
                
                // Find which week this job belongs to
                for (let i = 0; i < weekStarts.length; i++) {
                    if (jobDate >= weekStarts[i].start && jobDate <= weekStarts[i].end) {
                        weekCounts[i]++;
                        break;
                    }
                }
            }
        });
        
        // Update month display
        document.getElementById('month-total').textContent = monthTotal;
        
        // Hide extra week cards if less than 5 weeks
        for (let i = 1; i <= 5; i++) {
            const element = document.getElementById(`week-${i}`);
            if (element) {
                const weekItem = element.closest('.week-item');
                if (i <= weekStarts.length) {
                    // Show this week
                    if (weekItem) weekItem.style.display = 'flex';
                    element.textContent = weekCounts[i - 1];
                    
                    // Make week items clickable
                    if (weekItem) {
                        weekItem.style.cursor = weekCounts[i - 1] > 0 ? 'pointer' : 'default';
                        
                        // Remove old event listeners by cloning
                        const newWeekItem = weekItem.cloneNode(true);
                        weekItem.parentNode.replaceChild(newWeekItem, weekItem);
                        
                        // Highlight the week that contains today (only if viewing current month)
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        const weekData = weekStarts[i - 1];
                        const isCurrentMonth = !this.selectedMonth || 
                            (this.selectedMonth.year === today.getFullYear() && this.selectedMonth.month === today.getMonth());
                        
                        if (isCurrentMonth && today >= weekData.start && today <= weekData.end) {
                            newWeekItem.classList.add('selected');
                        }
                        
                        // Add click handler to show week breakdown
                        if (weekCounts[i - 1] > 0) {
                            const weekNumber = i;
                            newWeekItem.addEventListener('click', () => {
                                this.showWeekBreakdownByDates(weekData.start, weekData.end, weekNumber);
                            });
                        }
                    }
                } else {
                    // Hide this week card
                    if (weekItem) weekItem.style.display = 'none';
                }
            }
        }
    }
    
    updateInsights() {
        const appliedJobs = this.jobs.filter(j => j.status !== 'saved');
        
        console.log('📊 Calculating Insights:', {
            totalJobs: this.jobs.length,
            appliedJobs: appliedJobs.length
        });
        
        // Performance Metrics
        // Ghost Rate: % of applied jobs with no response (still in "applied" status)
        const ghostedJobs = appliedJobs.filter(j => j.status === 'applied');
        const ghostRate = appliedJobs.length > 0 ? ((ghostedJobs.length / appliedJobs.length) * 100).toFixed(1) : 0;
        document.getElementById('ghost-rate').textContent = `${ghostRate}%`;
        
        console.log('👻 Ghost Rate:', { ghosted: ghostedJobs.length, total: appliedJobs.length, rate: ghostRate + '%' });
        
        // Response Time: Average days between applied and next status
        let totalResponseDays = 0;
        let responseCount = 0;
        
        appliedJobs.forEach(job => {
            if (!job.status_history || job.status_history.length === 0) return;
            
            // Find applied entry in history (chronologically first after any saved entries)
            const appliedIndex = job.status_history.findIndex(h => h.status === 'applied');
            
            if (appliedIndex !== -1 && appliedIndex < job.status_history.length - 1) {
                // Find the next non-applied, non-saved status after applied
                for (let i = appliedIndex + 1; i < job.status_history.length; i++) {
                    const nextEntry = job.status_history[i];
                    if (nextEntry.status !== 'applied' && nextEntry.status !== 'saved') {
                        const appliedDate = new Date(job.status_history[appliedIndex].timestamp);
                        const responseDate = new Date(nextEntry.timestamp);
                        const days = Math.floor((responseDate - appliedDate) / (1000 * 60 * 60 * 24));
                        
                        if (days >= 0) {
                            totalResponseDays += days;
                            responseCount++;
                        }
                        break; // Only count first response
                    }
                }
            }
        });
        
        const avgResponseTime = responseCount > 0 ? (totalResponseDays / responseCount).toFixed(1) : 0;
        document.getElementById('response-time').textContent = `${avgResponseTime} days`;
        
        console.log('⏱️ Response Time:', { totalDays: totalResponseDays, count: responseCount, avg: avgResponseTime + ' days' });
        
        // Longest Waiting Application (only count jobs still waiting - in "applied" status)
        const now = new Date();
        let longestWait = 0;
        const waitingJobs = appliedJobs.filter(j => j.status === 'applied');
        
        waitingJobs.forEach(job => {
            if (job.applied_date) {
                const daysSinceApplied = Math.floor((now - new Date(job.applied_date)) / (1000 * 60 * 60 * 24));
                if (daysSinceApplied > longestWait) {
                    longestWait = daysSinceApplied;
                }
            }
        });
        document.getElementById('longest-waiting').textContent = `${longestWait} days`;
        
        console.log('⏳ Longest Waiting:', { days: longestWait, waitingJobs: waitingJobs.length });
        
        // Volume Metrics (exclude saved jobs)
        const activeJobs = this.jobs.filter(j => j.status !== 'saved');
        document.getElementById('total-apps-insight').textContent = activeJobs.length;
        
        // Most Active Day
        const dayCount = {};
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        
        this.jobs.forEach(job => {
            if (job.applied_date && job.status !== 'saved') { // Exclude saved jobs from counts
                const day = new Date(job.applied_date).getDay();
                dayCount[day] = (dayCount[day] || 0) + 1;
            }
        });
        
        let mostActiveDay = 0;
        let maxCount = 0;
        Object.entries(dayCount).forEach(([day, count]) => {
            if (count > maxCount) {
                maxCount = count;
                mostActiveDay = parseInt(day);
            }
        });
        
        const activeDay = maxCount > 0 ? dayNames[mostActiveDay] : '-';
        document.querySelector('#most-active-day .day-name').textContent = activeDay;
        document.querySelector('#most-active-day .day-count').textContent = `${maxCount} apps`;
        
        console.log('📅 Most Active Day:', { day: activeDay, count: maxCount, breakdown: dayCount });
        
        // Application Rate (exclude saved jobs)
        const sortedJobs = [...this.jobs].filter(j => j.applied_date && j.status !== 'saved').sort((a, b) => new Date(a.applied_date) - new Date(b.applied_date));
        
        if (sortedJobs.length > 1) {
            const firstDate = new Date(sortedJobs[0].applied_date);
            const lastDate = new Date(sortedJobs[sortedJobs.length - 1].applied_date);
            const daysDiff = Math.max(1, Math.floor((lastDate - firstDate) / (1000 * 60 * 60 * 24)) + 1); // +1 to include both days
            
            const daily = (sortedJobs.length / daysDiff).toFixed(1);
            const weekly = (sortedJobs.length / (daysDiff / 7)).toFixed(1);
            const monthly = (sortedJobs.length / (daysDiff / 30)).toFixed(1);
            const yearly = (sortedJobs.length / (daysDiff / 365)).toFixed(0);
            
            document.getElementById('rate-daily').textContent = daily;
            document.getElementById('rate-weekly').textContent = weekly;
            document.getElementById('rate-monthly').textContent = monthly;
            document.getElementById('rate-yearly').textContent = yearly;
            
            console.log('📊 Application Rate:', { 
                dateRange: `${sortedJobs[0].applied_date} to ${sortedJobs[sortedJobs.length - 1].applied_date}`,
                totalDays: daysDiff, 
                total: sortedJobs.length,
                rates: { daily, weekly, monthly, yearly }
            });
        } else {
            document.getElementById('rate-daily').textContent = '0';
            document.getElementById('rate-weekly').textContent = '0';
            document.getElementById('rate-monthly').textContent = '0';
            document.getElementById('rate-yearly').textContent = '0';
            
            console.log('📊 Application Rate: Not enough data (need at least 2 jobs with dates)');
        }
        
        // Conversion Funnel (exclude saved jobs)
        const screeningJobs = this.jobs.filter(j => j.status !== 'saved' && (j.status === 'resume_screening' || (j.status_history && j.status_history.some(h => h.status === 'resume_screening'))));
        const interviewJobs = this.jobs.filter(j => j.status !== 'saved' && (j.status === 'interview' || (j.status_history && j.status_history.some(h => h.status === 'interview'))));
        const offerJobs = this.jobs.filter(j => j.status !== 'saved' && j.status === 'offer');
        
        const convScreening = appliedJobs.length > 0 ? ((screeningJobs.length / appliedJobs.length) * 100).toFixed(0) : 0;
        const convInterview = screeningJobs.length > 0 ? ((interviewJobs.length / screeningJobs.length) * 100).toFixed(0) : 0;
        const convOffer = interviewJobs.length > 0 ? ((offerJobs.length / interviewJobs.length) * 100).toFixed(0) : 0;
        
        document.getElementById('conv-screening').textContent = `${convScreening}%`;
        document.getElementById('conv-interview').textContent = `${convInterview}%`;
        document.getElementById('conv-offer').textContent = `${convOffer}%`;
    }
    
    calculateStreak() {
        // This now returns just the current streak from comprehensive history
        const history = this.calculateStreakHistory();
        return history.currentStreak;
    }

    calculateStreakHistory() {
        console.log('📊 Calculating comprehensive streak history...');

        // Get all jobs with applied dates, excluding saved jobs
        const sortedJobs = [...this.jobs]
            .filter(job => job.applied_date && job.status !== 'saved')
            .sort((a, b) => new Date(a.applied_date) - new Date(b.applied_date)); // Oldest first

        if (sortedJobs.length === 0) {
            return {
                currentStreak: 0,
                highestStreak: 0,
                streakHistory: [],
                lastBreakDate: null,
                isActiveToday: false
            };
        }

        // Get all unique dates with applications
        const applicationDates = new Set();
        sortedJobs.forEach(job => {
            const date = new Date(job.applied_date);
            date.setHours(0, 0, 0, 0);
            applicationDates.add(date.getTime());
        });

        const sortedDates = Array.from(applicationDates)
            .map(timestamp => new Date(timestamp))
            .sort((a, b) => a - b);

        console.log(`📅 Found ${sortedDates.length} unique application dates`);

        // Find all streaks
        const streaks = [];
        let currentStreakStart = sortedDates[0];
        let currentStreakEnd = sortedDates[0];

        for (let i = 1; i < sortedDates.length; i++) {
            const prevDate = sortedDates[i - 1];
            const currDate = sortedDates[i];
            const daysDiff = Math.floor((currDate - prevDate) / (1000 * 60 * 60 * 24));

            if (daysDiff === 1) {
                // Consecutive day - extend current streak
                currentStreakEnd = currDate;
            } else {
                // Gap found - save current streak and start new one
                const streakLength = Math.floor((currentStreakEnd - currentStreakStart) / (1000 * 60 * 60 * 24)) + 1;
                streaks.push({
                    startDate: currentStreakStart.toISOString().split('T')[0],
                    endDate: currentStreakEnd.toISOString().split('T')[0],
                    length: streakLength,
                    breakDuration: daysDiff - 1 // Days between streaks
                });
                currentStreakStart = currDate;
                currentStreakEnd = currDate;
            }
        }

        // Add the last streak
        const lastStreakLength = Math.floor((currentStreakEnd - currentStreakStart) / (1000 * 60 * 60 * 24)) + 1;
        streaks.push({
            startDate: currentStreakStart.toISOString().split('T')[0],
            endDate: currentStreakEnd.toISOString().split('T')[0],
            length: lastStreakLength,
            breakDuration: null // Last streak has no break after it yet
        });

        // Determine current active streak
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const lastApplicationDate = sortedDates[sortedDates.length - 1];
        const daysSinceLastApplication = Math.floor((today - lastApplicationDate) / (1000 * 60 * 60 * 24));

        let currentStreak = 0;
        let isActiveToday = false;
        let lastBreakDate = null;

        if (daysSinceLastApplication === 0) {
            // Applied today - streak is active
            currentStreak = streaks[streaks.length - 1].length;
            isActiveToday = true;
        } else if (daysSinceLastApplication === 1) {
            // Applied yesterday - streak is still technically active (grace period)
            currentStreak = streaks[streaks.length - 1].length;
            isActiveToday = false;
        } else {
            // Streak is broken
            currentStreak = 0;
            lastBreakDate = new Date(lastApplicationDate.getTime() + (1000 * 60 * 60 * 24)).toISOString().split('T')[0];

            // Update the last streak's break duration if not already set
            if (streaks.length > 0 && streaks[streaks.length - 1].breakDuration === null) {
                streaks[streaks.length - 1].breakDuration = daysSinceLastApplication - 1;
            }
        }

        // Find highest streak
        const highestStreak = Math.max(...streaks.map(s => s.length));

        // Load previous streak data to check if we need to notify about a break
        const previousData = this.loadStreakData();
        const streakJustBroke = previousData && previousData.currentStreak > 0 && currentStreak === 0 &&
                                previousData.lastBreakDate !== lastBreakDate;

        const history = {
            currentStreak,
            highestStreak,
            streakHistory: streaks,
            lastBreakDate,
            isActiveToday,
            streakJustBroke, // Flag to show notification
            totalApplicationDays: sortedDates.length,
            lastUpdated: new Date().toISOString()
        };

        console.log('🔥 Streak Analysis:', {
            current: currentStreak,
            highest: highestStreak,
            totalStreaks: streaks.length,
            isActive: isActiveToday,
            lastBreak: lastBreakDate
        });

        // Save to localStorage
        this.saveStreakData(history);

        return history;
    }

    saveStreakData(data) {
        try {
            localStorage.setItem('streak_history', JSON.stringify(data));
            console.log('💾 Streak data saved to localStorage');
        } catch (error) {
            console.error('❌ Error saving streak data:', error);
        }
    }

    loadStreakData() {
        try {
            const data = localStorage.getItem('streak_history');
            if (data) {
                return JSON.parse(data);
            }
        } catch (error) {
            console.error('❌ Error loading streak data:', error);
        }
        return null;
    }

    showStreakBreakNotification(streakHistory) {
        console.log('💔 Showing streak break notification');

        // Find the last completed streak before the break
        const lastStreak = streakHistory.streakHistory[streakHistory.streakHistory.length - 2] ||
                          streakHistory.streakHistory[streakHistory.streakHistory.length - 1];

        if (!lastStreak) return;

        const message = `Your ${lastStreak.length}-day streak ended on ${lastStreak.endDate}. Your highest streak is ${streakHistory.highestStreak} days. Keep going!`;

        // Create a toast notification
        const toast = document.createElement('div');
        toast.className = 'streak-break-toast';
        toast.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px;">
                <i class="fas fa-fire-alt" style="font-size: 24px; color: #f59e0b;"></i>
                <div>
                    <div style="font-weight: 600; margin-bottom: 4px;">Streak Broken</div>
                    <div style="font-size: 0.9rem; opacity: 0.9;">${message}</div>
                </div>
                <button onclick="this.parentElement.parentElement.remove()" style="margin-left: auto; background: none; border: none; color: white; cursor: pointer; font-size: 20px; padding: 0 8px;">&times;</button>
            </div>
        `;

        document.body.appendChild(toast);

        // Auto-remove after 10 seconds
        setTimeout(() => {
            if (toast.parentElement) {
                toast.style.opacity = '0';
                setTimeout(() => toast.remove(), 300);
            }
        }, 10000);
    }

    // Filter Options
    populateFilterOptions() {
        console.log('🔄 Populating filter options from database...');
        console.log('Total jobs in this.jobs:', this.jobs.length);

        // Extract unique values from jobs in database, filter out empty values, and sort alphabetically
        const companyMap = new Map();
        this.jobs.forEach(job => {
            const normalizedCompany = this.normalizeCompanyName(job.company || '');
            if (!normalizedCompany) return;
            const key = normalizedCompany.toLowerCase();
            if (!companyMap.has(key)) {
                companyMap.set(key, normalizedCompany);
            }
        });
        const companies = [...companyMap.values()]
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

        const locations = [...new Set(this.jobs.map(job => job.location))]
            .filter(location => location && location.trim() !== '')
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

        const sources = [...new Set(this.jobs.map(job => job.source))]
            .filter(source => source && source.trim() !== '')
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

        console.log('📍 Unique locations found:', locations);
        console.log('🏢 Unique companies found:', companies.length);
        console.log('🌐 Unique sources found:', sources.length);

        // Log warning if no locations found
        if (locations.length === 0) {
            console.warn('⚠️ No locations found in database. All jobs may have empty location fields.');
        }

        // Update status filter (multi-select checkboxes)
        const statusFilter = document.querySelector('[data-filter="status"] + .filter-dropdown');
        if (statusFilter) {
            const selectedStatuses = this.currentFilters.status === 'all'
                ? []
                : Array.isArray(this.currentFilters.status)
                    ? this.currentFilters.status
                    : (this.currentFilters.status ? [this.currentFilters.status] : []);

            const statusOptionsHtml = this.statusOptions.map(statusValue => {
                const formatted = this.sanitize(this.formatStatus(statusValue));
                const isChecked = selectedStatuses.includes(statusValue);
                return `
                    <label class="filter-checkbox">
                        <input type="checkbox" value="${statusValue}" ${isChecked ? 'checked' : ''}>
                        <span>${formatted}</span>
                    </label>
                `;
            }).join('');

            statusFilter.innerHTML = `
                <div class="filter-option" data-value="all">All Status</div>
                <div class="filter-options-scroll">
                    ${statusOptionsHtml}
                </div>
            `;
            statusFilter.classList.remove('show');
        }
        this.updateStatusFilterLabel();

        // Update company filter
        const companyFilter = document.querySelector('[data-filter="company"] + .filter-dropdown');
        if (companyFilter) {
            const selectedCompanies = this.currentFilters.company === 'all'
                ? []
                : Array.isArray(this.currentFilters.company)
                    ? this.currentFilters.company
                    : (this.currentFilters.company ? [this.currentFilters.company] : []);
            const normalizedSelections = selectedCompanies
                .filter(Boolean)
                .map(name => this.normalizeCompanyName(name));

            const companyOptions = companies.length
                ? companies.map(company => {
                    const safeCompany = this.sanitize(company);
                    const isChecked = normalizedSelections.some(
                        selected => selected.toLowerCase() === company.toLowerCase()
                    );
                    return `
                        <label class="filter-checkbox">
                            <input type="checkbox" value="${safeCompany}" ${isChecked ? 'checked' : ''}>
                            <span>${safeCompany}</span>
                        </label>
                    `;
                }).join('')
                : '<div class="filter-empty">No companies yet</div>';

            companyFilter.innerHTML = `
                <div class="filter-search">
                    <input type="text" class="filter-search-input" placeholder="Search companies..." data-filter="company" />
                </div>
                <div class="filter-option" data-value="all">All Companies</div>
                <div class="filter-options-scroll">
                    ${companyOptions}
                </div>
                <div class="filter-actions">
                    <button type="button" class="filter-action-btn apply" data-filter="company">Apply</button>
                    <button type="button" class="filter-action-btn clear" data-filter="company">Clear</button>
                </div>
            `;
            companyFilter.classList.remove('show');
        }
        this.updateCompanyFilterLabel();

        // Update location filter - only shows locations that exist in the database
        const locationFilter = document.querySelector('[data-filter="location"] + .filter-dropdown');
        if (locationFilter) {
            locationFilter.innerHTML = `
                <div class="filter-option" data-value="all">All Locations</div>
                ${locations.map(location =>
                    `<div class="filter-option" data-value="${this.sanitize(location)}">${this.sanitize(location)}</div>`
                ).join('')}
            `;
            locationFilter.classList.remove('show');
        }

        // Update source filter
        const sourceFilter = document.querySelector('[data-filter="source"] + .filter-dropdown');
        if (sourceFilter) {
            sourceFilter.innerHTML = `
                <div class="filter-option" data-value="all">All Sources</div>
                ${sources.map(source =>
                    `<div class="filter-option" data-value="${this.sanitize(source)}">${this.sanitize(source)}</div>`
                ).join('')}
            `;
            sourceFilter.classList.remove('show');
        }

        console.log(`📍 Filter options populated: ${companies.length} companies, ${locations.length} locations, ${sources.length} sources`);
    }
}

// Global functions
let jobTracker;

function showTracker() {
    document.querySelectorAll('.nav-tab').forEach(tab => tab.classList.remove('active'));
    document.getElementById('tracker-tab').classList.add('active');
}

function openStreakSettings() {
    alert('Streak settings coming soon!');
}

function importCSV() {
    document.getElementById('import-modal').style.display = 'flex';
    
    // Setup file upload handlers
    const fileInput = document.getElementById('csv-file');
    const uploadArea = document.getElementById('file-upload-area');
    const importBtn = document.getElementById('import-btn');
    
    // Click to upload
    uploadArea.onclick = () => fileInput.click();
    
    // File selected
    fileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (file) {
            uploadArea.querySelector('p').textContent = `Selected: ${file.name}`;
            importBtn.disabled = false;
        }
    };
    
    // Import button
    importBtn.onclick = async () => {
        const file = fileInput.files[0];
        if (!file) {
            alert('Please select a CSV file');
            return;
        }
        
        try {
            const text = await file.text();
            const parseResult = parseCSV(text);
            const jobs = parseResult.jobs;
            const skippedRows = parseResult.skipped;
            
            console.log(`📊 CSV Parse Results:`);
            console.log(`- Total rows in CSV: ${text.split('\n').length - 1}`);
            console.log(`- Valid jobs found: ${jobs.length}`);
            console.log(`- Skipped rows: ${skippedRows.length}`);
            
            if (jobs.length === 0) {
                let message = 'No valid jobs found in CSV.\n\n';
                if (skippedRows.length > 0) {
                    message += `${skippedRows.length} rows were skipped (completely empty):\n`;
                    skippedRows.forEach(row => {
                        message += `Row ${row}\n`;
                    });
                }
                alert(message);
                return;
            }
            
            // Import to Supabase
            importBtn.textContent = 'Importing...';
            importBtn.disabled = true;
            
            let successCount = 0;
            let errorCount = 0;
            const successfulJobs = [];
            const failedJobs = [];
            
            for (let i = 0; i < jobs.length; i++) {
                const job = jobs[i];
                const rowNumber = job._originalRow || (i + 2); // Use tracked row number or fallback
                
                try {
                    const { error } = await jobTracker.supabase
                        .from('jobs')
                        .insert({
                            title: job.title || '',
                            company: job.company || '',
                            location: job.location || '',
                            url: job.url || '',
                            status: job.status || 'saved',
                            applied_date: job.applied_date || this.getTodayDate(),
                            description: job.description || '',
                            notes: job.notes || '',
                            job_id: '',
                            source: job.source || ''
                        });
                    
                    if (error) {
                        console.error('Error importing job:', error);
                        errorCount++;
                        failedJobs.push({
                            row: rowNumber,
                            title: job.title || 'N/A',
                            company: job.company || 'N/A',
                            reason: error.message || 'Database error'
                        });
                    } else {
                        successCount++;
                        successfulJobs.push({
                            row: rowNumber,
                            title: job.title || 'N/A',
                            company: job.company || 'N/A'
                        });
                    }
                } catch (err) {
                    console.error('Exception importing job:', err);
                    errorCount++;
                    failedJobs.push({
                        row: rowNumber,
                        title: job.title || 'N/A',
                        company: job.company || 'N/A',
                        reason: err.message || 'Unknown error'
                    });
                }
            }
            
            // Refresh the dashboard
            await jobTracker.loadJobs();
            jobTracker.applyFilters();
            jobTracker.renderJobs();
            jobTracker.updateStats();
            jobTracker.populateFilterOptions();
            
            // Close modal and show detailed result
            document.getElementById('import-modal').style.display = 'none';
            
            // Reset UI safely
            try {
                if (fileInput) fileInput.value = '';
                const uploadText = uploadArea?.querySelector('p');
                if (uploadText) uploadText.textContent = 'Click to upload CSV file';
                if (importBtn) {
                    importBtn.textContent = 'Import Jobs';
                    importBtn.disabled = true;
                }
            } catch (resetError) {
                console.error('Error resetting UI:', resetError);
            }
            
            // Show results last (after UI is reset)
            showImportResults(successfulJobs, failedJobs, skippedRows);
            
        } catch (error) {
            console.error('Error during import:', error);
            console.error('Error stack:', error.stack);
            
            // Show error with more context
            alert(`Error during CSV import:\n\n${error.message}\n\nCheck console for details.`);
            
            // Try to reset button
            try {
                if (importBtn) {
                    importBtn.textContent = 'Import Jobs';
                    importBtn.disabled = false;
                }
            } catch (resetError) {
                console.error('Error resetting button:', resetError);
            }
        }
    };
}

function showImportResults(successfulJobs, failedJobs, skippedRows = []) {
    const totalProcessed = successfulJobs.length + failedJobs.length;
    let message = `📊 IMPORT RESULTS\n`;
    message += `═══════════════════════════════\n\n`;
    message += `Total Rows in CSV: ${totalProcessed + skippedRows.length}\n`;
    message += `✅ Successfully Imported: ${successfulJobs.length}\n`;
    message += `❌ Failed: ${failedJobs.length}\n`;
    message += `⏭️  Skipped (empty): ${skippedRows.length}\n\n`;
    
    if (successfulJobs.length > 0) {
        message += `✅ SUCCESSFUL IMPORTS:\n`;
        message += `───────────────────────────────\n`;
        // Show first 10, then summary
        const showCount = Math.min(10, successfulJobs.length);
        successfulJobs.slice(0, showCount).forEach(job => {
            const title = job.title.length > 40 ? job.title.substring(0, 37) + '...' : job.title;
            const company = job.company || '(no company)';
            message += `Row ${job.row}: ${title} @ ${company}\n`;
        });
        if (successfulJobs.length > 10) {
            message += `... and ${successfulJobs.length - 10} more\n`;
        }
        message += `\n`;
    }
    
    if (failedJobs.length > 0) {
        message += `❌ FAILED IMPORTS:\n`;
        message += `───────────────────────────────\n`;
        failedJobs.forEach(job => {
            message += `Row ${job.row}: ${job.title} @ ${job.company}\n`;
            message += `   ⚠️ Reason: ${job.reason}\n\n`;
        });
    }
    
    if (skippedRows.length > 0 && skippedRows.length <= 20) {
        message += `⏭️  SKIPPED ROWS (empty):\n`;
        message += `───────────────────────────────\n`;
        message += `Rows: ${skippedRows.join(', ')}\n\n`;
    } else if (skippedRows.length > 20) {
        message += `⏭️  SKIPPED ROWS: ${skippedRows.length} empty rows\n\n`;
    }
    
    if (failedJobs.length === 0 && successfulJobs.length > 0) {
        message += `🎉 All valid jobs imported successfully!`;
    }
    
    // Show in console for easy copying
    console.log('\n' + message);
    console.log('\n📋 Full successful imports list:');
    successfulJobs.forEach(job => {
        console.log(`  Row ${job.row}: ${job.title} @ ${job.company}`);
    });
    
    // Show in alert
    alert(message);
}

function parseCSV(text) {
    const allLines = text.trim().split('\n');
    const lines = allLines.filter(line => line.trim());
    
    if (lines.length < 2) return { jobs: [], skipped: [] };
    
    // Get headers (normalize to lowercase and trim)
    const headerLine = lines[0];
    const headers = parseCSVLine(headerLine).map(h => h.trim().toLowerCase());
    const jobs = [];
    const skippedRows = [];
    
    // Map common header variations
    const headerMap = {
        'position title': 'title',
        'job title': 'title',
        'title': 'title',
        'position': 'title',
        'role': 'title',
        'company': 'company',
        'location': 'location',
        'url': 'url',
        'link': 'url',
        'job url': 'url',
        'status': 'status',
        'source': 'source',
        'applied date': 'applied_date',
        'date applied': 'applied_date',
        'date': 'applied_date',
        'description': 'description',
        'notes': 'notes',
        'note': 'notes'
    };
    
    // Parse each row
    let lineIndex = 0;
    for (let i = 0; i < allLines.length; i++) {
        if (i === 0) continue; // Skip header
        
        const line = allLines[i].trim();
        const rowNumber = i + 1; // Row number in original CSV
        
        if (!line) {
            skippedRows.push(rowNumber);
            continue;
        }
        
        const values = parseCSVLine(line);
        const job = {};
        
        headers.forEach((header, index) => {
            const mappedKey = headerMap[header];
            if (mappedKey && values[index] && values[index].trim()) {
                job[mappedKey] = values[index].trim();
            }
        });
        
        // Skip completely empty rows
        if (!job.title && !job.company && !job.location && !job.url) {
            skippedRows.push(rowNumber);
            continue;
        }
        
        // If we have at least a title (even if it's just "sde" or "frontend")
        // OR a company, consider it valid
        if (job.title || job.company) {
            // Normalize status
            if (job.status) {
                job.status = job.status.toLowerCase();
                if (!['saved', 'applied', 'interview', 'offer', 'rejected', 'withdrawn', 'ended'].includes(job.status)) {
                    job.status = 'saved';
                }
            } else {
                job.status = 'saved'; // Default status
            }
            
            // Ensure we have at least some identifier
            if (!job.company) {
                job.company = ''; // Empty company is okay if we have a title
            }
            if (!job.title) {
                job.title = ''; // Empty title is okay if we have a company
            }
            
            job._originalRow = rowNumber; // Track original row number
            jobs.push(job);
        } else {
            skippedRows.push(rowNumber);
        }
    }
    
    return { jobs, skipped: skippedRows };
}

// Helper function to properly parse CSV lines (handles quoted values with commas)
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    
    result.push(current); // Push the last value
    return result.map(v => v.trim().replace(/^"|"$/g, ''));
}

function exportAll() {
    if (jobTracker && jobTracker.jobs.length > 0) {
        const csv = convertToCSV(jobTracker.jobs);
        downloadCSV(csv, 'job-applications.csv');
    } else {
        alert('No jobs to export');
    }
}

function toggleInsights() {
    const insightsSection = document.getElementById('insights-section');
    const insightsBtn = document.getElementById('insights-toggle-btn');
    
    const svgInsights = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" style="width:14px;height:14px"><path d="M2 13V3M2 13h12M5 10V7M8 10V5M11 10V8"/></svg>';
    if (insightsSection.style.display === 'none') {
        insightsSection.style.display = 'block';
        insightsBtn.innerHTML = svgInsights + ' Hide Insights';
        console.log('✅ Insights shown');
    } else {
        insightsSection.style.display = 'none';
        insightsBtn.innerHTML = svgInsights + ' Insights';
        console.log('✅ Insights hidden');
    }
}

async function refreshData() {
    console.log('🔄 Refresh Data button clicked!');
    console.log('jobTracker exists?', !!jobTracker);
    
    const refreshBtn = document.getElementById('refresh-btn');
    const icon = refreshBtn?.querySelector('i');
    
    if (jobTracker) {
        console.log('Calling jobTracker.loadJobs()...');
        
        // Add spinning animation
        if (icon) {
            icon.classList.add('fa-spin');
        }
        
        try {
            // Fetch fresh data from Supabase
            await jobTracker.loadJobs();
            console.log('✅ Data loaded from Supabase');
            
            // Apply filters (resets filteredJobs based on current filters)
            jobTracker.applyFilters();
            console.log('✅ Filters applied');
            
            // Re-render the table with fresh data
            jobTracker.renderJobs();
            console.log('✅ Jobs rendered');
            
            // Update stats (counts, etc.)
            jobTracker.updateStats();
            console.log('✅ Stats updated');
            
            // Update filter dropdowns with new data
            jobTracker.populateFilterOptions();
            console.log('✅ Filter options populated');
            
            console.log('🎉 Data refreshed successfully!');
            
            // Show success feedback
            if (refreshBtn) {
                const originalText = refreshBtn.innerHTML;
                refreshBtn.innerHTML = '<i class="fas fa-check"></i>';
                setTimeout(() => {
                    refreshBtn.innerHTML = originalText;
                }, 2000);
            }
        } catch (error) {
            console.error('❌ Error refreshing data:', error);
            alert('Failed to refresh data. Please try again.');
        } finally {
            if (icon) {
                icon.classList.remove('fa-spin');
            }
        }
    } else {
        console.error('❌ jobTracker not initialized!');
        alert('Job tracker not initialized. Please reload the page.');
    }
}

function debugDashboard() {
    console.log('=== SUPABASE DASHBOARD DEBUG ===');
    console.log('Supabase client:', jobTracker ? jobTracker.supabase : 'No jobTracker');
    console.log('Current jobs:', jobTracker ? jobTracker.jobs : 'No jobTracker');
    console.log('Filtered jobs:', jobTracker ? jobTracker.filteredJobs : 'No jobTracker');

    if (jobTracker && jobTracker.jobs.length > 0) {
        console.log('Job details:');
        jobTracker.jobs.forEach((job, index) => {
            console.log(`Job ${index + 1}:`, {
                id: job.id,
                title: job.title,
                company: job.company,
                status: job.status,
                created_at: job.created_at
            });
        });
    }

    alert('Debug info logged to console. Press F12 to see the details.');
}

// Global function to normalize all existing entries
async function normalizeAllExistingEntries() {
    if (!jobTracker) {
        alert('JobTracker not initialized. Please refresh the page and try again.');
        return;
    }

    const confirmed = confirm(
        'This will normalize all company names and locations in your database:\n\n' +
        '• Remove state abbreviations from locations (e.g., "Seattle, WA" → "Seattle")\n' +
        '• Capitalize first letter of each word in company names and locations\n\n' +
        'Do you want to proceed?'
    );

    if (confirmed) {
        await jobTracker.normalizeAllEntries();
    }
}

// Diagnostic function to verify what's actually in the database
async function verifyDatabaseData(jobId) {
    if (!jobTracker) {
        console.error('JobTracker not initialized');
        return;
    }

    console.log('=== DATABASE VERIFICATION ===');

    if (jobId) {
        // Check specific job
        const normalizedId = jobTracker.normalizeId(jobId);
        console.log('Checking job ID:', normalizedId);

        const { data, error } = await jobTracker.supabase
            .from('jobs')
            .select('*')
            .eq('id', normalizedId)
            .single();

        if (error) {
            console.error('Error fetching job:', error);
            return;
        }

        console.log('Job data from database:', data);
        console.log('Location:', data.location);
        console.log('Company:', data.company);
        console.log('Status:', data.status);
    } else {
        // Check all jobs
        const { data, error } = await jobTracker.supabase
            .from('jobs')
            .select('id, company, location')
            .order('created_at', { ascending: false })
            .limit(10);

        if (error) {
            console.error('Error fetching jobs:', error);
            return;
        }

        console.log('Last 10 jobs from database:');
        data.forEach((job, idx) => {
            console.log(`${idx + 1}. ID: ${job.id} | Company: "${job.company}" | Location: "${job.location}"`);
        });
    }

    console.log('=== END VERIFICATION ===');
}

// Compare local vs database data
async function compareLocalVsDatabase() {
    if (!jobTracker) {
        console.error('JobTracker not initialized');
        return;
    }

    console.log('=== COMPARING LOCAL VS DATABASE ===');

    // Get data from Supabase
    const { data: dbJobs, error } = await jobTracker.supabase
        .from('jobs')
        .select('id, company, location, status, title')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching from database:', error);
        return;
    }

    console.log('📊 Total jobs in Supabase:', dbJobs.length);
    console.log('📊 Total jobs in local (this.jobs):', jobTracker.jobs.length);

    // Check localStorage backup
    const localStorageData = localStorage.getItem('jobTrackerJobs');
    const localJobs = localStorageData ? JSON.parse(localStorageData) : [];
    console.log('📊 Total jobs in localStorage backup:', localJobs.length);

    // Find discrepancies
    const dbIds = new Set(dbJobs.map(j => j.id));
    const localIds = new Set(jobTracker.jobs.map(j => j.id));

    const onlyInDb = dbJobs.filter(j => !localIds.has(j.id));
    const onlyInLocal = jobTracker.jobs.filter(j => !dbIds.has(j.id));

    if (onlyInDb.length > 0) {
        console.warn('⚠️ Jobs in database but NOT in local:', onlyInDb.length);
        onlyInDb.forEach(job => console.log('  -', job.id, job.title, job.company, job.location));
    }

    if (onlyInLocal.length > 0) {
        console.warn('🚨 CRITICAL: Jobs in local but NOT in database:', onlyInLocal.length);
        console.warn('These jobs will be LOST if you close the page without syncing!');
        onlyInLocal.forEach(job => console.log('  -', job.id, job.title, job.company, job.location));
        console.log('\n💡 Run syncMissingToSupabase() to push these jobs to Supabase');
    }

    if (onlyInDb.length === 0 && onlyInLocal.length === 0) {
        console.log('✅ All job IDs match between local and database');
    }

    // Check for data differences in matching jobs
    let differences = 0;
    dbJobs.forEach(dbJob => {
        const localJob = jobTracker.jobs.find(j => j.id === dbJob.id);
        if (localJob) {
            if (dbJob.location !== localJob.location || dbJob.company !== localJob.company) {
                console.warn(`⚠️ Data mismatch for job ${dbJob.id}:`);
                console.log(`   DB:    Company="${dbJob.company}" Location="${dbJob.location}"`);
                console.log(`   Local: Company="${localJob.company}" Location="${localJob.location}"`);
                differences++;
            }
        }
    });

    if (differences === 0) {
        console.log('✅ All matching jobs have identical data');
    } else {
        console.warn(`⚠️ Found ${differences} jobs with different data between local and database`);
        console.log('💡 Tip: Run jobTracker.loadJobs() to refresh from database');
    }

    console.log('=== END COMPARISON ===');

    return {
        dbCount: dbJobs.length,
        localCount: jobTracker.jobs.length,
        onlyInDb: onlyInDb.length,
        onlyInLocal: onlyInLocal.length,
        missingJobs: onlyInLocal,
        dataDifferences: differences
    };
}

// Sync missing entries to Supabase
async function syncMissingToSupabase() {
    if (!jobTracker) {
        console.error('JobTracker not initialized');
        return;
    }

    console.log('=== SYNCING MISSING ENTRIES TO SUPABASE ===');

    // First, compare to find missing jobs
    const comparison = await compareLocalVsDatabase();

    if (!comparison || comparison.onlyInLocal === 0) {
        console.log('✅ No missing jobs to sync. All data is in Supabase!');
        return;
    }

    const missingJobs = comparison.missingJobs;
    console.log(`\n🔄 Found ${missingJobs.length} jobs to sync to Supabase`);

    const confirmed = confirm(
        `Found ${missingJobs.length} jobs in local memory but NOT in Supabase.\n\n` +
        `Do you want to push these jobs to Supabase now?\n\n` +
        `Jobs to sync:\n${missingJobs.map(j => `- ${j.title} at ${j.company}`).slice(0, 5).join('\n')}` +
        (missingJobs.length > 5 ? `\n...and ${missingJobs.length - 5} more` : '')
    );

    if (!confirmed) {
        console.log('❌ Sync cancelled by user');
        return;
    }

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const job of missingJobs) {
        try {
            console.log(`📤 Syncing: ${job.title} at ${job.company}...`);

            // Prepare job data (remove any local-only fields)
            const jobData = {
                title: job.title || '',
                company: job.company || '',
                location: job.location || '',
                job_id: job.job_id || '',
                status: job.status || 'saved',
                applied_date: job.applied_date || new Date().toISOString().split('T')[0],
                url: job.url || '',
                description: job.description || '',
                notes: job.notes || '',
                comments: job.comments || '',
                source: job.source || 'Manual Entry',
                status_history: job.status_history || [],
                created_at: job.created_at || new Date().toISOString()
            };

            // Don't include the ID - let Supabase generate a new one
            const { data, error } = await jobTracker.supabase
                .from('jobs')
                .insert([jobData])
                .select()
                .single();

            if (error) {
                console.error(`❌ Failed to sync job:`, error);
                errors.push({ job, error });
                errorCount++;
            } else {
                console.log(`✅ Synced successfully with new ID: ${data.id}`);
                successCount++;
            }

        } catch (err) {
            console.error(`❌ Exception syncing job:`, err);
            errors.push({ job, error: err });
            errorCount++;
        }
    }

    console.log('\n=== SYNC COMPLETE ===');
    console.log(`✅ Successfully synced: ${successCount} jobs`);
    console.log(`❌ Failed to sync: ${errorCount} jobs`);

    if (errors.length > 0) {
        console.error('Errors:', errors);
    }

    // Reload from Supabase to get the latest data
    console.log('\n🔄 Reloading data from Supabase...');
    await jobTracker.loadJobs();
    jobTracker.renderJobs();
    jobTracker.updateStats();
    jobTracker.populateFilterOptions();

    alert(
        `Sync complete!\n\n` +
        `✅ Synced: ${successCount} jobs\n` +
        `❌ Failed: ${errorCount} jobs\n\n` +
        `Page has been refreshed with latest Supabase data.`
    );
}

function openAddJobModal() {
    if (jobTracker) {
        jobTracker.openAddJobModal();
    }
}

function closeModal() {
    document.getElementById('add-job-modal').style.display = 'none';
    document.getElementById('import-modal').style.display = 'none';
}

function closeCommentModal() {
    document.getElementById('comment-modal').style.display = 'none';
}

async function saveJob() {
    console.log('=== SAVE JOB FUNCTION CALLED ===');
    console.log('Timestamp:', new Date().toISOString());

    if (!jobTracker) {
        console.error('No jobTracker instance!');
        return;
    }

    const formData = {
        title: document.getElementById('job-title').value,
        company: document.getElementById('job-company').value,
        location: document.getElementById('job-location').value,
        url: document.getElementById('job-url').value,
        description: document.getElementById('job-description').value,
        notes: document.getElementById('job-notes')?.value || '',
        jobId: document.getElementById('job-external-id')?.value || '',
        status: document.getElementById('job-status').value
    };

    console.log('Raw form data collected:', formData);
    console.log('Is this an edit?', !!jobTracker.editingJobId);
    if (jobTracker.editingJobId) {
        console.log('Editing job ID:', jobTracker.editingJobId);
    }
    
    if (jobTracker.editingJobId) {
        // UPDATE EXISTING JOB
        console.log('Updating existing job with ID:', jobTracker.editingJobId);

        // Convert temp history to proper format (remove isOriginal, reverse for chronological order)
            const statusHistory = jobTracker.tempStatusHistory
                .filter(entry => !entry.isOriginal) // Remove original entry
                .reverse() // Convert from newest-first to oldest-first
                .map(entry => ({
                status: entry.status,
                timestamp: entry.timestamp,
                date: entry.date
            }));

        // Add status_history to the update and normalize company/location
        const updateData = {
            ...formData,
            company: jobTracker.normalizeCompanyName(formData.company),
            location: jobTracker.normalizeLocation(formData.location),
            job_id: formData.jobId,
            status_history: statusHistory
        };
        delete updateData.jobId;

        console.log('=== UPDATE DEBUG ===');
        console.log('Original form location:', formData.location);
        console.log('Normalized location:', updateData.location);
        console.log('Original form company:', formData.company);
        console.log('Normalized company:', updateData.company);
        console.log('Complete update data:', updateData);

        try {
            const editingId = jobTracker.normalizeId(jobTracker.editingJobId);
            console.log('Updating job with ID:', editingId);

            const { data, error } = await jobTracker.supabase
                .from('jobs')
                .update(updateData)
                .eq('id', editingId)
                .select()
                .single();

            if (error) {
                console.error('❌ Supabase update error:', error);
                alert('Could not update job: ' + error.message);
                return;
            }

            console.log('✅ Job updated in Supabase successfully!');
            console.log('Returned data from Supabase:', data);
            console.log('Location in returned data:', data.location);
            console.log('Company in returned data:', data.company);
            
            // Update local data
            const jobIndex = jobTracker.jobs.findIndex(j => jobTracker.idsMatch(j.id, editingId));
            if (jobIndex !== -1) {
                jobTracker.jobs[jobIndex] = data;
            }

            jobTracker.applyFilters();
            jobTracker.renderJobs();
            jobTracker.populateFilterOptions(); // Refresh filter dropdowns
            alert('✅ Job updated successfully!');
        } catch (err) {
            console.error('Exception updating job:', err);
            alert('Error: ' + err.message);
            return;
        }
    } else {
        // ADD NEW JOB
        console.log('Adding new job...');
        
        try {
            const jobData = {
                title: formData.title || '',
                company: jobTracker.normalizeCompanyName(formData.company || ''),
                location: formData.location || '',
                job_id: formData.jobId || '',
                favorite: false,
                status: formData.status || 'saved',
                applied_date: jobTracker.getTodayDate(),
                url: formData.url || '',
                description: formData.description || '',
                notes: formData.notes || '',
                comments: '',
                source: 'Manual Entry'
            };
            
            console.log('Inserting into Supabase:', jobData);
            
            const { data, error } = await jobTracker.supabase
                .from('jobs')
                .insert([jobData])
                .select()
                .single();
            
            if (error) {
                console.error('Insert error:', error);
                alert('Could not add job: ' + error.message);
                return;
            }
            
            console.log('✅ Job added to Supabase:', data);

            // Add to local jobs array
            const normalizedJob = {
                ...data,
                company: jobTracker.normalizeCompanyName(data?.company || '')
            };
            jobTracker.jobs.unshift(normalizedJob);
            jobTracker.applyFilters();
            jobTracker.renderJobs();
            jobTracker.populateFilterOptions(); // Refresh filter dropdowns

            alert('✅ Job added successfully!');
        } catch (err) {
            console.error('Exception adding job:', err);
            alert('Error: ' + err.message);
            return;
        }
    }
    
    closeModal();
    console.log('=== SAVE JOB COMPLETED ===');
}

function saveComment() {
    if (!jobTracker || !jobTracker.currentCommentJobId) return;
    
    const comment = document.getElementById('comment-text').value;
    const targetId = jobTracker.normalizeId(jobTracker.currentCommentJobId);
    const job = jobTracker.jobs.find(j => jobTracker.idsMatch(j.id, targetId));
    jobTracker.currentCommentJobId = targetId;
    
    if (job) {
        job.comments = comment;
        jobTracker.saveJobs();
        jobTracker.renderJobs();
    }
    
    closeCommentModal();
}

// Utility functions
function convertToCSV(jobs) {
    const headers = ['Title', 'Company', 'Location', 'Applied Date', 'Status', 'URL', 'Description', 'Notes'];
    const csvContent = [
        headers.join(','),
        ...jobs.map(job => [
            `"${job.title}"`,
            `"${job.company}"`,
            `"${job.location}"`,
            `"${job.applied_date}"`,
            `"${job.status}"`,
            `"${job.url}"`,
            `"${job.description}"`,
            `"${job.notes || ''}"`
        ].join(','))
    ].join('\n');
    
    return csvContent;
}

function downloadCSV(csv, filename) {
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
}

// Dark Mode Toggle
function initDarkMode() {
    const themeToggle = document.getElementById('theme-toggle');
    const body = document.body;
    
    // Check for saved theme preference or default to light mode
    const savedTheme = localStorage.getItem('theme') || 'light';
    
    if (savedTheme === 'dark') {
        body.classList.add('dark-mode');
        updateThemeIcon(true);
    }
    
    // Toggle theme on button click
    themeToggle?.addEventListener('click', () => {
        body.classList.toggle('dark-mode');
        const isDark = body.classList.contains('dark-mode');
        
        // Save preference
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
        
        // Update icon
        updateThemeIcon(isDark);
    });
}

function updateThemeIcon(isDark) {
    const themeToggle = document.getElementById('theme-toggle');
    if (!themeToggle) return;
    
    const icon = themeToggle.querySelector('i');
    if (icon) {
        icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
    }
}

// Role tag helper — shared by dashboard and popup
const COMPANY_LOGOS = {
    'amazon':    'images/amazon.png',
    'microsoft': 'images/microsoft.png',
    'tiktok':    'images/tiktok.png',
};

function getCompanyLogoHTML(company, fallbackLetter) {
    const key = (company || '').toLowerCase().trim();
    const src = COMPANY_LOGOS[key];
    if (src) {
        return `<img src="${src}" alt="${fallbackLetter}" style="width:100%;height:100%;object-fit:contain;border-radius:6px;">`;
    }
    return fallbackLetter;
}

function getJobTag(title) {
    const t = (title || '').toLowerCase();
    if (/product|program|operations|project|manager/.test(t)) return 'pm';
    if (/data|business intel|analyst/.test(t)) return 'data';
    return 'sde';
}

// Reusable countdown renderer for event cards
function renderCountdown(targetDateIso, numberId, subId, labelWhenActive = 'days to go') {
    try {
        const numberEl = document.getElementById(numberId);
        const subEl = document.getElementById(subId);
        const target = new Date(targetDateIso);
        if (!numberEl || !subEl || isNaN(target)) return;

        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const end = new Date(target.getFullYear(), target.getMonth(), target.getDate());
        const msPerDay = 24 * 60 * 60 * 1000;
        const diffDays = Math.ceil((end - start) / msPerDay);
        const daysRemaining = Math.max(0, diffDays); // Clamp to 0 to avoid "event passed"

        numberEl.textContent = `${daysRemaining}`;
        subEl.textContent = labelWhenActive;
    } catch (e) {
        console.warn('Countdown render failed:', e);
    }
}

    // Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM loaded, initializing Supabase JobTracker...');
    try {
        // Initialize dark mode first
        initDarkMode();

        jobTracker = new SupabaseJobTracker();
        console.log('Supabase JobTracker initialized successfully');

        // Initialize Pomodoro Timer with the Supabase client
        window.pomodoroTimer = new PomodoroTimer(jobTracker.supabase);
        console.log('Pomodoro Timer created with Supabase client');

        // Add event listeners to fix CSP issues
        setupEventListeners();

        // Rebuild insight charts on theme toggle for better contrast
        document.getElementById('theme-toggle')?.addEventListener('click', () => {
            try {
                if (jobTracker) {
                    jobTracker.renderJobTypePieChart?.();
                    jobTracker.renderLocationsPieChart?.();
                    jobTracker.renderCompaniesPieChart?.();
                    jobTracker.renderSourcesPieChart?.();
                }
                if (window.pomodoroTimer) {
                    // re-render pomodoro category pie for current day
                    window.pomodoroTimer.loadTodaySessions?.();
                }
            } catch (e) {
                console.warn('Theme toggle re-render failed:', e);
            }
        });
        // Countdown banner: Sep 14, 2026
        renderCountdown('2026-09-14T00:00:00', 'countdown-text-march', 'countdown-subtext-march', 'days till Sep 14, 2026');

        // Show/hide countdown card with localStorage persistence (default: hidden)
        const countdownCard = document.getElementById('countdown-card-march');
        const showBtn = document.getElementById('countdown-show-btn');
        const hideBtn = document.getElementById('countdown-hide-btn');
        const isVisible = localStorage.getItem('countdownVisible') === 'true';

        function setCountdownVisible(visible) {
            countdownCard.style.display = visible ? '' : 'none';
            showBtn.style.display = visible ? 'none' : 'inline-flex';
            localStorage.setItem('countdownVisible', visible);
        }

        setCountdownVisible(isVisible);
        hideBtn && hideBtn.addEventListener('click', () => setCountdownVisible(false));
        showBtn && showBtn.addEventListener('click', () => setCountdownVisible(true));
    } catch (error) {
        console.error('Error initializing Supabase JobTracker:', error);
    }
});

// Simple Tasks (in-memory, no persistence)
function initTasksUI() {
    const list = document.getElementById('tasks-list');
    const input = document.getElementById('new-task-input');
    const addBtn = document.getElementById('add-task-btn');
    const clearCompletedBtn = document.getElementById('clear-completed-btn');
    const clearAllBtn = document.getElementById('clear-all-btn');
    const clearStorageBtn = document.getElementById('clear-storage-btn');
    if (!list || !input || !addBtn) return;

    const STORAGE_KEY = 'dashboard_tasks_v1';

    const readTasks = () => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch { return []; }
    };

    const writeTasks = (tasks) => {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks)); } catch {}
    };

    const collectTasksFromDOM = () => {
        const items = [];
        list.querySelectorAll('li').forEach(li => {
            items.push({
                text: li.querySelector('.task-text')?.textContent || '',
                done: li.classList.contains('completed')
            });
        });
        return items;
    };

    let draggingTask = null;

    const renderTasks = (tasks) => {
        list.innerHTML = '';
        tasks.forEach(t => addTaskToDOM(t.text, t.done, false, false));
    };

    const saveFromDOM = () => writeTasks(collectTasksFromDOM());

    const setupDragHandlers = (li) => {
        li.addEventListener('dragstart', (e) => {
            draggingTask = li;
            li.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', '');
        });
        li.addEventListener('dragend', () => {
            if (draggingTask === li) draggingTask = null;
            li.classList.remove('dragging');
            saveFromDOM();
        });
    };

    const getDragAfterElement = (y) => {
        const draggableElements = [...list.querySelectorAll('li:not(.dragging)')];
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset, element: child };
            }
            return closest;
        }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
    };

    list.addEventListener('dragover', (e) => {
        if (!draggingTask) return;
        e.preventDefault();
        const afterElement = getDragAfterElement(e.clientY);
        if (!afterElement) {
            list.appendChild(draggingTask);
        } else if (afterElement !== draggingTask) {
            list.insertBefore(draggingTask, afterElement);
        }
    });
    list.addEventListener('drop', (e) => {
        if (draggingTask) e.preventDefault();
    });

    const enableInlineEditing = (li) => {
        const startEdit = () => {
            if (li.classList.contains('editing')) return;
            const textSpan = li.querySelector('.task-text');
            if (!textSpan) return;
            const current = textSpan.textContent || '';
            const inputEdit = document.createElement('input');
            inputEdit.type = 'text';
            inputEdit.value = current;
            inputEdit.className = 'task-edit-input';
            li.classList.add('editing');
            textSpan.replaceWith(inputEdit);
            inputEdit.focus();
            inputEdit.select();

            const finish = (commit) => {
                const value = commit ? (inputEdit.value || '').trim() : current;
                const newSpan = document.createElement('span');
                newSpan.className = 'task-text';
                newSpan.textContent = value || current;
                inputEdit.replaceWith(newSpan);
                li.classList.remove('editing');
                enableInlineEditing(li); // reattach handler
                saveFromDOM();
            };

            inputEdit.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    finish(true);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    finish(false);
                }
            });
            inputEdit.addEventListener('blur', () => finish(true));
        };

        const textSpan = li.querySelector('.task-text');
        if (textSpan) {
            textSpan.addEventListener('dblclick', startEdit);
        }
    };

    const addTaskToDOM = (text, done = false, persist = true, insertAtTop = false) => {
        const li = document.createElement('li');
        li.classList.toggle('completed', !!done);
        li.draggable = true;
        li.innerHTML = `
            <input type="checkbox" class="task-check" ${done ? 'checked' : ''} />
            <span class="task-text"></span>
            <span class="task-meta"></span>
            <button class="task-delete" title="Delete"><i class="fas fa-trash"></i></button>
        `;
        li.querySelector('.task-text').textContent = text;
        const meta = li.querySelector('.task-meta');
        if (meta) meta.textContent = '';
        li.querySelector('.task-check').addEventListener('change', (e) => {
            li.classList.toggle('completed', e.target.checked);
            saveFromDOM();
        });
        li.querySelector('.task-delete').addEventListener('click', () => {
            li.remove();
            saveFromDOM();
        });
        setupDragHandlers(li);
        enableInlineEditing(li);
        if (insertAtTop && list.firstChild) {
            list.insertBefore(li, list.firstChild);
        } else {
            list.appendChild(li);
        }
        if (persist) saveFromDOM();
    };

    const addTask = () => {
        const text = (input.value || '').trim();
        if (!text) return;
        addTaskToDOM(text, false, true, true);
        input.value = '';
        input.focus();
    };

    addBtn.addEventListener('click', addTask);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            addTask();
        }
    });

    clearCompletedBtn?.addEventListener('click', () => {
        list.querySelectorAll('li.completed').forEach(li => li.remove());
        saveFromDOM();
    });
    clearAllBtn?.addEventListener('click', () => {
        list.innerHTML = '';
        saveFromDOM();
    });
    clearStorageBtn?.addEventListener('click', () => {
        localStorage.removeItem(STORAGE_KEY);
        // Leave DOM as-is; next reload will be empty. If you prefer, also clear DOM:
        // list.innerHTML = '';
    });

    // Initial render from localStorage
    renderTasks(readTasks());
}

// Setup event listeners to replace inline onclick handlers
function setupEventListeners() {
    console.log('🔧 Setting up event listeners...');
    
    // Navigation tabs
    const trackerTab = document.getElementById('tracker-tab');
    console.log('tracker-tab exists?', !!trackerTab);
    if (trackerTab) {
        trackerTab.addEventListener('click', showTracker);
    }
    
    // Insights toggle button
    const insightsToggleBtn = document.getElementById('insights-toggle-btn');
    if (insightsToggleBtn) {
        insightsToggleBtn.addEventListener('click', toggleInsights);
        console.log('✅ Insights toggle button event listener attached');
    }

    // Tasks toggle button
    const tasksToggleBtn = document.getElementById('tasks-toggle-btn');
    if (tasksToggleBtn) {
        tasksToggleBtn.addEventListener('click', () => {
            const section = document.getElementById('tasks-section');
            if (!section) return;
            const isHidden = section.style.display === 'none' || section.style.display === '';
            section.style.display = isHidden ? 'block' : 'none';
            if (isHidden) {
                document.getElementById('new-task-input')?.focus();
            }
        });
    }
    
    // Action buttons
    const refreshBtn = document.getElementById('refresh-btn');
    console.log('refresh-btn exists?', !!refreshBtn);
    if (refreshBtn) {
        refreshBtn.addEventListener('click', refreshData);
        console.log('✅ Refresh button event listener attached');
    } else {
        console.error('❌ Refresh button not found in DOM!');
    }
    document.getElementById('debug-btn')?.addEventListener('click', debugDashboard);
    document.getElementById('streak-btn')?.addEventListener('click', openStreakSettings);
    document.getElementById('import-csv-btn')?.addEventListener('click', importCSV);

    // Numbering feature
    document.getElementById('numbering-btn')?.addEventListener('click', () => {
        jobTracker?.toggleNumberingMode();
    });
    document.getElementById('numbering-done-btn')?.addEventListener('click', () => {
        if (jobTracker?.isNumberingMode) jobTracker.toggleNumberingMode();
    });
    document.getElementById('numbering-clear-btn')?.addEventListener('click', () => {
        jobTracker?.clearAllRanks();
    });

    // View sub-tabs (both old .view-tab and new .f-tab)
    document.querySelectorAll('.f-tab, .view-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            jobTracker?.setActiveView(tab.dataset.view);
        });
    });

    // Table / Cards view toggle
    document.querySelectorAll('#view-toggle button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#view-toggle button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const isCards = btn.dataset.view === 'cards';
            const tableWrap = document.getElementById('jobs-table-wrap');
            const cardsWrap = document.getElementById('jobs-cards');
            if (tableWrap) tableWrap.style.display = isCards ? 'none' : '';
            if (cardsWrap) {
                cardsWrap.style.display = isCards ? '' : 'none';
                if (isCards) jobTracker?.renderCards();
            }
        });
    });

    // Row click in numbering mode (delegated)
    document.getElementById('jobs-container')?.addEventListener('click', (e) => {
        if (!jobTracker?.isNumberingMode) return;
        // Ignore clicks on interactive elements
        if (e.target.closest('button, select, input, a, .action-icon, .row-action')) return;
        const row = e.target.closest('tr[data-id]');
        if (row) jobTracker.handleRankClick(row.dataset.id);
    });

    // Resume file upload (delegated)
    document.getElementById('jobs-container')?.addEventListener('change', (e) => {
        const input = e.target.closest('.resume-file-input');
        if (!input || !input.files?.[0]) return;
        jobTracker?.uploadResume(input.dataset.id, input.files[0]);
    });

    // Resume download (delegated)
    document.getElementById('jobs-container')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.resume-download-btn');
        if (!btn) return;
        e.stopPropagation();
        jobTracker?.downloadResume(btn.dataset.url);
    });

    // Resume delete — show confirm modal
    let pendingResumeDeleteId = null;
    document.getElementById('jobs-container')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.resume-delete-btn');
        if (!btn) return;
        e.stopPropagation();
        pendingResumeDeleteId = btn.dataset.id;
        document.getElementById('resume-delete-modal').style.display = 'flex';
    });
    document.getElementById('confirm-resume-delete')?.addEventListener('click', () => {
        document.getElementById('resume-delete-modal').style.display = 'none';
        if (pendingResumeDeleteId) jobTracker?.deleteResume(pendingResumeDeleteId);
        pendingResumeDeleteId = null;
    });
    document.getElementById('cancel-resume-delete')?.addEventListener('click', () => {
        document.getElementById('resume-delete-modal').style.display = 'none';
        pendingResumeDeleteId = null;
    });
    document.getElementById('close-resume-delete-modal')?.addEventListener('click', () => {
        document.getElementById('resume-delete-modal').style.display = 'none';
        pendingResumeDeleteId = null;
    });

    // Drag-to-reorder in Numbered tab
    let dragSrcId = null;
    const jobsContainer = document.getElementById('jobs-container');
    jobsContainer?.addEventListener('dragstart', (e) => {
        const row = e.target.closest('tr[draggable="true"]');
        if (!row) return;
        dragSrcId = row.dataset.id;
        row.classList.add('drag-dragging');
        e.dataTransfer.effectAllowed = 'move';
    });
    jobsContainer?.addEventListener('dragend', (e) => {
        const row = e.target.closest('tr');
        row?.classList.remove('drag-dragging');
        jobsContainer.querySelectorAll('.drag-over').forEach(r => r.classList.remove('drag-over'));
    });
    jobsContainer?.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const row = e.target.closest('tr[draggable="true"]');
        if (!row || row.dataset.id === dragSrcId) return;
        jobsContainer.querySelectorAll('.drag-over').forEach(r => r.classList.remove('drag-over'));
        row.classList.add('drag-over');
    });
    jobsContainer?.addEventListener('dragleave', (e) => {
        const row = e.target.closest('tr');
        row?.classList.remove('drag-over');
    });
    jobsContainer?.addEventListener('drop', (e) => {
        e.preventDefault();
        const row = e.target.closest('tr[draggable="true"]');
        if (!row || !dragSrcId || row.dataset.id === dragSrcId) return;
        row.classList.remove('drag-over');
        jobTracker?.reorderRanks(dragSrcId, row.dataset.id);
        dragSrcId = null;
    });

    // Download CSV backup buttons (both in header and insights section)
    const downloadCsvBtn = document.getElementById('download-csv-btn');
    const downloadCsvBtnInsights = document.getElementById('download-csv-btn-insights');

    console.log('download-csv-btn exists?', !!downloadCsvBtn);
    console.log('download-csv-btn-insights exists?', !!downloadCsvBtnInsights);

    const handleDownloadClick = () => {
        console.log('📥 Download CSV button clicked!');
        if (jobTracker) {
            jobTracker.exportAllJobs();
        } else {
            console.error('jobTracker not initialized');
            alert('Error: Job tracker not initialized. Please refresh the page.');
        }
    };

    if (downloadCsvBtn) {
        downloadCsvBtn.addEventListener('click', handleDownloadClick);
        console.log('✅ Download CSV button (header) event listener attached');
    } else {
        console.error('❌ Download CSV button (header) not found in DOM!');
    }

    if (downloadCsvBtnInsights) {
        downloadCsvBtnInsights.addEventListener('click', handleDownloadClick);
        console.log('✅ Download CSV button (insights) event listener attached');
    } else {
        console.error('❌ Download CSV button (insights) not found in DOM!');
    }

    // Delete selected button
    const deleteSelectedBtn = document.getElementById('delete-selected-btn');
    console.log('delete-selected-btn exists?', !!deleteSelectedBtn);
    if (deleteSelectedBtn) {
        deleteSelectedBtn.addEventListener('click', async (e) => {
            console.log('🗑️ Delete selected button clicked!');
            e.preventDefault();
            e.stopPropagation();
            if (jobTracker) {
                await jobTracker.deleteSelectedJobs();
            } else {
                console.error('jobTracker not initialized');
            }
        });
        console.log('✅ Delete selected button event listener attached');
    } else {
        console.error('❌ Delete selected button not found in DOM!');
    }
    
    // Clear filters button
    const clearFiltersBtn = document.getElementById('clear-filters-btn');
    if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener('click', () => {
            if (jobTracker) {
                // Reset all filters to default (saved & applied)
                jobTracker.currentFilters = {
                    search: '',
                    status: ['saved'],
                    company: 'all',
                    location: 'all',
                    source: 'all',
                    tag: 'all',
                    dateRange: 'all'
                };

                jobTracker.populateFilterOptions();
                
                // Clear search input
                const searchInput = document.getElementById('search-input');
                if (searchInput) {
                    searchInput.value = '';
                }
                
                // Reset all filter button displays
                const filterBtns = document.querySelectorAll('.filter-btn, .chip[data-filter]');
                filterBtns.forEach(btn => {
                    const filterType = btn.dataset.filter;
                    const filterValueSpan = btn.querySelector('.filter-value');
                    if (filterValueSpan) {
                        switch(filterType) {
                            case 'date':
                                filterValueSpan.textContent = 'All Time';
                                break;
                            case 'status':
                                filterValueSpan.textContent = jobTracker
                                    ? jobTracker.getStatusFilterLabel()
                                    : 'Status';
                                break;
                            case 'company':
                                filterValueSpan.textContent = jobTracker
                                    ? jobTracker.getCompanyFilterLabel()
                                    : 'All Companies';
                                break;
                            case 'location':
                                filterValueSpan.textContent = 'All Locations';
                                break;
                            case 'source':
                                filterValueSpan.textContent = 'All Sources';
                                break;
                            case 'tag':
                                filterValueSpan.textContent = 'All Tags';
                                break;
                        }
                    }
                });
                
                // Apply filters (shows all jobs)
                jobTracker.applyFilters();
                
                // Hide the clear button
                jobTracker.updateClearFiltersButton();
                
                console.log('✅ All filters cleared');
            }
        });
        console.log('✅ Clear filters button event listener attached');
    }
    
    // Modal close buttons
    document.querySelectorAll('.close-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modal = e.target.closest('.modal');
            if (modal) {
                modal.style.display = 'none';
            }
        });
    });
    
    // Cancel buttons
    document.getElementById('cancel-add-job')?.addEventListener('click', () => {
        document.getElementById('add-job-modal').style.display = 'none';
    });
    
    document.getElementById('cancel-comment')?.addEventListener('click', () => {
        document.getElementById('comment-modal').style.display = 'none';
    });
    
    document.getElementById('cancel-import')?.addEventListener('click', () => {
        document.getElementById('import-modal').style.display = 'none';
    });
    
    // Form submissions
    document.getElementById('add-job-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveJob();
    });
    
    document.getElementById('comment-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        saveComment();
    });

    // Pomodoro Timer initialization
    if (window.pomodoroTimer) {
        window.pomodoroTimer.init();
    }

    // Initialize Tasks UI (in-memory)
    initTasksUI();
}

// Pomodoro Timer Class
class PomodoroTimer {
    constructor(supabase) {
        this.supabase = supabase;
        this.timerInterval = null;
        this.remainingSeconds = 0;
        this.totalSeconds = 0;
        this.isRunning = false;
        this.currentDuration = 30; // Default
        this.focusNote = ''; // Store focus note
        this.category = 'job-app'; // Default category
        this.timerStartTime = null; // Track when timer actually started

        this.currentDayISO = new Date(new Date().setHours(0,0,0,0)).toISOString();
        this.recentDays = [];
    }

    init() {
        console.log('🍅 Initializing Pomodoro Timer...');

        // Check if there's a timer in progress
        this.loadTimerState();

        // Load today's sessions
        this.loadTodaySessions();
        this.loadRecentDays();
        this.ensureChartsLoaded();

        // Event listeners
        const startBtn = document.getElementById('start-timer-btn');
        const stopBtn = document.getElementById('stop-timer-btn');
        const toggleBtn = document.getElementById('pomodoro-toggle-btn');

        console.log('Button elements:', {
            startBtn: !!startBtn,
            stopBtn: !!stopBtn,
            toggleBtn: !!toggleBtn
        });

        if (startBtn) {
            startBtn.addEventListener('click', () => this.startTimer());
            console.log('✅ Start button listener attached');
        }

        if (stopBtn) {
            stopBtn.addEventListener('click', () => {
                console.log('🛑 Stop button clicked (event listener)');
                this.showCancelModal();
            });
            console.log('✅ Stop button listener attached');
        }

        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => this.toggleSection());
            console.log('✅ Toggle button listener attached');
        }

        // Cancel/Stop timer modal listeners
        document.getElementById('stop-timer-yes')?.addEventListener('click', () => {
            this.hideCancelModal();
            this.stopAndSaveTimer();
        });

        document.getElementById('cancel-timer-yes')?.addEventListener('click', () => {
            this.hideCancelModal();
            this.cancelTimer();
        });

        document.getElementById('cancel-timer-continue')?.addEventListener('click', () => {
            this.hideCancelModal();
        });

        document.getElementById('close-cancel-timer-modal')?.addEventListener('click', () => {
            this.hideCancelModal();
        });

        // Delete session modal listeners
        document.getElementById('close-delete-session-modal')?.addEventListener('click', () => {
            const m = document.getElementById('delete-session-modal');
            if (m) m.style.display = 'none';
            this.pendingDeleteSessionId = null;
        });
        document.getElementById('cancel-delete-session-btn')?.addEventListener('click', () => {
            const m = document.getElementById('delete-session-modal');
            if (m) m.style.display = 'none';
            this.pendingDeleteSessionId = null;
        });
        document.getElementById('confirm-delete-session-btn')?.addEventListener('click', async () => {
            const id = this.pendingDeleteSessionId;
            const m = document.getElementById('delete-session-modal');
            if (!id) { if (m) m.style.display = 'none'; return; }
            await this.deleteSession(id);
            if (m) m.style.display = 'none';
            this.pendingDeleteSessionId = null;
            await this.loadTodaySessions();
        });

        // Category tab listeners
        document.querySelectorAll('.category-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                // Remove active from all tabs
                document.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
                // Add active to clicked tab
                tab.classList.add('active');
                // Store selected category
                this.category = tab.dataset.category;
                console.log(`📁 Category selected: ${this.category}`);
            });
        });

        // Hide category and note groups initially
        const categoryGroup = document.getElementById('category-group');
        const focusGroup = document.getElementById('focus-note-group');
        if (categoryGroup) categoryGroup.style.display = 'none';
        if (focusGroup) focusGroup.style.display = 'none';

        console.log('✅ Pomodoro timer initialized');
    }
    
    toggleSection() {
        const section = document.getElementById('pomodoro-section');
        const btn = document.getElementById('pomodoro-toggle-btn');
        const insightsSection = document.getElementById('insights-section');
        const sankeySection = document.getElementById('sankey-section');
        const insightsBtn = document.getElementById('insights-toggle-btn');
        const sankeyBtn = document.getElementById('sankey-toggle-btn');

        if (section.style.display === 'none') {
            // Show pomodoro, hide others
            section.style.display = 'block';
            btn.classList.add('active');
            btn.querySelector('span').textContent = 'Hide Pomodoro';

            insightsSection.style.display = 'none';
            sankeySection.style.display = 'none';
            insightsBtn.classList.remove('active');
            sankeyBtn.classList.remove('active');
            insightsBtn.querySelector('span').textContent = 'Insights';
            sankeyBtn.querySelector('span').textContent = 'Sankey';
        } else {
            // Hide pomodoro
            section.style.display = 'none';
            btn.classList.remove('active');
            btn.querySelector('span').textContent = 'Pomodoro';
        }
    }

    startTimer() {
        // Support fractional minutes (e.g., 0.5 = 30 seconds)
        const duration = parseFloat(document.getElementById('timer-duration').value);
        // Do not require note before starting; reveal inputs after start

        this.currentDuration = duration;
        this.totalSeconds = Math.round(duration * 60);
        this.remainingSeconds = this.totalSeconds;
        // Keep whatever is in the note (likely empty initially)
        this.focusNote = document.getElementById('focus-note').value.trim();
        this.timerStartTime = Date.now();

        // Reveal category and focus inputs; keep setup visible during countdown
        const categoryGroup = document.getElementById('category-group');
        const focusGroup = document.getElementById('focus-note-group');
        if (categoryGroup) categoryGroup.style.display = '';
        if (focusGroup) focusGroup.style.display = '';

        document.getElementById('timer-setup').style.display = 'block';
        document.getElementById('timer-display').style.display = 'flex';

        // Hide duration select and start button while running
        const durationGroup = document.getElementById('duration-group');
        const startBtn = document.getElementById('start-timer-btn');
        if (durationGroup) durationGroup.style.display = 'none';
        if (startBtn) startBtn.style.display = 'none';

        // Start the timer
        this.isRunning = true;
        this.updateTimerDisplay();
        this.saveTimerState();

        this.timerInterval = setInterval(() => {
            this.remainingSeconds--;
            this.updateTimerDisplay();
            this.saveTimerState();

            if (this.remainingSeconds <= 0) {
                this.completeTimer();
            }
        }, 1000);

        console.log(`🍅 Timer started: ${duration} minutes`);
    }

    showCancelModal() {
        console.log('🛑 Showing cancel timer modal');
        const modal = document.getElementById('cancel-timer-modal');
        if (modal) {
            modal.style.display = 'flex';
        }
    }
    
    hideCancelModal() {
        console.log('✅ Hiding cancel timer modal');
        const modal = document.getElementById('cancel-timer-modal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    async stopAndSaveTimer() {
        console.log('🛑 Stopping timer and saving progress');

        // Calculate actual time focused (in seconds)
        const secondsElapsed = this.totalSeconds - this.remainingSeconds;
        // Convert to decimal minutes (e.g., 150 seconds = 2.5 minutes)
        const minutesElapsed = Number((secondsElapsed / 60).toFixed(2));

        const mins = Math.floor(minutesElapsed);
        const secs = Math.round((minutesElapsed - mins) * 60);
        console.log(`⏱️ Time focused: ${mins}m ${secs}s (${minutesElapsed} minutes) out of ${this.currentDuration} planned`);

        this.clearTimer();

        // Capture latest category and note
        const selectedTab = document.querySelector('.category-tab.active');
        this.category = selectedTab ? selectedTab.getAttribute('data-category') : (this.category || 'job-app');
        this.focusNote = document.getElementById('focus-note').value.trim();

        // Save partial session to Supabase
        if (minutesElapsed > 0) {
            await this.saveSession(minutesElapsed, this.focusNote, true); // true = stopped early
        }

        // Reset UI
        this.resetUI();

        // Reload today's sessions
        await this.loadTodaySessions();
    }

    cancelTimer() {
        console.log('❌ Cancelling timer without saving');
        this.clearTimer();
        this.resetUI();
    }

    async completeTimer() {
        console.log('🍅 Timer completed!');
        this.clearTimer();

        // Capture latest category and note
        const selectedTab = document.querySelector('.category-tab.active');
        this.category = selectedTab ? selectedTab.getAttribute('data-category') : (this.category || 'job-app');
        this.focusNote = document.getElementById('focus-note').value.trim();

        // Save to Supabase (full duration completed)
        await this.saveSession(this.currentDuration, this.focusNote, false); // false = completed fully

        // Show completion notification
        this.showCompletionNotification();

        // Reset UI
        this.resetUI();

        // Reload today's sessions
        await this.loadTodaySessions();
    }

    clearTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        this.isRunning = false;
        localStorage.removeItem('pomodoro_timer_state');
    }

    resetUI() {
        document.getElementById('timer-setup').style.display = 'flex';
        document.getElementById('timer-display').style.display = 'none';
        // Clear the focus note input
        document.getElementById('focus-note').value = '';
        // Hide category and note groups again until next start
        const categoryGroup = document.getElementById('category-group');
        const focusGroup = document.getElementById('focus-note-group');
        if (categoryGroup) categoryGroup.style.display = 'none';
        if (focusGroup) focusGroup.style.display = 'none';
        // Show duration and start button again
        const durationGroup = document.getElementById('duration-group');
        const startBtn = document.getElementById('start-timer-btn');
        if (durationGroup) durationGroup.style.display = '';
        if (startBtn) startBtn.style.display = '';
    }

    updateTimerDisplay() {
        const minutes = Math.floor(this.remainingSeconds / 60);
        const seconds = this.remainingSeconds % 60;

        const timeString = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        document.getElementById('timer-time').textContent = timeString;

        // Update circular progress
        const progress = 1 - (this.remainingSeconds / this.totalSeconds);
        const circumference = 2 * Math.PI * 130; // radius is 130
        const offset = circumference * (1 - progress);

        const circle = document.getElementById('timer-progress-circle');
        circle.style.strokeDashoffset = offset;
    }

    saveTimerState() {
        const state = {
            remainingSeconds: this.remainingSeconds,
            totalSeconds: this.totalSeconds,
            currentDuration: this.currentDuration,
            focusNote: this.focusNote,
            timerStartTime: this.timerStartTime,
            startTime: Date.now()
        };
        localStorage.setItem('pomodoro_timer_state', JSON.stringify(state));
    }

    loadTimerState() {
        const stateData = localStorage.getItem('pomodoro_timer_state');
        if (!stateData) return;

        const state = JSON.parse(stateData);
        const elapsedSeconds = Math.floor((Date.now() - state.startTime) / 1000);
        const adjustedRemaining = state.remainingSeconds - elapsedSeconds;

        if (adjustedRemaining > 0) {
            // Resume the timer
            this.currentDuration = state.currentDuration;
            this.totalSeconds = state.totalSeconds;
            this.remainingSeconds = adjustedRemaining;
            this.focusNote = state.focusNote || '';
            this.timerStartTime = state.timerStartTime || state.startTime;

            // Update UI
            document.getElementById('timer-setup').style.display = 'none';
            document.getElementById('timer-display').style.display = 'flex';

            this.isRunning = true;
            this.updateTimerDisplay();

            // Continue countdown
            this.timerInterval = setInterval(() => {
                this.remainingSeconds--;
                this.updateTimerDisplay();
                this.saveTimerState();

                if (this.remainingSeconds <= 0) {
                    this.completeTimer();
                }
            }, 1000);

            console.log(`🍅 Resumed timer from previous session - Focus: "${this.focusNote}"`);
        } else {
            // Timer expired while page was closed
            localStorage.removeItem('pomodoro_timer_state');
        }
    }

    async saveSession(durationMinutes, focusNote = '', stoppedEarly = false) {
        try {
            const { data, error} = await this.supabase
                .from('pomodoro_sessions')
                .insert([{
                    duration_minutes: durationMinutes,
                    focus_note: focusNote,
                    category: this.category,
                    stopped_early: stoppedEarly,
                    completed_at: new Date().toISOString()
                }])
                .select()
                .single();

            if (error) throw error;

            console.log('✅ Session saved to Supabase:', data);
        } catch (error) {
            console.error('❌ Error saving session:', error);
            alert('Failed to save session to database. Please check your connection.');
        }
    }

    async deleteSession(sessionId) {
        try {
            const { error } = await this.supabase
                .from('pomodoro_sessions')
                .delete()
                .eq('id', sessionId);

            if (error) throw error;

            console.log('✅ Session deleted from Supabase');

            // Reload today's sessions
            await this.loadTodaySessions();
        } catch (error) {
            console.error('❌ Error deleting session:', error);
            alert('Failed to delete session from database.');
        }
    }

    async loadTodaySessions() {
        try {
            const day = this.currentDayISO ? new Date(this.currentDayISO) : new Date();
            day.setHours(0, 0, 0, 0);
            const todayISO = day.toISOString();
            const nextDayISO = new Date(day.getTime() + 24*60*60*1000).toISOString();

            const { data, error } = await this.supabase
                .from('pomodoro_sessions')
                .select('*')
                .gte('completed_at', todayISO)
                .lt('completed_at', nextDayISO)
                .order('completed_at', { ascending: false });

            if (error) throw error;

            this.displayTodaySessions(data || []);
            this.renderCategoryPie(data || []);
        } catch (error) {
            console.error('❌ Error loading sessions:', error);
            this.displayTodaySessions([]);
        }
    }

    async loadRecentDays(limit = 30) {
        try {
            const { data, error } = await this.supabase
                .from('pomodoro_sessions')
                .select('completed_at, duration_minutes')
                .order('completed_at', { ascending: false })
                .limit(1000);
            if (error) throw error;

            const map = new Map();
            (data || []).forEach(row => {
                const d = new Date(row.completed_at);
                d.setHours(0,0,0,0);
                const key = d.toISOString();
                const prev = map.get(key) || 0;
                map.set(key, prev + (row.duration_minutes || 0));
            });

            const days = Array.from(map.entries())
                .sort((a,b) => new Date(b[0]) - new Date(a[0]))
                .slice(0, limit)
                .map(([iso, minutes]) => ({ iso, minutes }));
            this.recentDays = days;
            this.renderDaysSidebar();
        } catch (e) {
            console.error('❌ Error loading recent days:', e);
            this.recentDays = [];
            this.renderDaysSidebar();
        }
    }

    renderDaysSidebar() {
        const el = document.getElementById('pomodoro-days');
        if (!el) return;
        if (!this.recentDays.length) {
            el.innerHTML = '<div style="color:#64748b; padding:0.5rem;">No data</div>';
            return;
        }
        el.innerHTML = this.recentDays.map(d => {
            const date = new Date(d.iso);
            const label = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', weekday: 'short' });
            const hours = (d.minutes/60).toFixed(1);
            const active = (this.currentDayISO && new Date(this.currentDayISO).toISOString() === new Date(d.iso).toISOString()) ? 'active' : '';
            return `<div class="pomodoro-day-item ${active}" data-iso="${d.iso}">
                <span>${label}</span>
                <span style="font-weight:600">${hours}h</span>
            </div>`;
        }).join('');

        el.querySelectorAll('.pomodoro-day-item').forEach(item => {
            item.addEventListener('click', () => {
                this.currentDayISO = item.getAttribute('data-iso');
                el.querySelectorAll('.pomodoro-day-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                this.loadTodaySessions();
            });
        });
    }

    ensureChartsLoaded() {
        if (typeof google !== 'undefined' && google.charts) return;
        if (typeof google === 'undefined') return; // rely on existing loader from Sankey page
        try { google.charts.load('current', { packages: ['corechart'] }); } catch {}
    }

    renderCategoryPie(sessions) {
        if (typeof google === 'undefined' || !google.visualization) {
            // Try to load then defer
            if (typeof google !== 'undefined' && google.charts) {
                google.charts.load('current', { packages: ['corechart'] });
                setTimeout(() => this.renderCategoryPie(sessions), 400);
            }
            return;
        }
        const container = document.getElementById('pomodoro-category-pie');
        if (!container) return;

        const totals = sessions.reduce((acc, s) => {
            const cat = s.category || 'General';
            acc[cat] = (acc[cat] || 0) + (s.duration_minutes || 0);
            return acc;
        }, {});

        const data = new google.visualization.DataTable();
        data.addColumn('string', 'Category');
        data.addColumn('number', 'Minutes');
        const rows = Object.entries(totals);
        if (!rows.length) {
            container.innerHTML = '<div style="color:#64748b; text-align:center; padding:1rem;">No data for this day</div>';
            return;
        }
        data.addRows(rows);

        const options = {
            legend: { position: 'right', textStyle: { color: getComputedStyle(document.body).getPropertyValue('--text-color') || '#1f2937' } },
            backgroundColor: 'transparent',
            pieHole: 0.35,
            chartArea: { left: 10, top: 10, width: '85%', height: '85%' },
            colors: ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#22c55e']
        };

        const chart = new google.visualization.PieChart(container);
        chart.draw(data, options);
    }

    displayTodaySessions(sessions) {
        const totalSessions = sessions.length;
        const totalMinutes = sessions.reduce((sum, s) => sum + s.duration_minutes, 0);

        document.getElementById('sessions-count').textContent = totalSessions;
        document.getElementById('sessions-total-time').textContent = totalMinutes;

        const sessionsList = document.getElementById('sessions-list');

        if (sessions.length === 0) {
            sessionsList.innerHTML = '<p style="text-align: center; color: #666; padding: 1rem;">No sessions completed today</p>';
            return;
        }

        sessionsList.innerHTML = sessions.map(session => {
            const completedAt = new Date(session.completed_at);

            // Calculate start time based on duration
            const mins = Math.floor(session.duration_minutes);
            const secs = Math.round((session.duration_minutes - mins) * 60);
            const totalSeconds = mins * 60 + secs;
            const startTime = new Date(completedAt.getTime() - totalSeconds * 1000);

            // Format time range
            const startTimeStr = startTime.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit'
            });
            const endTimeStr = completedAt.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit'
            });

            // Format duration
            const durationDisplay = secs > 0 ? `${mins} min ${secs} sec` : `${mins} min`;

            // Category-based icon
            const cat = session.category || 'job-app';
            const categoryIconMap = {
                'job-app': 'fas fa-briefcase',
                'portfolio': 'fas fa-folder',
                'projects': 'fas fa-code',
                'networking': 'fas fa-users'
            };
            const iconClassName = categoryIconMap[cat] || 'fas fa-circle-dot';
            let iconClass = `${session.stopped_early ? 'stopped' : 'completed'} ${cat}`;
            let icon = `<i class="${iconClassName}"></i>`;

            // Add duration-based styling
            if (mins >= 60) {
                iconClass += ' long';
            } else if (mins < 30) {
                iconClass += ' short';
            }

            // Task name (use focus note or default)
            const taskName = session.focus_note || 'Focus session';
            const taskClass = session.stopped_early ? '' : 'completed';

            // Category badge
            const categoryLabel = {
                'job-app': 'Job App',
                'portfolio': 'Portfolio',
                'projects': 'Projects',
                'networking': 'Networking'
            }[session.category] || 'General';

            const categoryBadge = session.category
                ? `<span class="timeline-category ${session.category}">${categoryLabel}</span>`
                : '';

            // Delete button (X for all sessions)
            const deleteButton = `
                <div class="timeline-check stopped" data-session-id="${session.id}" title="Delete session">
                    <i class=\"fas fa-times\"></i>
                </div>
            `;

            return `
                <div class="timeline-item">
                    <div class="timeline-icon ${iconClass}">
                        ${icon}
                    </div>
                    <div class="timeline-content">
                        <div class="timeline-time">
                            ${startTimeStr} – ${endTimeStr} <span class="timeline-duration">(${durationDisplay})</span>
                            ${categoryBadge}
                        </div>
                        <div class="timeline-task ${taskClass}">
                            ${taskName}
                        </div>
                    </div>
                    ${deleteButton}
                </div>
            `;
        }).join('');

        // Add click handlers for delete buttons (show modal instead of confirm)
        document.querySelectorAll('.timeline-check').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const sessionId = e.currentTarget.dataset.sessionId;
                if (!sessionId) return;

                this.pendingDeleteSessionId = sessionId;
                const modal = document.getElementById('delete-session-modal');
                if (modal) modal.style.display = 'flex';
            });
        });
    }

    showCompletionNotification() {
        const toast = document.createElement('div');
        toast.className = 'streak-break-toast';
        toast.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
        toast.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px;">
                <i class="fas fa-check-circle" style="font-size: 24px; color: white;"></i>
                <div>
                    <div style="font-weight: 600; margin-bottom: 4px;">Timer Complete!</div>
                    <div style="font-size: 0.9rem; opacity: 0.9;">Great work! You completed ${this.currentDuration} minutes of focused work.</div>
                </div>
                <button onclick="this.parentElement.parentElement.remove()" style="margin-left: auto; background: none; border: none; color: white; cursor: pointer; font-size: 20px; padding: 0 8px;">&times;</button>
            </div>
        `;

        document.body.appendChild(toast);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (toast.parentElement) {
                toast.style.opacity = '0';
                setTimeout(() => toast.remove(), 300);
            }
        }, 5000);
    }
}
