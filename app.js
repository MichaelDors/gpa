import { GRADE_TIERS, SCALE_DEFINITIONS, getTierForGrade, calculateGpaPoints, calculateUnweightedPoints } from './config.js';

// ============================================================================
// State Management
// ============================================================================
const STORAGE_KEY = 'gpafinder_courses_v1';

let state = {
  courses: [],
  activeFilter: 'all', // 'all' | 'Freshman' | 'Sophomore' | 'Junior' | 'Senior'
};

// Generate unique ID
function uid() {
  return 'c_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

// Sample High School course data for instant testing
const SAMPLE_COURSES = [
  // Freshman
  { id: uid(), name: 'Honors English 9', scale: 'honors', credits: 1.0, grade: '94', year: 'Freshman' },
  { id: uid(), name: 'Honors Algebra 2', scale: 'honors', credits: 1.0, grade: '96', year: 'Freshman' },
  { id: uid(), name: 'Honors Biology', scale: 'honors', credits: 1.0, grade: '91', year: 'Freshman' },
  { id: uid(), name: 'World History', scale: 'regular', credits: 1.0, grade: '98', year: 'Freshman' },
  { id: uid(), name: 'Spanish 1', scale: 'regular', credits: 1.0, grade: '95', year: 'Freshman' },
  { id: uid(), name: 'Health', scale: 'regular', credits: 0.5, grade: '99', year: 'Freshman' },
  { id: uid(), name: 'Physical Education 1', scale: 'regular', credits: 0.5, grade: '100', year: 'Freshman' },

  // Sophomore
  { id: uid(), name: 'Honors English 10', scale: 'honors', credits: 1.0, grade: '93', year: 'Sophomore' },
  { id: uid(), name: 'Honors Pre-Calculus', scale: 'honors', credits: 1.0, grade: '89', year: 'Sophomore' },
  { id: uid(), name: 'Honors Chemistry', scale: 'honors', credits: 1.0, grade: '90', year: 'Sophomore' },
  { id: uid(), name: 'AP European History', scale: 'ap_ccp', credits: 1.0, grade: '92', year: 'Sophomore' },
  { id: uid(), name: 'Spanish 2', scale: 'regular', credits: 1.0, grade: '94', year: 'Sophomore' },
  { id: uid(), name: 'Financial Literacy', scale: 'regular', credits: 0.5, grade: '98', year: 'Sophomore' },
  { id: uid(), name: 'Physical Education 2', scale: 'regular', credits: 0.5, grade: '100', year: 'Sophomore' },

  // Junior
  { id: uid(), name: 'AP Language & Comp', scale: 'ap_ccp', credits: 1.0, grade: '91', year: 'Junior' },
  { id: uid(), name: 'AP Calculus BC', scale: 'ap_ccp', credits: 1.0, grade: '95', year: 'Junior' },
  { id: uid(), name: 'AP Physics C', scale: 'ap_ccp', credits: 1.0, grade: '88', year: 'Junior' },
  { id: uid(), name: 'AP US History', scale: 'ap_ccp', credits: 1.0, grade: '94', year: 'Junior' },
  { id: uid(), name: 'Honors Spanish 3', scale: 'honors', credits: 1.0, grade: '93', year: 'Junior' },
  { id: uid(), name: 'Computer Science Principles', scale: 'regular', credits: 1.0, grade: '97', year: 'Junior' }
];

// ============================================================================
// LocalStorage Persistence
// ============================================================================
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.courses));
  } catch (e) {
    console.error('Failed to save to localStorage', e);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        state.courses = parsed;
        return;
      }
    }
  } catch (e) {
    console.error('Failed to load from localStorage', e);
  }
  state.courses = createDefaultStarterRows();
}

function createDefaultStarterRows() {
  return [
    { id: uid(), name: '', scale: 'regular', credits: 1.0, grade: '', year: 'Freshman' },
    { id: uid(), name: '', scale: 'honors', credits: 1.0, grade: '', year: 'Freshman' },
    { id: uid(), name: '', scale: 'ap_ccp', credits: 1.0, grade: '', year: 'Freshman' }
  ];
}

function hasMeaningfulUserData() {
  return state.courses.some(c => (c.name && c.name.trim().length > 0) || (c.grade && String(c.grade).trim().length > 0));
}

// ============================================================================
// Calculation Engine
// ============================================================================
function calculateMetrics(coursesList = state.courses) {
  let totalCredits = 0;
  let weightedQualityPoints = 0;
  let unweightedQualityPoints = 0;
  let validCoursesCount = 0;

  const yearStats = {
    Freshman: { credits: 0, weightedPts: 0 },
    Sophomore: { credits: 0, weightedPts: 0 },
    Junior: { credits: 0, weightedPts: 0 },
    Senior: { credits: 0, weightedPts: 0 },
  };

  coursesList.forEach(course => {
    const credits = parseFloat(course.credits);
    if (isNaN(credits) || credits <= 0) return;

    const weightedPts = calculateGpaPoints(course.grade, course.scale);
    const unweightedPts = calculateUnweightedPoints(course.grade);

    if (weightedPts !== null) {
      totalCredits += credits;
      weightedQualityPoints += (weightedPts * credits);
      unweightedQualityPoints += (unweightedPts * credits);
      validCoursesCount++;

      if (yearStats[course.year]) {
        yearStats[course.year].credits += credits;
        yearStats[course.year].weightedPts += (weightedPts * credits);
      }
    }
  });

  const cumulativeWeightedGpa = totalCredits > 0 ? (weightedQualityPoints / totalCredits) : 0;
  const cumulativeUnweightedGpa = totalCredits > 0 ? (unweightedQualityPoints / totalCredits) : 0;

  const yearResults = {};
  for (const [yr, data] of Object.entries(yearStats)) {
    yearResults[yr] = {
      credits: data.credits,
      gpa: data.credits > 0 ? (data.weightedPts / data.credits) : null
    };
  }

  return {
    totalCredits,
    cumulativeWeightedGpa,
    cumulativeUnweightedGpa,
    validCoursesCount,
    yearResults,
    weightedQualityPoints
  };
}

// ============================================================================
// DOM Rendering & Updates
// ============================================================================
function updateStatsUI() {
  const metrics = calculateMetrics();

  document.getElementById('stat-weighted-gpa').textContent = 
    metrics.totalCredits > 0 ? metrics.cumulativeWeightedGpa.toFixed(3) : '0.000';
  document.getElementById('stat-unweighted-gpa').textContent = 
    metrics.totalCredits > 0 ? metrics.cumulativeUnweightedGpa.toFixed(3) : '0.000';
  document.getElementById('stat-total-credits').textContent = 
    metrics.totalCredits.toFixed(1);
  document.getElementById('stat-course-count').textContent = 
    `${metrics.validCoursesCount} graded / ${state.courses.length} total`;

  const years = ['freshman', 'sophomore', 'junior', 'senior'];
  years.forEach(yr => {
    const capitalized = yr.charAt(0).toUpperCase() + yr.slice(1);
    const data = metrics.yearResults[capitalized];
    const gpaEl = document.getElementById(`stat-${yr}-gpa`);
    const credEl = document.getElementById(`stat-${yr}-credits`);

    if (data && data.gpa !== null) {
      gpaEl.textContent = data.gpa.toFixed(3);
      credEl.textContent = `${data.credits.toFixed(1)} cr`;
    } else {
      gpaEl.textContent = '—';
      credEl.textContent = `${data ? data.credits.toFixed(1) : 0} cr`;
    }
  });

  // Update tab counts
  document.getElementById('count-all').textContent = state.courses.length;
  ['Freshman', 'Sophomore', 'Junior', 'Senior'].forEach(yr => {
    const count = state.courses.filter(c => c.year === yr).length;
    document.getElementById(`count-${yr.toLowerCase()}`).textContent = count;
  });
}

function renderTable() {
  const tbody = document.getElementById('spreadsheet-body');
  const emptyState = document.getElementById('empty-state');
  tbody.innerHTML = '';

  const filteredCourses = state.activeFilter === 'all'
    ? state.courses
    : state.courses.filter(c => c.year === state.activeFilter);

  if (filteredCourses.length === 0) {
    emptyState.style.display = 'block';
  } else {
    emptyState.style.display = 'none';
  }

  filteredCourses.forEach((course, index) => {
    const tr = document.createElement('tr');
    tr.dataset.id = course.id;

    // Calculate row points
    const pointsPerCredit = calculateGpaPoints(course.grade, course.scale);
    const credits = parseFloat(course.credits) || 0;
    const totalEarnedPoints = (pointsPerCredit !== null && credits > 0)
      ? (pointsPerCredit * credits).toFixed(2)
      : '—';

    const tier = getTierForGrade(course.grade);
    const badgeText = tier ? `${tier.grade} (${(pointsPerCredit || 0).toFixed(2)})` : '';

    const courseCreditsNum = Number(course.credits);
    const standardCredits = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0];
    let customOptionHtml = '';
    if (!standardCredits.includes(courseCreditsNum) && !isNaN(courseCreditsNum) && courseCreditsNum > 0) {
      customOptionHtml = `<option value="${courseCreditsNum}" selected>${courseCreditsNum} Credits</option>`;
    }

    tr.innerHTML = `
      <td class="col-num">${index + 1}</td>
      <td>
        <input type="text" class="cell-input field-name" placeholder="Class" value="${escapeHtml(course.name)}">
      </td>
      <td>
        <select class="cell-select field-scale">
          <option value="regular" ${course.scale === 'regular' ? 'selected' : ''}>Regular (4.33)</option>
          <option value="honors" ${course.scale === 'honors' ? 'selected' : ''}>Honors (4.83)</option>
          <option value="ap_ccp" ${course.scale === 'ap_ccp' ? 'selected' : ''}>AP / CCP (5.33)</option>
        </select>
      </td>
      <td>
        <select class="cell-select field-credits">
          <option value="1.0" ${courseCreditsNum === 1.0 ? 'selected' : ''}>1.0 Credit</option>
          <option value="0.5" ${courseCreditsNum === 0.5 ? 'selected' : ''}>0.5 Credit</option>
          <option value="0.25" ${courseCreditsNum === 0.25 ? 'selected' : ''}>0.25 Credit</option>
          <option value="0.75" ${courseCreditsNum === 0.75 ? 'selected' : ''}>0.75 Credit</option>
          <option value="1.5" ${courseCreditsNum === 1.5 ? 'selected' : ''}>1.5 Credits</option>
          <option value="2.0" ${courseCreditsNum === 2.0 ? 'selected' : ''}>2.0 Credits</option>
          ${customOptionHtml}
        </select>
      </td>
      <td>
        <div class="grade-input-group">
          <input type="text" class="cell-input field-grade" placeholder="Grade" value="${escapeHtml(course.grade || '')}">
          ${badgeText ? `<span class="grade-badge-slot"><span class="tier-badge">${badgeText}</span></span>` : ''}
        </div>
      </td>
      <td>
        <select class="cell-select field-year">
          <option value="Freshman" ${course.year === 'Freshman' ? 'selected' : ''}>Freshman</option>
          <option value="Sophomore" ${course.year === 'Sophomore' ? 'selected' : ''}>Sophomore</option>
          <option value="Junior" ${course.year === 'Junior' ? 'selected' : ''}>Junior</option>
          <option value="Senior" ${course.year === 'Senior' ? 'selected' : ''}>Senior</option>
        </select>
      </td>
      <td class="col-computed">${totalEarnedPoints}</td>
      <td class="col-actions">
        <button class="btn-delete-row" title="Delete">✕</button>
      </td>
    `;

    tbody.appendChild(tr);
  });

  updateStatsUI();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ============================================================================
// Table Event Handlers & Inline Editing
// ============================================================================
function attachTableEvents() {
  const tbody = document.getElementById('spreadsheet-body');

  tbody.addEventListener('input', e => {
    const tr = e.target.closest('tr');
    if (!tr) return;
    const id = tr.dataset.id;
    const course = state.courses.find(c => c.id === id);
    if (!course) return;

    if (e.target.classList.contains('field-name')) {
      course.name = e.target.value;
      saveState();
    } else if (e.target.classList.contains('field-grade')) {
      course.grade = e.target.value;
      saveState();
      updateRowComputed(tr, course);
      updateStatsUI();
    }
  });

  tbody.addEventListener('change', e => {
    const tr = e.target.closest('tr');
    if (!tr) return;
    const id = tr.dataset.id;
    const course = state.courses.find(c => c.id === id);
    if (!course) return;

    if (e.target.classList.contains('field-scale')) {
      course.scale = e.target.value;
      saveState();
      updateRowComputed(tr, course);
      updateStatsUI();
    } else if (e.target.classList.contains('field-credits')) {
      course.credits = parseFloat(e.target.value) || 1.0;
      saveState();
      updateRowComputed(tr, course);
      updateStatsUI();
    } else if (e.target.classList.contains('field-year')) {
      course.year = e.target.value;
      saveState();
      if (state.activeFilter !== 'all' && course.year !== state.activeFilter) {
        renderTable();
      } else {
        updateStatsUI();
      }
    }
  });

  tbody.addEventListener('click', e => {
    if (e.target.classList.contains('btn-delete-row')) {
      const tr = e.target.closest('tr');
      if (!tr) return;
      const id = tr.dataset.id;
      state.courses = state.courses.filter(c => c.id !== id);
      saveState();
      renderTable();
    }
  });

  // Keyboard navigation
  tbody.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const tr = e.target.closest('tr');
      if (tr && tr.nextElementSibling) {
        const nextInput = tr.nextElementSibling.querySelector(`.${e.target.classList[1]}`) || tr.nextElementSibling.querySelector('input');
        if (nextInput) nextInput.focus();
      } else {
        addNewRow();
      }
    }
  });
}

function updateRowComputed(tr, course) {
  const pointsPerCredit = calculateGpaPoints(course.grade, course.scale);
  const credits = parseFloat(course.credits) || 0;
  const totalEarnedPoints = (pointsPerCredit !== null && credits > 0)
    ? (pointsPerCredit * credits).toFixed(2)
    : '—';

  const computedCell = tr.querySelector('.col-computed');
  if (computedCell) {
    computedCell.textContent = totalEarnedPoints;
  }

  // Update badge
  const group = tr.querySelector('.grade-input-group');
  if (group) {
    const oldBadge = group.querySelector('.grade-badge-slot');
    if (oldBadge) oldBadge.remove();

    const tier = getTierForGrade(course.grade);
    if (tier) {
      const badgeText = `${tier.grade} (${(pointsPerCredit || 0).toFixed(2)})`;
      const span = document.createElement('span');
      span.className = 'grade-badge-slot';
      span.innerHTML = `<span class="tier-badge">${badgeText}</span>`;
      group.appendChild(span);
    }
  }
}

// ============================================================================
// Actions (Add Row, Add 5, Filter, CSV Export/Import, Target Calculator)
// ============================================================================
function addNewRow(year = null) {
  const defaultYear = year || (state.activeFilter !== 'all' ? state.activeFilter : 'Freshman');
  const newCourse = {
    id: uid(),
    name: '',
    scale: 'regular',
    credits: 1.0,
    grade: '',
    year: defaultYear
  };
  state.courses.push(newCourse);
  saveState();
  renderTable();

  setTimeout(() => {
    const rows = document.querySelectorAll('#spreadsheet-body tr');
    if (rows.length > 0) {
      const lastRow = rows[rows.length - 1];
      const nameInput = lastRow.querySelector('.field-name');
      if (nameInput) nameInput.focus();
    }
  }, 30);
}

function addFiveRows() {
  const defaultYear = state.activeFilter !== 'all' ? state.activeFilter : 'Freshman';
  for (let i = 0; i < 5; i++) {
    state.courses.push({
      id: uid(),
      name: '',
      scale: 'regular',
      credits: 1.0,
      grade: '',
      year: defaultYear
    });
  }
  saveState();
  renderTable();
}

function setupToolbarAndTabs() {
  document.getElementById('btn-add-row').addEventListener('click', () => addNewRow());
  document.getElementById('btn-add-5-rows').addEventListener('click', addFiveRows);
  document.getElementById('btn-empty-add').addEventListener('click', () => addNewRow());

  document.getElementById('btn-load-sample').addEventListener('click', () => {
    if (hasMeaningfulUserData() && !confirm('Load sample data? This will replace your current list.')) {
      return;
    }
    state.courses = JSON.parse(JSON.stringify(SAMPLE_COURSES));
    saveState();
    renderTable();
  });

  document.getElementById('btn-clear-all').addEventListener('click', () => {
    if (!hasMeaningfulUserData() || confirm('Are you sure you want to clear all classes?')) {
      state.courses = [];
      saveState();
      renderTable();
    }
  });

  // Year filter tabs
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeFilter = btn.dataset.filter;
      renderTable();
    });
  });
}



// ============================================================================
// Scale Reference Table Render
// ============================================================================
function renderScaleReferenceTable() {
  const tbody = document.getElementById('scale-table-body');
  if (!tbody) return;

  tbody.innerHTML = '';
  GRADE_TIERS.forEach(tier => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${tier.grade}</strong></td>
      <td>${tier.min} - ${tier.max}%</td>
      <td>${tier.regular.toFixed(2)}</td>
      <td>${tier.honors.toFixed(2)}</td>
      <td>${tier.ap_ccp.toFixed(2)}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ============================================================================
// Multi-Format Intelligent CSV Export & Import
// ============================================================================
function setupCsvHandling() {
  const exportBtn = document.getElementById('btn-export-csv');
  const importInput = document.getElementById('csv-file-input');
  const pasteBtn = document.getElementById('btn-paste-data');
  const pasteModal = document.getElementById('paste-modal');
  const closePasteBtn = document.getElementById('btn-close-paste-modal');
  const cancelPasteBtn = document.getElementById('btn-cancel-paste');
  const submitPasteBtn = document.getElementById('btn-submit-paste');
  const pasteTextarea = document.getElementById('paste-textarea');

  // Export CSV
  exportBtn.addEventListener('click', () => {
    if (state.courses.length === 0) {
      alert('No courses to export.');
      return;
    }

    const headers = ['Class Name', 'Credits', 'Scale', 'Grade', 'Year'];
    const rows = state.courses.map(c => {
      const scaleDisplay = c.scale === 'ap_ccp' ? '5.33' : (c.scale === 'honors' ? '4.83' : '4.33');
      return [
        `"${(c.name || '').replace(/"/g, '""')}"`,
        c.credits,
        scaleDisplay,
        `"${(c.grade || '').replace(/"/g, '""')}"`,
        `"${c.year}"`
      ];
    });

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GPA_Planner_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  // Import CSV via file upload
  importInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = event => {
      try {
        const text = event.target.result;
        const parsedCourses = parseMultiFormatCsv(text);

        if (parsedCourses.length > 0) {
          state.courses = parsedCourses;
          saveState();
          renderTable();
          alert(`Successfully imported ${parsedCourses.length} classes!`);
        } else {
          alert('Could not parse valid course rows from CSV. Please check the file formatting.');
        }
      } catch (err) {
        console.error(err);
        alert('Error reading CSV file.');
      }
      importInput.value = '';
    };
    reader.readAsText(file);
  });

  // Paste Data modal
  if (pasteBtn && pasteModal) {
    pasteBtn.addEventListener('click', () => {
      pasteModal.style.display = 'flex';
      pasteTextarea.focus();
    });

    const closeModal = () => {
      pasteModal.style.display = 'none';
      pasteTextarea.value = '';
    };

    closePasteBtn.addEventListener('click', closeModal);
    cancelPasteBtn.addEventListener('click', closeModal);

    submitPasteBtn.addEventListener('click', () => {
      const text = pasteTextarea.value.trim();
      if (!text) {
        alert('Please paste some CSV or Google Sheets data first.');
        return;
      }

      const parsedCourses = parseMultiFormatCsv(text);
      if (parsedCourses.length > 0) {
        state.courses = parsedCourses;
        saveState();
        renderTable();
        closeModal();
        alert(`Successfully imported ${parsedCourses.length} classes!`);
      } else {
        alert('Could not parse valid courses from the pasted text.');
      }
    });
  }
}

/**
 * Parses both Google Sheets exports and standard GPA app exports:
 * Format 1: [Class Name, Credits (0.5/1), Scale (5.33/4.83/4.33), Grade (95%), Year (Junior)] with cascading year!
 * Format 2: [Class Name, Scale (ap_ccp/honors/regular), Credits (1.0), Grade, Year]
 */
export function parseMultiFormatCsv(csvText) {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length === 0) return [];

  const rawRows = lines.map(line => parseCsvLine(line));
  if (rawRows.length === 0) return [];

  // Detect whether row 0 is a header
  let startIndex = 0;
  const firstRowStr = rawRows[0].join(' ').toLowerCase();
  const isHeader = firstRowStr.includes('class') || 
                   firstRowStr.includes('course') || 
                   firstRowStr.includes('credit') || 
                   firstRowStr.includes('scale') || 
                   firstRowStr.includes('grade');

  if (isHeader) {
    startIndex = 1;
  }

  const newCourses = [];
  let currentYear = 'Freshman';

  // First pass: detect years present in the sheet
  // If top rows have no year, look ahead to see the first year specified or default to Freshman
  for (let i = startIndex; i < rawRows.length; i++) {
    const cols = rawRows[i];
    if (cols.length >= 4) {
      const yearCol = findYearInRow(cols);
      if (yearCol) {
        currentYear = normalizeYear(yearCol);
        break;
      }
    }
  }

  for (let i = startIndex; i < rawRows.length; i++) {
    const cols = rawRows[i];
    if (cols.length < 3) continue;

    const className = (cols[0] || '').trim();
    if (!className) continue; // skip blank rows

    let credits = 1.0;
    let scale = 'regular';
    let grade = '';
    let year = '';

    // Check if column 1 or 2 is credit / scale
    const col1 = (cols[1] || '').trim();
    const col2 = (cols[2] || '').trim();
    const col3 = (cols[3] || '').trim();
    const col4 = (cols[4] || '').trim();

    // Check if col1 looks like credits (e.g. 0.5, 1, 1.0, 2)
    const isCol1NumericCredit = isCreditValue(col1);
    const isCol2NumericCredit = isCreditValue(col2);

    if (isCol1NumericCredit && !isCol2NumericCredit) {
      // Format: Name, Credits, Scale, Grade, Year (Google Sheets format)
      credits = parseFloat(col1) || 1.0;
      scale = normalizeScale(col2);
      grade = col3;
      year = col4;
    } else if (isCol2NumericCredit) {
      // Format: Name, Scale, Credits, Grade, Year (Standard App format)
      scale = normalizeScale(col1);
      credits = parseFloat(col2) || 1.0;
      grade = col3;
      year = col4;
    } else {
      // Fallback heuristics
      credits = parseFloat(col1) || parseFloat(col2) || 1.0;
      scale = normalizeScale(col2 || col1);
      grade = col3 || '';
      year = col4 || '';
    }

    // Cascading year support
    if (year && year.trim().length > 0) {
      currentYear = normalizeYear(year);
    }

    newCourses.push({
      id: uid(),
      name: className,
      scale: scale,
      credits: credits,
      grade: grade,
      year: currentYear
    });
  }

  return newCourses;
}

function isCreditValue(val) {
  if (!val) return false;
  const clean = val.replace(/"/g, '').trim();
  const num = parseFloat(clean);
  return !isNaN(num) && (num === 0.25 || num === 0.5 || num === 0.75 || num === 1 || num === 1.0 || num === 1.5 || num === 2 || num === 2.0);
}

function normalizeScale(val) {
  if (!val) return 'regular';
  const str = String(val).toLowerCase().trim();
  if (str.includes('5.33') || str.includes('5.3') || str.includes('ap') || str.includes('ccp')) {
    return 'ap_ccp';
  }
  if (str.includes('4.83') || str.includes('4.8') || str.includes('honor')) {
    return 'honors';
  }
  return 'regular';
}

function normalizeYear(val) {
  if (!val) return 'Freshman';
  const str = String(val).toLowerCase().trim();
  if (str.includes('soph')) return 'Sophomore';
  if (str.includes('jun') || str.includes('11')) return 'Junior';
  if (str.includes('sen') || str.includes('12')) return 'Senior';
  if (str.includes('fresh') || str.includes('9')) return 'Freshman';
  return 'Freshman';
}

function findYearInRow(cols) {
  for (let c of cols) {
    const s = String(c).toLowerCase().trim();
    if (s.includes('freshman') || s.includes('sophomore') || s.includes('junior') || s.includes('senior')) {
      return c;
    }
  }
  return null;
}

// Simple robust CSV line parser
function parseCsvLine(text) {
  const isTabDelimited = text.includes('\t') && (!text.includes(',') || text.split('\t').length > text.split(',').length);
  const delimiter = isTabDelimited ? '\t' : ',';

  const result = [];
  let curr = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' && (i === 0 || text[i - 1] !== '\\')) {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      result.push(curr.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));
      curr = '';
    } else {
      curr += char;
    }
  }
  result.push(curr.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));
  return result;
}

// ============================================================================
// Initialization
// ============================================================================
function init() {
  loadState();
  renderScaleReferenceTable();
  setupToolbarAndTabs();
  attachTableEvents();
  setupCsvHandling();
  renderTable();
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', init);
}
