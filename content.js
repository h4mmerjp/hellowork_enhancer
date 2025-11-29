// Hello Work Enhancer Content Script

console.log("Hello Work Enhancer loaded");

// Constants
const STORAGE_KEY_FETCHING = 'hw_is_fetching';
const STORAGE_KEY_DATA = 'hw_jobs_data';

// State (in-memory)
let allJobs = []; // Used for local sorting of displayed items

// --- Main Entry Point ---
if (sessionStorage.getItem(STORAGE_KEY_FETCHING) === 'true') {
    // We are in the middle of a fetch loop
    processAutoFetch();
} else {
    // Normal load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectUI);
    } else {
        injectUI();
    }
}

// --- UI Injection ---
function injectUI() {
    if (document.getElementById('hw-enhancer-panel')) return;

    // Check if we have stored data to display (after fetch complete)
    const storedData = sessionStorage.getItem(STORAGE_KEY_DATA);
    let hasStoredData = false;
    if (storedData) {
        const jobs = JSON.parse(storedData);
        if (jobs.length > 0) hasStoredData = true;
    }

    const panel = document.createElement('div');
    panel.id = 'hw-enhancer-panel';
    panel.innerHTML = `
        <h3>ハローワーク拡張機能</h3>
        <p style="font-size:12px; margin-bottom:8px;">
            全ページを自動で巡回して取得します。<br>
            (取得中は画面が切り替わります)
        </p>
        <button id="hw-btn-fetch-all" class="hw-btn">全件取得開始 (自動ページ送り)</button>
        <button id="hw-btn-parse" class="hw-btn">表示中の求人のみ読み込む</button>
        
        <div id="hw-controls" style="display:none;">
            <div style="font-size:12px; margin-bottom:5px; font-weight:bold;" id="hw-count-display"></div>
            <button id="hw-btn-sort-salary-max" class="hw-btn">賃金順 (上限が高い順)</button>
            <button id="hw-btn-sort-salary-min" class="hw-btn">賃金順 (下限が高い順)</button>
            <button id="hw-btn-sort-hours" class="hw-btn">就業時間順 (短い順)</button>
            <button id="hw-btn-reset" class="hw-btn">リセット (再読み込み)</button>
        </div>
        <div id="hw-status">準備完了</div>
    `;
    document.body.appendChild(panel);

    document.getElementById('hw-btn-fetch-all').addEventListener('click', startAutoFetch);
    document.getElementById('hw-btn-parse').addEventListener('click', parseCurrentPageOnly);
    
    document.getElementById('hw-btn-sort-salary-max').addEventListener('click', () => sortJobs('salary_max'));
    document.getElementById('hw-btn-sort-salary-min').addEventListener('click', () => sortJobs('salary_min'));
    document.getElementById('hw-btn-sort-hours').addEventListener('click', () => sortJobs('hours'));
    document.getElementById('hw-btn-reset').addEventListener('click', resetView);

    // If we just finished fetching, render the data
    if (hasStoredData) {
        renderStoredJobs();
    }
}

function updateStatus(message) {
    const el = document.getElementById('hw-status');
    if (el) el.textContent = message;
}

// --- Auto Fetch Logic ---

function startAutoFetch() {
    if (!confirm("全ページを自動で巡回します。\n完了するまでブラウザを操作しないでください。\nよろしいですか？")) return;

    sessionStorage.setItem(STORAGE_KEY_FETCHING, 'true');
    sessionStorage.setItem(STORAGE_KEY_DATA, '[]'); // Clear old data
    
    processAutoFetch();
}

function processAutoFetch() {
    // 1. Scrape current page
    const jobs = scrapeJobsFromPage();
    
    // 2. Append to storage
    let stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY_DATA) || '[]');
    stored = stored.concat(jobs);
    sessionStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(stored));

    // UI feedback (overlay if possible, but page will reload)
    // Create a blocking overlay to show progress
    showOverlay(`データ取得中... 現在 ${stored.length} 件取得済み`);

    // 3. Find Next button
    const nextBtn = document.querySelector('input[name="fwListNaviBtnNext"]');
    
    if (nextBtn && !nextBtn.disabled) {
        // Click next
        setTimeout(() => {
            nextBtn.click();
        }, 1000); // Small delay to be safe
    } else {
        // Finished
        sessionStorage.setItem(STORAGE_KEY_FETCHING, 'false');
        alert(`全件取得完了しました！\n合計: ${stored.length}件`);
        // Reload to clean state and render
        location.reload();
    }
}

function showOverlay(msg) {
    const div = document.createElement('div');
    div.style.position = 'fixed';
    div.style.top = '0';
    div.style.left = '0';
    div.style.width = '100%';
    div.style.height = '100%';
    div.style.backgroundColor = 'rgba(0,0,0,0.8)';
    div.style.color = 'white';
    div.style.zIndex = '10000';
    div.style.display = 'flex';
    div.style.justifyContent = 'center';
    div.style.alignItems = 'center';
    div.style.fontSize = '24px';
    div.textContent = msg;
    document.body.appendChild(div);
}

// --- Parsing Logic (HTML Extraction) ---

function scrapeJobsFromPage() {
    const jobTables = document.querySelectorAll('table.kyujin');
    const results = [];

    jobTables.forEach(table => {
        if (table.textContent.includes('賃金')) {
            const jobData = extractJobDataFromTable(table);
            if (jobData) {
                results.push({
                    html: table.outerHTML, // Save HTML to reconstruct later
                    data: jobData
                });
            }
        }
    });
    return results;
}

// --- Single Page Logic ---

function parseCurrentPageOnly() {
    const jobs = scrapeJobsFromPage();
    if (jobs.length === 0) {
        updateStatus("求人情報が見つかりませんでした。");
        return;
    }
    
    // Store in memory for sorting
    // We need to wrap them in objects compatible with sortJobs
    // But sortJobs expects { element, data }
    // Here we have { html, data }. 
    // For single page, we can just map the existing DOM elements.
    
    const jobTables = document.querySelectorAll('table.kyujin');
    allJobs = [];
    jobTables.forEach(table => {
        if (table.textContent.includes('賃金')) {
            const jobData = extractJobDataFromTable(table);
            if (jobData) {
                allJobs.push({ element: table, data: jobData });
            }
        }
    });

    updateStatus(`取得完了: ${allJobs.length}件`);
    document.getElementById('hw-controls').style.display = 'block';
    document.getElementById('hw-btn-parse').style.display = 'none';
    document.getElementById('hw-btn-fetch-all').style.display = 'none';
}

// --- Rendering Stored Data ---

function renderStoredJobs() {
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY_DATA) || '[]');
    if (stored.length === 0) return;

    // Hide fetch buttons
    document.getElementById('hw-btn-parse').style.display = 'none';
    document.getElementById('hw-btn-fetch-all').style.display = 'none';
    document.getElementById('hw-controls').style.display = 'block';
    document.getElementById('hw-count-display').textContent = `全データ表示中: ${stored.length}件`;

    // Clear current list
    // We need to find the container where jobs are listed.
    // Usually it's a parent div.
    const jobTables = document.querySelectorAll('table.kyujin');
    if (jobTables.length > 0) {
        const parent = jobTables[0].parentNode;
        // Remove all children that are job tables
        // Be careful not to remove headers/footers if they are in the same parent.
        // But usually in HW, the list is mixed.
        // Let's clear the parent's content and re-append ONLY our jobs?
        // That might kill the pagination controls, which is GOOD (we don't need them anymore).
        parent.innerHTML = '';
        
        // Reconstruct DOM elements from HTML strings
        allJobs = stored.map(item => {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = item.html;
            const element = tempDiv.firstElementChild;
            parent.appendChild(element);
            return { element: element, data: item.data };
        });
    }
}

// --- Helper Functions (Same as before) ---

function extractJobDataFromTable(table) {
    let salaryText = "";
    let hoursText = "";
    
    const rows = table.querySelectorAll('tr');
    rows.forEach(row => {
        const cells = row.querySelectorAll('td, th');
        if (cells.length >= 2) {
            const headerText = cells[0].textContent.trim();
            const valueText = cells[1].textContent.trim();
            
            if (headerText.includes('賃金')) {
                salaryText = valueText;
            } else if (headerText.includes('就業時間')) {
                hoursText = valueText;
            }
        }
    });

    if (!salaryText && !hoursText) return null;

    return {
        salary: parseSalary(salaryText),
        hours: parseHours(hoursText)
    };
}

function parseSalary(text) {
    if (!text) return { min: 0, max: 0 };
    const clean = text.replace(/,/g, '');
    const matches = clean.match(/(\d{4,})/g);
    if (matches && matches.length > 0) {
        const nums = matches.map(Number);
        return { min: Math.min(...nums), max: Math.max(...nums) };
    }
    return { min: 0, max: 0 };
}

function parseHours(text) {
    if (!text) return 9999;
    const timeMatch = text.match(/(\d{1,2})時(\d{1,2})分/);
    if (timeMatch) {
        const times = text.matchAll(/(\d{1,2})時(\d{1,2})分/g);
        const timeArray = [...times];
        if (timeArray.length >= 2) {
            const startH = parseInt(timeArray[0][1]);
            const startM = parseInt(timeArray[0][2]);
            const endH = parseInt(timeArray[1][1]);
            const endM = parseInt(timeArray[1][2]);
            let duration = (endH * 60 + endM) - (startH * 60 + startM);
            if (duration < 0) duration += 24 * 60;
            return duration;
        }
    }
    return 9999;
}

function sortJobs(criteria) {
    updateStatus("ソート中...");
    if (allJobs.length === 0) return;

    const parent = allJobs[0].element.parentNode;
    const fragment = document.createDocumentFragment();
    
    allJobs.sort((a, b) => {
        if (criteria === 'salary_max') {
            return b.data.salary.max - a.data.salary.max;
        } else if (criteria === 'salary_min') {
            return b.data.salary.min - a.data.salary.min;
        } else if (criteria === 'hours') {
            return a.data.hours - b.data.hours;
        }
        return 0;
    });

    allJobs.forEach(job => {
        fragment.appendChild(job.element);
        job.element.style.display = ''; 
        job.element.classList.add('hw-sorted-row');
    });
    
    parent.appendChild(fragment);
    updateStatus("ソート完了");
}

function resetView() {
    sessionStorage.removeItem(STORAGE_KEY_DATA);
    location.reload();
}
