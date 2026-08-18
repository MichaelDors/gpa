import { GRADE_TIERS, SCALE_DEFINITIONS, getTierForGrade, calculateGpaPoints, calculateUnweightedPoints, getConvexUrl } from './config.js';
import { ConvexService } from './convex-client.js';
import { renderBlobatar, registerAvatar, setAvatarMood, refreshAllAvatars } from './avatar.js';

// ============================================================================
// State Management & Storage Keys
// ============================================================================
const STORAGE_KEY_COURSES = 'gpafinder_courses_v1';
const STORAGE_KEY_SNAPSHOTS = 'gpafinder_snapshots_v2';
const STORAGE_KEY_VERSIONS = 'gpafinder_versions_v2';
const STORAGE_KEY_ACTIVE_SNAP = 'gpafinder_active_snapshot_id_v2';
const STORAGE_KEY_DIRTY = 'gpafinder_unsaved_dirty_v2';

let state = {
  activeSnapshotId: null,
  courses: [],
  activeFilter: 'all', // 'all' | 'Freshman' | 'Sophomore' | 'Junior' | 'Senior'
  hasUnsavedChanges: false,
};

let snapshots = [];
let versions = {}; // Map: { [snapshotId]: [ { id, versionNumber, name, note, courses, metrics, createdAt } ] }

// Undo / Redo History State
const MAX_HISTORY = 50;
let undoStack = [];
let redoStack = [];
let isApplyingHistory = false;
let cellEditingInitialState = null;

// Modal tracking state
let historyModalTargetSnapshotId = null;
let renameTargetSnapshotId = null;

// Generate unique ID
function uid(prefix = 'c_') {
  return prefix + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

function createDefaultStarterRows() {
  return [
    { id: uid(), name: '', scale: 'regular', credits: 1.0, grade: '', year: 'Freshman' },
    { id: uid(), name: '', scale: 'honors', credits: 1.0, grade: '', year: 'Freshman' },
    { id: uid(), name: '', scale: 'ap_ccp', credits: 1.0, grade: '', year: 'Freshman' }
  ];
}

// Sample courses for quick demo if empty
const SAMPLE_COURSES = [
  { id: uid(), name: 'Honors English 9', scale: 'honors', credits: 1.0, grade: '94', year: 'Freshman' },
  { id: uid(), name: 'Honors Algebra 2', scale: 'honors', credits: 1.0, grade: '96', year: 'Freshman' },
  { id: uid(), name: 'Honors Biology', scale: 'honors', credits: 1.0, grade: '91', year: 'Freshman' },
  { id: uid(), name: 'World History', scale: 'regular', credits: 1.0, grade: '98', year: 'Freshman' },
  { id: uid(), name: 'Spanish 1', scale: 'regular', credits: 1.0, grade: '95', year: 'Freshman' },
  { id: uid(), name: 'Health', scale: 'regular', credits: 0.5, grade: '99', year: 'Freshman' },
  { id: uid(), name: 'Physical Education 1', scale: 'regular', credits: 0.5, grade: '100', year: 'Freshman' },
  { id: uid(), name: 'Honors English 10', scale: 'honors', credits: 1.0, grade: '93', year: 'Sophomore' },
  { id: uid(), name: 'Honors Pre-Calculus', scale: 'honors', credits: 1.0, grade: '89', year: 'Sophomore' },
  { id: uid(), name: 'Honors Chemistry', scale: 'honors', credits: 1.0, grade: '90', year: 'Sophomore' },
  { id: uid(), name: 'AP European History', scale: 'ap_ccp', credits: 1.0, grade: '92', year: 'Sophomore' },
  { id: uid(), name: 'Spanish 2', scale: 'regular', credits: 1.0, grade: '94', year: 'Sophomore' },
  { id: uid(), name: 'Financial Literacy', scale: 'regular', credits: 0.5, grade: '98', year: 'Sophomore' },
  { id: uid(), name: 'Physical Education 2', scale: 'regular', credits: 0.5, grade: '100', year: 'Sophomore' },
  { id: uid(), name: 'AP Language & Comp', scale: 'ap_ccp', credits: 1.0, grade: '91', year: 'Junior' },
  { id: uid(), name: 'AP Calculus BC', scale: 'ap_ccp', credits: 1.0, grade: '95', year: 'Junior' },
  { id: uid(), name: 'AP Physics C', scale: 'ap_ccp', credits: 1.0, grade: '88', year: 'Junior' },
  { id: uid(), name: 'AP US History', scale: 'ap_ccp', credits: 1.0, grade: '94', year: 'Junior' },
  { id: uid(), name: 'Honors Spanish 3', scale: 'honors', credits: 1.0, grade: '93', year: 'Junior' },
  { id: uid(), name: 'Computer Science Principles', scale: 'regular', credits: 1.0, grade: '97', year: 'Junior' }
];

// ============================================================================
// Local Storage & Snapshot Document State
// ============================================================================
function loadLocalData() {
  try {
    // 1. Load snapshots list
    const rawSnapshots = localStorage.getItem(STORAGE_KEY_SNAPSHOTS);
    if (rawSnapshots) {
      snapshots = JSON.parse(rawSnapshots);
    }

    // 2. Load version histories map
    const rawVersions = localStorage.getItem(STORAGE_KEY_VERSIONS);
    if (rawVersions) {
      versions = JSON.parse(rawVersions);
    }

    // 3. Backward compatibility with v1 storage
    if (!snapshots || snapshots.length === 0) {
      const v1SnapshotsRaw = localStorage.getItem('gpafinder_snapshots_v1');
      const v1CoursesRaw = localStorage.getItem('gpafinder_courses_v1');

      if (v1SnapshotsRaw) {
        const v1Snaps = JSON.parse(v1SnapshotsRaw);
        if (Array.isArray(v1Snaps) && v1Snaps.length > 0) {
          snapshots = v1Snaps.map(s => ({
            id: s.id || uid('snap_'),
            name: s.name || 'Snapshot',
            courses: s.courses || [],
            metrics: s.metrics || calculateMetrics(s.courses || []),
            createdAt: s.createdAt ? new Date(s.createdAt).getTime() : Date.now(),
            updatedAt: s.createdAt ? new Date(s.createdAt).getTime() : Date.now(),
          }));
        }
      }

      if (snapshots.length === 0) {
        let initialCourses = createDefaultStarterRows();
        if (v1CoursesRaw) {
          try {
            const parsed = JSON.parse(v1CoursesRaw);
            if (Array.isArray(parsed) && parsed.length > 0) {
              initialCourses = parsed;
            }
          } catch (_) { }
        }

        const initialSnapId = uid('snap_');
        const now = Date.now();
        const initialSnap = {
          id: initialSnapId,
          name: 'Main Schedule',
          courses: initialCourses,
          metrics: calculateMetrics(initialCourses),
          createdAt: now,
          updatedAt: now,
        };
        snapshots = [initialSnap];

        // Create initial revision v1
        versions[initialSnapId] = [
          {
            id: uid('ver_'),
            versionNumber: 1,
            name: 'Main Schedule',
            note: 'Initial file creation',
            courses: JSON.parse(JSON.stringify(initialCourses)),
            metrics: calculateMetrics(initialCourses),
            createdAt: now,
          }
        ];
      }
    }

    // Ensure all snapshots have a versions entry
    snapshots.forEach(s => {
      if (!versions[s.id] || versions[s.id].length === 0) {
        versions[s.id] = [
          {
            id: uid('ver_'),
            versionNumber: 1,
            name: s.name,
            note: 'Initial snapshot state',
            courses: JSON.parse(JSON.stringify(s.courses || [])),
            metrics: s.metrics || calculateMetrics(s.courses || []),
            createdAt: s.createdAt || Date.now(),
          }
        ];
      }
    });

    // 4. Load or set active snapshot
    const savedActiveId = localStorage.getItem(STORAGE_KEY_ACTIVE_SNAP);
    const activeSnap = snapshots.find(s => s.id === savedActiveId) || snapshots[0];
    state.activeSnapshotId = activeSnap.id;

    // Load working courses and dirty state for local persistence
    const savedCoursesRaw = localStorage.getItem(STORAGE_KEY_COURSES);
    const savedDirtyRaw = localStorage.getItem(STORAGE_KEY_DIRTY);
    if (savedCoursesRaw) {
      try {
        const parsed = JSON.parse(savedCoursesRaw);
        if (Array.isArray(parsed)) {
          state.courses = parsed;
        } else {
          state.courses = JSON.parse(JSON.stringify(activeSnap.courses || []));
        }
      } catch (_) {
        state.courses = JSON.parse(JSON.stringify(activeSnap.courses || []));
      }
    } else {
      state.courses = JSON.parse(JSON.stringify(activeSnap.courses || []));
    }
    state.hasUnsavedChanges = savedDirtyRaw === 'true';

    saveLocalData();
  } catch (e) {
    console.error('Error loading local data', e);
    initFallbackStarterState();
  }
}

function initFallbackStarterState() {
  const newSnapId = uid('snap_');
  const now = Date.now();
  const starterCourses = createDefaultStarterRows();
  snapshots = [
    {
      id: newSnapId,
      name: 'Main Schedule',
      courses: starterCourses,
      metrics: calculateMetrics(starterCourses),
      createdAt: now,
      updatedAt: now,
    }
  ];
  versions = {
    [newSnapId]: [
      {
        id: uid('ver_'),
        versionNumber: 1,
        name: 'Main Schedule',
        note: 'Initial file creation',
        courses: JSON.parse(JSON.stringify(starterCourses)),
        metrics: calculateMetrics(starterCourses),
        createdAt: now,
      }
    ]
  };
  state.activeSnapshotId = newSnapId;
  state.courses = JSON.parse(JSON.stringify(starterCourses));
  state.hasUnsavedChanges = false;
  saveLocalData();
}

function saveLocalData() {
  try {
    localStorage.setItem(STORAGE_KEY_SNAPSHOTS, JSON.stringify(snapshots));
    localStorage.setItem(STORAGE_KEY_VERSIONS, JSON.stringify(versions));
    if (state.activeSnapshotId) {
      localStorage.setItem(STORAGE_KEY_ACTIVE_SNAP, state.activeSnapshotId);
    }
    // Update active snapshot courses in snapshots array for local persistence
    const activeSnap = snapshots.find(s => s.id === state.activeSnapshotId);
    if (activeSnap) {
      activeSnap.courses = JSON.parse(JSON.stringify(state.courses));
      activeSnap.metrics = calculateMetrics(state.courses);
    }
    localStorage.setItem(STORAGE_KEY_COURSES, JSON.stringify(state.courses));
    localStorage.setItem(STORAGE_KEY_DIRTY, state.hasUnsavedChanges ? 'true' : 'false');
  } catch (e) {
    console.error('Failed to save to localStorage', e);
  }
  updateSnapshotBadge();
  updateActiveSnapshotHeaderUI();
  updateSaveButtonUI();
}

// ============================================================================
// Save Engine & Version History Creation
// ============================================================================
export function markUnsavedChanges(dirty = true) {
  state.hasUnsavedChanges = dirty;
  updateSaveButtonUI();
  updateActiveSnapshotHeaderUI();
}

export function saveActiveSnapshot(isManualVersion = true, versionNote = '') {
  const activeSnap = snapshots.find(s => s.id === state.activeSnapshotId);
  if (!activeSnap) return;

  const now = Date.now();
  const currentMetrics = calculateMetrics(state.courses);

  activeSnap.courses = JSON.parse(JSON.stringify(state.courses));
  activeSnap.metrics = currentMetrics;
  activeSnap.updatedAt = now;

  if (!versions[activeSnap.id]) {
    versions[activeSnap.id] = [];
  }

  // Create a new version entry
  const existingVersions = versions[activeSnap.id];
  const nextVersionNum = existingVersions.length + 1;
  const note = versionNote || (isManualVersion ? `Saved revision v${nextVersionNum}` : 'Auto save');

  const newVersion = {
    id: uid('ver_'),
    versionNumber: nextVersionNum,
    name: activeSnap.name,
    note: note,
    courses: JSON.parse(JSON.stringify(state.courses)),
    metrics: currentMetrics,
    createdAt: now,
  };

  versions[activeSnap.id].unshift(newVersion);
  state.hasUnsavedChanges = false;
  saveLocalData();
  updateSaveButtonUI(true);

  showToast(`Saved "${activeSnap.name}" (v${nextVersionNum})`);

  // Cloud sync if authenticated
  if (ConvexService.isAuthenticated() && ConvexService.isConfigured()) {
    ConvexService.saveSnapshot({
      id: activeSnap.id,
      name: activeSnap.name,
      courses: activeSnap.courses,
      metrics: activeSnap.metrics,
      createVersion: true,
      versionNote: note,
      updatedAt: now,
    }).catch(err => {
      console.warn('Background Convex save error', err);
    });
  }

  return newVersion;
}

function updateSaveButtonUI(justSaved = false) {
  const btnSave = document.getElementById('btn-save');
  const label = document.getElementById('save-btn-text');
  if (!btnSave || !label) return;

  if (justSaved) {
    btnSave.classList.remove('has-unsaved');
    btnSave.classList.add('saved-pulse');
    label.innerHTML = '<i class="fa-solid fa-check"></i> Saved';
    setTimeout(() => {
      btnSave.classList.remove('saved-pulse');
      label.textContent = 'Save';
    }, 1500);
    return;
  }

  if (state.hasUnsavedChanges) {
    btnSave.classList.add('has-unsaved');
    label.textContent = 'Save *';
    btnSave.title = 'You have unsaved changes (Ctrl+S / Cmd+S)';
  } else {
    btnSave.classList.remove('has-unsaved');
    label.textContent = 'Save';
    btnSave.title = 'Save snapshot (Ctrl+S / Cmd+S)';
  }
}

function updateActiveSnapshotHeaderUI() {
  const label = document.getElementById('active-snapshot-label');
  const dirtyDot = document.getElementById('active-snap-dirty-dot');
  const activeSnap = snapshots.find(s => s.id === state.activeSnapshotId);

  if (label && activeSnap) {
    label.textContent = activeSnap.name;
  }
  if (dirtyDot) {
    dirtyDot.style.display = state.hasUnsavedChanges ? 'inline-block' : 'none';
  }
}

// ============================================================================
// Snapshot Document Management (Switch, Create, Rename, Delete)
// ============================================================================
export function switchSnapshot(targetSnapshotId) {
  if (targetSnapshotId === state.activeSnapshotId) return;

  const target = snapshots.find(s => s.id === targetSnapshotId);
  if (!target) return;

  if (state.hasUnsavedChanges) {
    saveActiveSnapshot(false, 'Auto-saved before switching files');
  }

  pushHistory();
  state.activeSnapshotId = target.id;
  state.courses = JSON.parse(JSON.stringify(target.courses || []));
  state.hasUnsavedChanges = false;
  saveLocalData();
  renderTable();
  renderSnapshotList();
  resetGpaReactionBaseline();
  showToast(`Switched to "${target.name}"`);
}

export function createNewSnapshot(customName = '', cloneCurrent = false) {
  const name = (customName && customName.trim().length > 0)
    ? customName.trim()
    : `Snapshot ${snapshots.length + 1}`;

  const newCourses = cloneCurrent
    ? JSON.parse(JSON.stringify(state.courses))
    : createDefaultStarterRows();

  const newId = uid('snap_');
  const now = Date.now();
  const metrics = calculateMetrics(newCourses);

  const newSnapshot = {
    id: newId,
    name: name,
    courses: newCourses,
    metrics: metrics,
    createdAt: now,
    updatedAt: now,
  };

  snapshots.unshift(newSnapshot);
  versions[newId] = [
    {
      id: uid('ver_'),
      versionNumber: 1,
      name: name,
      note: cloneCurrent ? 'Cloned from active snapshot' : 'New file created',
      courses: JSON.parse(JSON.stringify(newCourses)),
      metrics: metrics,
      createdAt: now,
    }
  ];

  switchSnapshot(newId);
  renderSnapshotList();
  showToast(`Created snapshot "${name}"`);

  if (ConvexService.isAuthenticated() && ConvexService.isConfigured()) {
    ConvexService.saveSnapshot({
      id: newId,
      name: name,
      courses: newCourses,
      metrics: metrics,
      createVersion: true,
      versionNote: 'New file created',
      updatedAt: now,
    }).catch(console.warn);
  }

  return newSnapshot;
}

export function renameSnapshot(snapshotId, newName) {
  const snap = snapshots.find(s => s.id === snapshotId);
  if (!snap || !newName || !newName.trim()) return;

  const cleanName = newName.trim();
  snap.name = cleanName;
  snap.updatedAt = Date.now();
  saveLocalData();
  renderSnapshotList();
  updateActiveSnapshotHeaderUI();
  showToast(`Renamed to "${cleanName}"`);

  if (ConvexService.isAuthenticated() && ConvexService.isConfigured()) {
    ConvexService.saveSnapshot({
      id: snap.id,
      name: cleanName,
      courses: snap.courses,
      metrics: snap.metrics,
      createVersion: false,
      updatedAt: snap.updatedAt,
    }).catch(console.warn);
  }
}

export function deleteSnapshot(snapshotId) {
  if (snapshots.length <= 1) {
    alert('You must have at least one snapshot file.');
    return;
  }

  const target = snapshots.find(s => s.id === snapshotId);
  const name = target ? target.name : 'Snapshot';

  if (!confirm(`Are you sure you want to delete "${name}" and all its version history?`)) {
    return;
  }

  snapshots = snapshots.filter(s => s.id !== snapshotId);
  delete versions[snapshotId];

  if (state.activeSnapshotId === snapshotId) {
    state.activeSnapshotId = snapshots[0].id;
    state.courses = JSON.parse(JSON.stringify(snapshots[0].courses || []));
    state.hasUnsavedChanges = false;
    renderTable();
  }

  saveLocalData();
  renderSnapshotList();
  showToast(`Deleted "${name}"`);

  if (ConvexService.isAuthenticated() && ConvexService.isConfigured()) {
    ConvexService.deleteSnapshot(snapshotId).catch(console.warn);
  }
}

function updateSnapshotBadge() {
  const badge = document.getElementById('snapshot-count-badge');
  if (badge) {
    badge.textContent = snapshots.length;
  }
}

// ============================================================================
// Version History Modal & Operations
// ============================================================================
export function openVersionHistoryModal(snapshotId = null) {
  const targetId = snapshotId || state.activeSnapshotId;
  const snap = snapshots.find(s => s.id === targetId);
  if (!snap) return;

  historyModalTargetSnapshotId = targetId;

  const modal = document.getElementById('version-history-modal');
  const title = document.getElementById('version-modal-title');
  const subtitle = document.getElementById('version-modal-subtitle');

  if (title) title.textContent = `Version History — ${snap.name}`;
  if (subtitle) subtitle.textContent = `Revisions recorded for "${snap.name}". Click any version to restore.`;

  renderVersionHistoryList(targetId);

  if (modal) {
    modal.style.display = 'flex';
  }
}

export function closeVersionHistoryModal() {
  const modal = document.getElementById('version-history-modal');
  if (modal) modal.style.display = 'none';
  historyModalTargetSnapshotId = null;
}

function renderVersionHistoryList(snapshotId) {
  const container = document.getElementById('version-history-list');
  const emptyState = document.getElementById('version-history-empty');
  if (!container) return;

  container.innerHTML = '';
  const snapVersions = (versions[snapshotId] || []).slice().sort((a, b) => (b.versionNumber || 0) - (a.versionNumber || 0));

  if (snapVersions.length === 0) {
    if (emptyState) emptyState.style.display = 'block';
    return;
  }
  if (emptyState) emptyState.style.display = 'none';

  const activeSnap = snapshots.find(s => s.id === snapshotId);
  const currentCoursesJson = JSON.stringify(activeSnap ? activeSnap.courses : []);

  snapVersions.forEach((v, index) => {
    const card = document.createElement('div');
    card.className = 'version-card';

    const isCurrent = JSON.stringify(v.courses) === currentCoursesJson && index === 0;
    if (isCurrent) {
      card.classList.add('is-current');
    }

    const dateStr = formatDateTime(v.createdAt);
    const weightedGpaStr = v.metrics && v.metrics.weightedGpa !== undefined ? v.metrics.weightedGpa.toFixed(3) : '—';
    const creditsStr = v.metrics && v.metrics.totalCredits !== undefined ? v.metrics.totalCredits.toFixed(1) : '0.0';
    const coursesCount = (v.courses || []).length;

    card.innerHTML = `
      <div class="version-card-main">
        <div class="version-header-line">
          <span class="version-pill ${isCurrent ? 'current' : ''}">v${v.versionNumber || (snapVersions.length - index)}</span>
          ${isCurrent ? '<span class="version-pill current">Current</span>' : ''}
          <span class="version-time">${dateStr}</span>
        </div>
        <div class="version-note">${escapeHtml(v.note || 'Saved revision')}</div>
        <div class="version-stats-row">
          <span class="version-chip highlight">Weighted: ${weightedGpaStr}</span>
          <span class="version-chip">${creditsStr} Credits</span>
          <span class="version-chip">${coursesCount} classes</span>
        </div>
      </div>
      <div class="version-actions">
        <button class="btn-small ${isCurrent ? '' : 'btn-primary'} btn-restore-ver" data-ver-id="${v.id}" ${isCurrent ? 'disabled' : ''}>
          ${isCurrent ? 'Active' : 'Restore'}
        </button>
      </div>
    `;

    container.appendChild(card);
  });
}

export function restoreVersion(snapshotId, versionId) {
  const snapVersions = versions[snapshotId];
  if (!snapVersions) return;

  const targetVer = snapVersions.find(v => v.id === versionId);
  if (!targetVer) return;

  if (confirm(`Restore revision v${targetVer.versionNumber} ("${targetVer.name}") from ${formatDateTime(targetVer.createdAt)}?`)) {
    pushHistory();
    const snap = snapshots.find(s => s.id === snapshotId);

    // If restoring on active snapshot: update active courses
    if (snapshotId === state.activeSnapshotId) {
      state.courses = JSON.parse(JSON.stringify(targetVer.courses || []));
      state.hasUnsavedChanges = false;
      if (snap) {
        snap.courses = JSON.parse(JSON.stringify(targetVer.courses || []));
        snap.metrics = calculateMetrics(state.courses);
        snap.updatedAt = Date.now();
      }
      renderTable();
      resetGpaReactionBaseline();
    } else {
      if (snap) {
        snap.courses = JSON.parse(JSON.stringify(targetVer.courses || []));
        snap.metrics = calculateMetrics(snap.courses);
        snap.updatedAt = Date.now();
      }
    }

    saveLocalData();
    closeVersionHistoryModal();
    showToast(`Restored version v${targetVer.versionNumber}`);

    if (ConvexService.isAuthenticated() && ConvexService.isConfigured() && snap) {
      ConvexService.saveSnapshot({
        id: snap.id,
        name: snap.name,
        courses: snap.courses,
        metrics: snap.metrics,
        createVersion: true,
        versionNote: `Restored to v${targetVer.versionNumber}`,
        updatedAt: snap.updatedAt,
      }).catch(console.warn);
    }
  }
}

// ============================================================================
// Undo / Redo History Engine
// ============================================================================
function pushHistory(explicitState = null) {
  if (isApplyingHistory) return;
  const coursesToRecord = explicitState ? JSON.parse(JSON.stringify(explicitState)) : JSON.parse(JSON.stringify(state.courses));

  if (undoStack.length > 0) {
    const last = undoStack[undoStack.length - 1];
    if (JSON.stringify(last) === JSON.stringify(coursesToRecord)) {
      return;
    }
  }

  undoStack.push(coursesToRecord);
  if (undoStack.length > MAX_HISTORY) {
    undoStack.shift();
  }
  redoStack = [];
  updateHistoryButtons();
}

function undo() {
  if (undoStack.length === 0) return;
  const previousCourses = undoStack.pop();
  redoStack.push(JSON.parse(JSON.stringify(state.courses)));
  if (redoStack.length > MAX_HISTORY) {
    redoStack.shift();
  }

  isApplyingHistory = true;
  state.courses = JSON.parse(JSON.stringify(previousCourses));
  markUnsavedChanges(true);
  saveLocalData();
  renderTable();
  isApplyingHistory = false;
  updateHistoryButtons();
  showToast('Undone');
}

function redo() {
  if (redoStack.length === 0) return;
  const nextCourses = redoStack.pop();
  undoStack.push(JSON.parse(JSON.stringify(state.courses)));
  if (undoStack.length > MAX_HISTORY) {
    undoStack.shift();
  }

  isApplyingHistory = true;
  state.courses = JSON.parse(JSON.stringify(nextCourses));
  markUnsavedChanges(true);
  saveLocalData();
  renderTable();
  isApplyingHistory = false;
  updateHistoryButtons();
  showToast('Redone');
}

function updateHistoryButtons() {
  const btnUndo = document.getElementById('btn-undo');
  const btnRedo = document.getElementById('btn-redo');
  if (btnUndo) btnUndo.disabled = undoStack.length === 0;
  if (btnRedo) btnRedo.disabled = redoStack.length === 0;
}

function setupKeyboardShortcuts() {
  window.addEventListener('keydown', e => {
    const isModifier = e.ctrlKey || e.metaKey;
    if (!isModifier) return;

    const key = e.key.toLowerCase();

    // Ctrl+S or Cmd+S -> Save Snapshot File
    if (key === 's') {
      e.preventDefault();
      saveActiveSnapshot(true);
      return;
    }

    // Ctrl+Z or Cmd+Z -> Undo / Redo
    if (key === 'z') {
      if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
        // Let natural input undo work if focused in modal input
        if (document.activeElement.id !== 'auth-username-input' && document.activeElement.id !== 'auth-password-input') {
          // Allow table input undo handling
        }
      }
      e.preventDefault();
      if (e.shiftKey) {
        redo();
      } else {
        undo();
      }
      return;
    }

    // Ctrl+Shift+Z or Ctrl+Y or Cmd+Y -> Redo
    if (key === 'y') {
      e.preventDefault();
      redo();
      return;
    }
  });

  const btnUndo = document.getElementById('btn-undo');
  const btnRedo = document.getElementById('btn-redo');
  const btnSave = document.getElementById('btn-save');

  if (btnUndo) btnUndo.addEventListener('click', undo);
  if (btnRedo) btnRedo.addEventListener('click', redo);
  if (btnSave) btnSave.addEventListener('click', () => saveActiveSnapshot(true));
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
    weightedQualityPoints,
    totalCoursesCount: coursesList.length,
  };
}

// ============================================================================
// Blobatar GPA Reaction Controller (1-second debounce, 3-second auto-return)
// ============================================================================
let lastSettledGpa = null;
let gpaReactionTimer = null;
let moodResetTimer = null;

function getCurrentUserName() {
  if (ConvexService && ConvexService.isAuthenticated()) {
    const user = ConvexService.getUser();
    if (user && user.username) return user.username;
  }
  return 'blobatar';
}

function resetGpaReactionBaseline(gpa = null) {
  if (gpaReactionTimer) {
    clearTimeout(gpaReactionTimer);
    gpaReactionTimer = null;
  }
  if (moodResetTimer) {
    clearTimeout(moodResetTimer);
    moodResetTimer = null;
  }
  const metrics = calculateMetrics();
  lastSettledGpa = gpa !== null ? gpa : (metrics.totalCredits > 0 ? metrics.cumulativeWeightedGpa : 0);
  setAvatarMood('idle');
}

function triggerGpaReaction(currentGpa) {
  if (lastSettledGpa === null) {
    lastSettledGpa = currentGpa;
    return;
  }

  // Clear pending evaluation timer while user is actively making changes
  if (gpaReactionTimer) {
    clearTimeout(gpaReactionTimer);
  }

  // 1-second debounce: evaluate only when user hasn't made changes for 1s
  gpaReactionTimer = setTimeout(() => {
    const diff = currentGpa - lastSettledGpa;
    const EPSILON = 0.0005;

    // Clear any previous auto-reset timer
    if (moodResetTimer) {
      clearTimeout(moodResetTimer);
      moodResetTimer = null;
    }

    if (diff > EPSILON) {
      setAvatarMood('happy');
      // Return to normal (idle) after 3s
      moodResetTimer = setTimeout(() => {
        setAvatarMood('idle');
      }, 3000);
    } else if (diff < -EPSILON) {
      setAvatarMood('sad');
      // Return to normal (idle) after 3s
      moodResetTimer = setTimeout(() => {
        setAvatarMood('idle');
      }, 3000);
    } else {
      setAvatarMood('idle');
    }

    lastSettledGpa = currentGpa;
  }, 1000);
}

// ============================================================================
// DOM Rendering & Table Updates
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

  // Trigger 2s debounced reaction on GPA change
  const currentWeightedGpa = metrics.totalCredits > 0 ? metrics.cumulativeWeightedGpa : 0;
  triggerGpaReaction(currentWeightedGpa);

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
  if (!tbody) return;

  tbody.innerHTML = '';

  const filteredCourses = state.activeFilter === 'all'
    ? state.courses
    : state.courses.filter(c => c.year === state.activeFilter);

  if (filteredCourses.length === 0) {
    if (emptyState) emptyState.style.display = 'block';
  } else {
    if (emptyState) emptyState.style.display = 'none';
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
        <button class="btn-delete-row" title="Delete"><i class="fa-solid fa-xmark"></i></button>
      </td>
    `;

    tbody.appendChild(tr);
  });

  updateStatsUI();
  updateHistoryButtons();
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

  // Update tier badge
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

function attachTableEvents() {
  const tbody = document.getElementById('spreadsheet-body');
  if (!tbody) return;

  tbody.addEventListener('focusin', e => {
    if (e.target.classList.contains('cell-input')) {
      cellEditingInitialState = JSON.parse(JSON.stringify(state.courses));
    }
  });

  tbody.addEventListener('input', e => {
    const tr = e.target.closest('tr');
    if (!tr) return;
    const id = tr.dataset.id;
    const course = state.courses.find(c => c.id === id);
    if (!course) return;

    if (cellEditingInitialState) {
      pushHistory(cellEditingInitialState);
      cellEditingInitialState = null;
    }

    if (e.target.classList.contains('field-name')) {
      course.name = e.target.value;
      markUnsavedChanges(true);
      saveLocalData();
    } else if (e.target.classList.contains('field-grade')) {
      course.grade = e.target.value;
      markUnsavedChanges(true);
      saveLocalData();
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
      pushHistory();
      course.scale = e.target.value;
      markUnsavedChanges(true);
      saveLocalData();
      updateRowComputed(tr, course);
      updateStatsUI();
    } else if (e.target.classList.contains('field-credits')) {
      pushHistory();
      course.credits = parseFloat(e.target.value) || 1.0;
      markUnsavedChanges(true);
      saveLocalData();
      updateRowComputed(tr, course);
      updateStatsUI();
    } else if (e.target.classList.contains('field-year')) {
      pushHistory();
      course.year = e.target.value;
      markUnsavedChanges(true);
      saveLocalData();
      if (state.activeFilter !== 'all' && course.year !== state.activeFilter) {
        renderTable();
      } else {
        updateStatsUI();
      }
    }
  });

  tbody.addEventListener('click', e => {
    const deleteBtn = e.target.closest('.btn-delete-row, .col-actions');
    if (deleteBtn) {
      const tr = deleteBtn.closest('tr');
      if (!tr) return;
      const id = tr.dataset.id;
      pushHistory();
      state.courses = state.courses.filter(c => c.id !== id);
      markUnsavedChanges(true);
      saveLocalData();
      renderTable();
    }
  });

  // Enter moves down or adds row
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

function addNewRow(year = null) {
  pushHistory();
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
  markUnsavedChanges(true);
  saveLocalData();
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

// ============================================================================
// Snapshots Dropdown UI Render
// ============================================================================
function renderSnapshotList() {
  const listContainer = document.getElementById('dropdown-snapshots-list');
  const emptyState = document.getElementById('dropdown-snapshots-empty');
  if (!listContainer) return;

  listContainer.innerHTML = '';
  if (snapshots.length === 0) {
    if (emptyState) emptyState.style.display = 'block';
    return;
  }
  if (emptyState) emptyState.style.display = 'none';

  snapshots.forEach(snapshot => {
    const item = document.createElement('div');
    const isActive = snapshot.id === state.activeSnapshotId;
    item.className = `dropdown-snapshot-item ${isActive ? 'active' : ''}`;
    item.dataset.id = snapshot.id;

    const formattedDate = formatDateTime(snapshot.updatedAt || snapshot.createdAt);
    const weightedGpaStr = snapshot.metrics && snapshot.metrics.weightedGpa !== undefined
      ? snapshot.metrics.weightedGpa.toFixed(3)
      : '—';
    const creditsStr = snapshot.metrics && snapshot.metrics.totalCredits !== undefined
      ? snapshot.metrics.totalCredits.toFixed(1)
      : '0.0';

    const snapVers = versions[snapshot.id] || [];
    const verCount = snapVers.length;

    item.innerHTML = `
      <div class="dropdown-snapshot-meta">
        <span class="dropdown-snapshot-name">
          ${isActive ? '<i class="fa-solid fa-check active-check"></i> ' : ''}${escapeHtml(snapshot.name)}
        </span>
        <span class="dropdown-snapshot-details">Weighted: ${weightedGpaStr} • ${creditsStr} cr • v${verCount} • ${formattedDate}</span>
      </div>
      <div class="dropdown-snapshot-actions">
        <button class="btn-snap-history" data-id="${snapshot.id}" title="Version history"><i class="fa-solid fa-clock-rotate-left"></i></button>
        <button class="btn-snap-rename" data-id="${snapshot.id}" title="Rename"><i class="fa-solid fa-pen-to-square"></i></button>
        <button class="btn-dropdown-delete" data-id="${snapshot.id}" title="Delete file"><i class="fa-solid fa-xmark"></i></button>
      </div>
    `;

    listContainer.appendChild(item);
  });
}

function setupSnapshotHandling() {
  const saveBtn = document.getElementById('btn-dropdown-save-snapshot');
  const nameInput = document.getElementById('dropdown-snapshot-input');
  const listContainer = document.getElementById('dropdown-snapshots-list');
  const snapshotsMenu = document.getElementById('snapshots-menu');
  const toggleBtn = document.getElementById('btn-snapshots-toggle');

  const btnActiveRename = document.getElementById('btn-active-rename');
  const btnActiveHistory = document.getElementById('btn-active-history');

  if (btnActiveRename) {
    btnActiveRename.addEventListener('click', e => {
      e.stopPropagation();
      openRenameModal(state.activeSnapshotId);
      if (snapshotsMenu) snapshotsMenu.classList.remove('show');
    });
  }

  if (btnActiveHistory) {
    btnActiveHistory.addEventListener('click', e => {
      e.stopPropagation();
      openVersionHistoryModal(state.activeSnapshotId);
      if (snapshotsMenu) snapshotsMenu.classList.remove('show');
    });
  }

  if (saveBtn && nameInput) {
    const handleCreate = () => {
      const name = nameInput.value.trim();
      createNewSnapshot(name, false);
      nameInput.value = '';
    };

    saveBtn.addEventListener('click', e => {
      e.stopPropagation();
      handleCreate();
    });

    nameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        handleCreate();
      }
    });
  }

  if (listContainer) {
    listContainer.addEventListener('click', e => {
      const deleteBtn = e.target.closest('.btn-dropdown-delete');
      if (deleteBtn) {
        e.stopPropagation();
        const id = deleteBtn.dataset.id;
        deleteSnapshot(id);
        return;
      }

      const historyBtn = e.target.closest('.btn-snap-history');
      if (historyBtn) {
        e.stopPropagation();
        const id = historyBtn.dataset.id;
        openVersionHistoryModal(id);
        if (snapshotsMenu) snapshotsMenu.classList.remove('show');
        return;
      }

      const renameBtn = e.target.closest('.btn-snap-rename');
      if (renameBtn) {
        e.stopPropagation();
        const id = renameBtn.dataset.id;
        openRenameModal(id);
        if (snapshotsMenu) snapshotsMenu.classList.remove('show');
        return;
      }

      const item = e.target.closest('.dropdown-snapshot-item');
      if (item) {
        const id = item.dataset.id;
        switchSnapshot(id);
        if (snapshotsMenu) snapshotsMenu.classList.remove('show');
        if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }
}

// ============================================================================
// Rename Snapshot Modal
// ============================================================================
function openRenameModal(snapshotId) {
  const snap = snapshots.find(s => s.id === snapshotId);
  if (!snap) return;

  renameTargetSnapshotId = snapshotId;
  const modal = document.getElementById('rename-modal');
  const input = document.getElementById('rename-input');

  if (input) {
    input.value = snap.name;
  }
  if (modal) {
    modal.style.display = 'flex';
    setTimeout(() => {
      if (input) {
        input.focus();
        input.select();
      }
    }, 50);
  }
}

function closeRenameModal() {
  const modal = document.getElementById('rename-modal');
  if (modal) modal.style.display = 'none';
  renameTargetSnapshotId = null;
}

function setupRenameModalEvents() {
  const modal = document.getElementById('rename-modal');
  const closeBtn = document.getElementById('btn-close-rename-modal');
  const cancelBtn = document.getElementById('btn-cancel-rename');
  const confirmBtn = document.getElementById('btn-confirm-rename');
  const input = document.getElementById('rename-input');

  const doRename = () => {
    if (renameTargetSnapshotId && input) {
      renameSnapshot(renameTargetSnapshotId, input.value);
    }
    closeRenameModal();
  };

  if (closeBtn) closeBtn.addEventListener('click', closeRenameModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeRenameModal);
  if (confirmBtn) confirmBtn.addEventListener('click', doRename);

  if (input) {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doRename();
      } else if (e.key === 'Escape') {
        closeRenameModal();
      }
    });
  }
}

// ============================================================================
// Version History Modal Setup
// ============================================================================
function setupVersionModalEvents() {
  const closeBtn = document.getElementById('btn-close-version-modal');
  const doneBtn = document.getElementById('btn-version-modal-done');
  const saveCurrentBtn = document.getElementById('btn-version-save-current');
  const listContainer = document.getElementById('version-history-list');

  if (closeBtn) closeBtn.addEventListener('click', closeVersionHistoryModal);
  if (doneBtn) doneBtn.addEventListener('click', closeVersionHistoryModal);

  if (saveCurrentBtn) {
    saveCurrentBtn.addEventListener('click', () => {
      const targetId = historyModalTargetSnapshotId || state.activeSnapshotId;
      if (targetId === state.activeSnapshotId) {
        saveActiveSnapshot(true, 'Manual revision checkpoint');
        renderVersionHistoryList(targetId);
      }
    });
  }

  if (listContainer) {
    listContainer.addEventListener('click', e => {
      const restoreBtn = e.target.closest('.btn-restore-ver');
      if (restoreBtn && historyModalTargetSnapshotId) {
        const verId = restoreBtn.dataset.verId;
        restoreVersion(historyModalTargetSnapshotId, verId);
      }
    });
  }
}

// ============================================================================
// Convex Cloud Sync & Auth Integration
// ============================================================================
function setupCloudAuthUI() {
  const authModal = document.getElementById('auth-modal');
  const openModalBtn = document.getElementById('btn-auth-open-modal');
  const closeAuthBtn = document.getElementById('btn-close-auth-modal');

  const tabLogin = document.getElementById('tab-auth-login');
  const tabRegister = document.getElementById('tab-auth-register');
  const authForm = document.getElementById('auth-form');
  const submitBtn = document.getElementById('btn-auth-submit');
  const errorMsg = document.getElementById('auth-error-msg');
  const successMsg = document.getElementById('auth-success-msg');

  const btnSyncNow = document.getElementById('btn-auth-sync-now');
  const btnLogout = document.getElementById('btn-auth-logout');

  let authMode = 'login'; // 'login' | 'register'

  // Update header status dot & label
  ConvexService.onSyncStateChange((status, message) => {
    updateCloudStatusUI(status, message);
  });

  const updateCloudStatusUI = (status, message = '') => {
    const dot = document.getElementById('auth-status-dot');
    const label = document.getElementById('auth-btn-label');
    const headerAvatar = document.getElementById('auth-header-avatar');
    const menuAvatar = document.getElementById('auth-menu-avatar');
    const guestSection = document.getElementById('auth-menu-guest');
    const userSection = document.getElementById('auth-menu-user');
    const usernameDisplay = document.getElementById('auth-menu-username');
    const syncDesc = document.getElementById('auth-sync-status-desc');

    if (!label) return;

    if (dot) {
      dot.className = `status-dot ${status}`;
    }

    if (ConvexService.isAuthenticated()) {
      const user = ConvexService.getUser();
      const name = user ? user.username : 'User';
      label.innerHTML = `<span class="auth-username-label">${escapeHtml(name)}</span>`;
      
      if (guestSection) guestSection.style.display = 'none';
      if (userSection) userSection.style.display = 'block';
      if (usernameDisplay) usernameDisplay.textContent = name;
      if (syncDesc) {
        if (status === 'syncing') syncDesc.textContent = 'Syncing changes...';
        else if (status === 'error') syncDesc.textContent = message || 'Sync error';
        else syncDesc.textContent = message || 'Synced with cloud';
      }
    } else {
      label.innerHTML = `Sign In / Sync`;
      if (guestSection) guestSection.style.display = 'block';
      if (userSection) userSection.style.display = 'none';
    }
    refreshAllAvatars();
  };

  // Open Auth modal
  const openAuthModal = (mode = 'login') => {
    authMode = mode;
    const usernameInput = document.getElementById('auth-username-input');
    const previewAvatar = document.getElementById('auth-modal-avatar-preview');

    if (tabLogin && tabRegister) {
      if (mode === 'login') {
        tabLogin.classList.add('active');
        tabRegister.classList.remove('active');
        if (submitBtn) submitBtn.textContent = 'Sign In';
      } else {
        tabRegister.classList.add('active');
        tabLogin.classList.remove('active');
        if (submitBtn) submitBtn.textContent = 'Create Account';
      }
    }
    if (previewAvatar) {
      const initialSeed = (usernameInput && usernameInput.value.trim()) ? usernameInput.value.trim() : (mode === 'register' ? 'new user' : 'alex');
      renderBlobatar(initialSeed, previewAvatar);
    }
    if (errorMsg) errorMsg.style.display = 'none';
    if (successMsg) successMsg.style.display = 'none';

    if (authModal) authModal.style.display = 'flex';
  };

  const closeAuthModal = () => {
    if (authModal) authModal.style.display = 'none';
  };

  if (openModalBtn) {
    openModalBtn.addEventListener('click', () => {
      const authMenu = document.getElementById('auth-menu');
      if (authMenu) authMenu.classList.remove('show');
      openAuthModal('login');
    });
  }

  if (closeAuthBtn) closeAuthBtn.addEventListener('click', closeAuthModal);

  const authUsernameInput = document.getElementById('auth-username-input');
  const authModalAvatarPreview = document.getElementById('auth-modal-avatar-preview');

  if (authUsernameInput && authModalAvatarPreview) {
    authUsernameInput.addEventListener('input', () => {
      const val = authUsernameInput.value.trim();
      renderBlobatar(val || (authMode === 'register' ? 'new user' : 'alex'), authModalAvatarPreview);
    });
  }

  if (tabLogin) {
    tabLogin.addEventListener('click', () => {
      authMode = 'login';
      tabLogin.classList.add('active');
      tabRegister.classList.remove('active');
      if (submitBtn) submitBtn.textContent = 'Sign In';
      if (errorMsg) errorMsg.style.display = 'none';
      if (authModalAvatarPreview) {
        const val = authUsernameInput ? authUsernameInput.value.trim() : '';
        renderBlobatar(val || 'alex', authModalAvatarPreview);
      }
    });
  }

  if (tabRegister) {
    tabRegister.addEventListener('click', () => {
      authMode = 'register';
      tabRegister.classList.add('active');
      tabLogin.classList.remove('active');
      if (submitBtn) submitBtn.textContent = 'Create Account';
      if (errorMsg) errorMsg.style.display = 'none';
      if (authModalAvatarPreview) {
        const val = authUsernameInput ? authUsernameInput.value.trim() : '';
        renderBlobatar(val || 'new user', authModalAvatarPreview);
      }
    });
  }

  // Handle Auth Submit
  if (authForm) {
    authForm.addEventListener('submit', async e => {
      e.preventDefault();
      const usernameInput = document.getElementById('auth-username-input');
      const passwordInput = document.getElementById('auth-password-input');

      const username = usernameInput ? usernameInput.value.trim() : '';
      const password = passwordInput ? passwordInput.value : '';

      if (!ConvexService.isConfigured()) {
        if (errorMsg) {
          errorMsg.textContent = 'Cloud service is currently initializing. Please configure CONVEX_URL in config.js.';
          errorMsg.style.display = 'block';
        }
        return;
      }

      if (submitBtn) submitBtn.disabled = true;
      if (errorMsg) errorMsg.style.display = 'none';
      if (successMsg) successMsg.style.display = 'none';

      try {
        if (authMode === 'register') {
          await ConvexService.register(username, password);
        } else {
          await ConvexService.login(username, password);
        }

        if (successMsg) {
          successMsg.textContent = 'Success! Syncing data across devices...';
          successMsg.style.display = 'block';
        }

        // Trigger smart sync with cloud
        await performFullCloudSync(true);

        setTimeout(() => {
          closeAuthModal();
          if (submitBtn) submitBtn.disabled = false;
          showToast(`Welcome, ${username}! Sync enabled.`);
        }, 600);
      } catch (err) {
        console.error('Auth error', err);
        if (errorMsg) {
          errorMsg.textContent = err.message || 'Authentication failed. Please check your username and password.';
          errorMsg.style.display = 'block';
        }
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  // Sync Now Button
  if (btnSyncNow) {
    btnSyncNow.addEventListener('click', async () => {
      const authMenu = document.getElementById('auth-menu');
      if (authMenu) authMenu.classList.remove('show');
      showToast('Syncing with cloud...');
      await performFullCloudSync(true);
    });
  }

  // Logout Button
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      const authMenu = document.getElementById('auth-menu');
      if (authMenu) authMenu.classList.remove('show');
      ConvexService.stopBackgroundSync();
      await ConvexService.logout();
      updateCloudStatusUI('offline', 'Signed out');
      showToast('Signed out. Local data preserved.');
    });
  }
}

// ============================================================================
// Full Cloud Synchronization Engine (Smart Merge with Zero Data Loss)
// ============================================================================
async function performFullCloudSync(isManualSync = false) {
  if (!ConvexService.isAuthenticated() || !ConvexService.isConfigured()) return;

  try {
    // Flatten local version histories for sync
    const allLocalVersions = [];
    for (const [snapId, verList] of Object.entries(versions)) {
      if (Array.isArray(verList)) {
        verList.forEach(v => {
          allLocalVersions.push({
            clientSnapshotId: snapId,
            versionNumber: v.versionNumber || 1,
            name: v.name || 'Snapshot',
            note: v.note || '',
            courses: v.courses || [],
            metrics: v.metrics || null,
            createdAt: v.createdAt || Date.now(),
          });
        });
      }
    }

    // Prepare snapshots payload for cloud sync:
    // If the active snapshot has unsaved local changes, send its last saved revision from versions
    // so unsaved local keystrokes/drafts stay on localhost only until explicitly saved.
    const snapshotsToSend = snapshots.map(s => {
      if (s.id === state.activeSnapshotId && state.hasUnsavedChanges && versions[s.id] && versions[s.id].length > 0) {
        const lastSavedVer = versions[s.id][0];
        return {
          id: s.id,
          name: s.name,
          courses: lastSavedVer.courses || [],
          metrics: lastSavedVer.metrics || null,
          createdAt: s.createdAt,
          updatedAt: lastSavedVer.createdAt || s.updatedAt,
        };
      }
      return s;
    });

    const syncResult = await ConvexService.smartSync(snapshotsToSend, allLocalVersions, state.activeSnapshotId);

    if (syncResult && Array.isArray(syncResult.snapshots) && syncResult.snapshots.length > 0) {
      snapshots = syncResult.snapshots;
      if (syncResult.versions) {
        versions = syncResult.versions;
      }

      if (syncResult.activeSnapshotId) {
        const found = snapshots.find(s => s.id === syncResult.activeSnapshotId);
        if (found) {
          state.activeSnapshotId = found.id;
          // Guard: Never overwrite working table if user has active unsaved edits/undo in progress
          if (!state.hasUnsavedChanges || isManualSync) {
            state.courses = JSON.parse(JSON.stringify(found.courses || []));
            renderTable();
          }
        }
      }

      saveLocalData();
      renderSnapshotList();
      updateSnapshotBadge();
      updateActiveSnapshotHeaderUI();
    }
  } catch (err) {
    console.error('Smart sync error', err);
  }
}

// ============================================================================
// Toolbar, Tabs & Dropdowns
// ============================================================================
function setupToolbarAndTabs() {
  const addBtn = document.getElementById('btn-add-row');
  const emptyAddBtn = document.getElementById('btn-empty-add');
  if (addBtn) addBtn.addEventListener('click', () => addNewRow());
  if (emptyAddBtn) emptyAddBtn.addEventListener('click', () => addNewRow());

  const clearAllBtn = document.getElementById('btn-clear-all');
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', () => {
      if (state.courses.length === 0) return;
      if (confirm('Are you sure you want to clear all classes in the current snapshot?')) {
        pushHistory();
        state.courses = [];
        markUnsavedChanges(true);
        saveLocalData();
        renderTable();
      }
    });
  }

  // Filter tabs
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

function setupDropdownHandling() {
  const dropdownConfigs = [
    { dropdown: document.getElementById('snapshots-dropdown'), toggle: document.getElementById('btn-snapshots-toggle'), menu: document.getElementById('snapshots-menu') },
    { dropdown: document.getElementById('auth-dropdown'), toggle: document.getElementById('btn-auth-toggle'), menu: document.getElementById('auth-menu') },
    { dropdown: document.getElementById('actions-dropdown'), toggle: document.getElementById('btn-dropdown-toggle'), menu: document.getElementById('dropdown-menu') }
  ];

  dropdownConfigs.forEach(({ dropdown, toggle, menu }) => {
    if (!dropdown || !toggle || !menu) return;

    toggle.addEventListener('click', e => {
      e.stopPropagation();
      const isOpen = menu.classList.contains('show');

      // Close all other dropdowns
      dropdownConfigs.forEach(d => {
        if (d.menu) {
          d.menu.classList.remove('show');
          if (d.toggle) d.toggle.setAttribute('aria-expanded', 'false');
        }
      });

      if (!isOpen) {
        menu.classList.add('show');
        toggle.setAttribute('aria-expanded', 'true');
        if (dropdown.id === 'snapshots-dropdown') {
          renderSnapshotList();
          const input = document.getElementById('dropdown-snapshot-input');
          if (input) setTimeout(() => input.focus(), 50);
        }
      }
    });
  });

  // Global click outside to close dropdowns
  document.addEventListener('click', e => {
    dropdownConfigs.forEach(({ dropdown, toggle, menu }) => {
      if (dropdown && menu && !dropdown.contains(e.target)) {
        menu.classList.remove('show');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
      }
    });
  });

  // Escape closes dropdowns and modals
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      dropdownConfigs.forEach(({ toggle, menu }) => {
        if (menu) menu.classList.remove('show');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
      });
      closeVersionHistoryModal();
      closeRenameModal();
      const authModal = document.getElementById('auth-modal');
      if (authModal) authModal.style.display = 'none';
    }
  });

  // Actions menu auto close on action item click
  const actionsMenu = document.getElementById('dropdown-menu');
  if (actionsMenu) {
    actionsMenu.querySelectorAll('.dropdown-item').forEach(item => {
      item.addEventListener('click', () => {
        actionsMenu.classList.remove('show');
        const toggle = document.getElementById('btn-dropdown-toggle');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }
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
// CSV Export & Import
// ============================================================================
function setupCsvHandling() {
  const exportBtn = document.getElementById('btn-export-csv');
  const importInput = document.getElementById('csv-file-input');

  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      if (state.courses.length === 0) {
        alert('No courses to export.');
        return;
      }

      const activeSnap = snapshots.find(s => s.id === state.activeSnapshotId);
      const safeTitle = (activeSnap ? activeSnap.name : 'GPA_Planner').replace(/[^a-zA-Z0-9_-]/g, '_');

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
      a.download = `${safeTitle}_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  if (importInput) {
    importInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = event => {
        try {
          const text = event.target.result;
          const parsedCourses = parseMultiFormatCsv(text);

          if (parsedCourses.length > 0) {
            pushHistory();
            state.courses = parsedCourses;
            markUnsavedChanges(true);
            saveLocalData();
            renderTable();
            showToast(`Imported ${parsedCourses.length} classes`);
          } else {
            alert('Could not parse valid course rows from CSV. Please check the file format.');
          }
        } catch (err) {
          console.error(err);
          alert('Error reading CSV file.');
        }
        importInput.value = '';
      };
      reader.readAsText(file);
    });
  }
}

export function parseMultiFormatCsv(csvText) {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length === 0) return [];

  const rawRows = lines.map(line => parseCsvLine(line));
  if (rawRows.length === 0) return [];

  let startIndex = 0;
  const firstRowStr = rawRows[0].join(' ').toLowerCase();
  const isHeader = firstRowStr.includes('class') ||
    firstRowStr.includes('course') ||
    firstRowStr.includes('credit') ||
    firstRowStr.includes('scale') ||
    firstRowStr.includes('grade');

  if (isHeader) startIndex = 1;

  const newCourses = [];
  let currentYear = 'Freshman';

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
    if (!className) continue;

    let credits = 1.0;
    let scale = 'regular';
    let grade = '';
    let year = '';

    const col1 = (cols[1] || '').trim();
    const col2 = (cols[2] || '').trim();
    const col3 = (cols[3] || '').trim();
    const col4 = (cols[4] || '').trim();

    const isCol1NumericCredit = isCreditValue(col1);
    const isCol2NumericCredit = isCreditValue(col2);

    if (isCol1NumericCredit && !isCol2NumericCredit) {
      credits = parseFloat(col1) || 1.0;
      scale = normalizeScale(col2);
      grade = col3;
      year = col4;
    } else if (isCol2NumericCredit) {
      scale = normalizeScale(col1);
      credits = parseFloat(col2) || 1.0;
      grade = col3;
      year = col4;
    } else {
      credits = parseFloat(col1) || parseFloat(col2) || 1.0;
      scale = normalizeScale(col2 || col1);
      grade = col3 || '';
      year = col4 || '';
    }

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
// Utilities
// ============================================================================
function showToast(message) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 3000);
}

function formatDateTime(timestamp) {
  if (!timestamp) return '';
  try {
    const d = new Date(timestamp);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return String(timestamp);
  }
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
// App Initialization
// ============================================================================
async function init() {
  loadLocalData();
  renderScaleReferenceTable();
  setupToolbarAndTabs();
  setupDropdownHandling();
  setupKeyboardShortcuts();
  setupSnapshotHandling();
  setupRenameModalEvents();
  setupVersionModalEvents();
  setupCloudAuthUI();
  attachTableEvents();
  setupCsvHandling();
  renderTable();

  // Initialize baseline GPA and register main Blobatar PFP
  const initialMetrics = calculateMetrics();
  lastSettledGpa = initialMetrics.totalCredits > 0 ? initialMetrics.cumulativeWeightedGpa : 0;

  registerAvatar('auth-header-avatar', getCurrentUserName, {
    traits: { shape: 0.43 },
    background: 'circle',
    animate: 'hover',
  });

  registerAvatar('auth-menu-avatar', getCurrentUserName, {
    traits: { shape: 0.43 },
    background: 'circle',
    animate: 'hover',
  });

  registerAvatar('auth-menu-guest-avatar', getCurrentUserName, {
    traits: { shape: 0.43 },
    background: 'circle',
    animate: 'hover',
  });

  // Check cloud session & start background sync if logged in
  if (ConvexService.isAuthenticated() && ConvexService.isConfigured()) {
    try {
      const user = await ConvexService.checkSession();
      if (user) {
        await performFullCloudSync(true);
        ConvexService.startBackgroundSync(async () => {
          await performFullCloudSync(false);
        }, 15000);
      }
    } catch (e) {
      console.warn('Initial session check error', e);
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', init);
}
