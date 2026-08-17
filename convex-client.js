import { getConvexUrl } from './config.js';

const STORAGE_KEY_SESSION = 'gpafinder_session_token';
const STORAGE_KEY_USER = 'gpafinder_cached_user';

let currentSessionToken = null;
let currentCachedUser = null;
let syncStateListeners = [];
let syncInterval = null;

try {
  currentSessionToken = localStorage.getItem(STORAGE_KEY_SESSION);
  const cachedUserStr = localStorage.getItem(STORAGE_KEY_USER);
  if (cachedUserStr) {
    currentCachedUser = JSON.parse(cachedUserStr);
  }
} catch (e) {
  console.warn('Could not read session token from localStorage', e);
}

/**
 * Notify subscribers about sync status
 * @param {'idle' | 'syncing' | 'synced' | 'offline' | 'error'} state
 * @param {string} [message]
 */
function notifySyncState(state, message = '') {
  syncStateListeners.forEach(listener => {
    try {
      listener(state, message);
    } catch (e) {
      console.error(e);
    }
  });
}

/**
 * Execute a Convex Function via standard HTTP API
 */
async function callConvex(type, path, args = {}) {
  const baseUrl = getConvexUrl();
  if (!baseUrl) {
    throw new Error('Cloud sync service is currently unconfigured in config.js.');
  }

  const endpoint = `${baseUrl}/api/${type}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      path,
      args,
      format: 'json',
    }),
  });

  if (!response.ok) {
    let errorText = `HTTP ${response.status} ${response.statusText}`;
    try {
      const errJson = await response.json();
      if (errJson && errJson.errorMessage) {
        errorText = errJson.errorMessage;
      }
    } catch (_) {}
    throw new Error(errorText);
  }

  const result = await response.json();
  if (result.status === 'error') {
    throw new Error(result.errorMessage || 'An error occurred on Convex backend.');
  }

  return result.value;
}

function normalizeMetrics(m) {
  if (!m) return null;
  return {
    weightedGpa: Number(m.weightedGpa !== undefined ? m.weightedGpa : (m.cumulativeWeightedGpa || 0)),
    unweightedGpa: Number(m.unweightedGpa !== undefined ? m.unweightedGpa : (m.cumulativeUnweightedGpa || 0)),
    totalCredits: Number(m.totalCredits || 0),
    validCoursesCount: Number(m.validCoursesCount || 0),
    totalCoursesCount: Number(m.totalCoursesCount || 0),
  };
}

export const ConvexService = {
  /**
   * Subscribe to sync state changes
   */
  onSyncStateChange(listener) {
    syncStateListeners.push(listener);
    return () => {
      syncStateListeners = syncStateListeners.filter(l => l !== listener);
    };
  },

  /**
   * Check if Convex backend is configured
   */
  isConfigured() {
    const url = getConvexUrl();
    return !!(url && url.length > 0);
  },

  /**
   * Check if currently signed in
   */
  isAuthenticated() {
    return !!currentSessionToken;
  },

  /**
   * Get current cached user info
   */
  getUser() {
    return currentCachedUser;
  },

  /**
   * Register a new user
   */
  async register(username, password) {
    notifySyncState('syncing', 'Registering...');
    try {
      const result = await callConvex('mutation', 'auth:register', { username, password });
      currentSessionToken = result.token;
      currentCachedUser = { username: result.username, userId: result.userId };
      localStorage.setItem(STORAGE_KEY_SESSION, currentSessionToken);
      localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(currentCachedUser));
      notifySyncState('synced', 'Account created');
      return result;
    } catch (e) {
      notifySyncState('error', e.message);
      throw e;
    }
  },

  /**
   * Log in an existing user
   */
  async login(username, password) {
    notifySyncState('syncing', 'Signing in...');
    try {
      const result = await callConvex('mutation', 'auth:login', { username, password });
      currentSessionToken = result.token;
      currentCachedUser = { username: result.username, userId: result.userId };
      localStorage.setItem(STORAGE_KEY_SESSION, currentSessionToken);
      localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(currentCachedUser));
      notifySyncState('synced', 'Signed in');
      return result;
    } catch (e) {
      notifySyncState('error', e.message);
      throw e;
    }
  },

  /**
   * Log out
   */
  async logout() {
    if (currentSessionToken) {
      try {
        await callConvex('mutation', 'auth:logout', { sessionToken: currentSessionToken });
      } catch (e) {
        console.warn('Logout notification error', e);
      }
    }
    currentSessionToken = null;
    currentCachedUser = null;
    try {
      localStorage.removeItem(STORAGE_KEY_SESSION);
      localStorage.removeItem(STORAGE_KEY_USER);
    } catch (e) {}
    notifySyncState('offline', 'Signed out');
  },

  /**
   * Check and validate current session with backend
   */
  async checkSession() {
    if (!currentSessionToken || !this.isConfigured()) {
      return null;
    }
    try {
      const user = await callConvex('query', 'auth:getCurrentUser', { sessionToken: currentSessionToken });
      if (!user) {
        // Session expired
        currentSessionToken = null;
        currentCachedUser = null;
        localStorage.removeItem(STORAGE_KEY_SESSION);
        localStorage.removeItem(STORAGE_KEY_USER);
        notifySyncState('offline', 'Session expired');
        return null;
      }
      currentCachedUser = user;
      localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(user));
      return user;
    } catch (e) {
      console.warn('Check session failed', e);
      return currentCachedUser;
    }
  },

  /**
   * Save / Push a single snapshot document
   */
  async saveSnapshot({ id, name, courses, metrics, createVersion = false, versionNote = '', updatedAt = Date.now() }) {
    if (!this.isAuthenticated() || !this.isConfigured()) return null;

    try {
      const result = await callConvex('mutation', 'snapshots:saveSnapshot', {
        sessionToken: currentSessionToken,
        clientSnapshotId: id,
        name,
        courses,
        metrics: normalizeMetrics(metrics),
        createVersion,
        versionNote,
        updatedAt,
      });
      return result;
    } catch (e) {
      console.error('Failed to push snapshot to Convex', e);
      notifySyncState('error', 'Cloud sync failed');
      throw e;
    }
  },

  /**
   * Delete a snapshot document from cloud
   */
  async deleteSnapshot(id) {
    if (!this.isAuthenticated() || !this.isConfigured()) return null;

    try {
      await callConvex('mutation', 'snapshots:deleteSnapshot', {
        sessionToken: currentSessionToken,
        clientSnapshotId: id,
      });
    } catch (e) {
      console.error('Failed to delete snapshot on Convex', e);
    }
  },

  /**
   * Fetch Version History for a snapshot from Convex
   */
  async getVersionHistory(id) {
    if (!this.isAuthenticated() || !this.isConfigured()) return [];

    try {
      const versions = await callConvex('query', 'snapshots:getVersionHistory', {
        sessionToken: currentSessionToken,
        clientSnapshotId: id,
      });
      return versions || [];
    } catch (e) {
      console.error('Failed to fetch versions from Convex', e);
      return [];
    }
  },

  /**
   * Perform a smart merge between local state and cloud state
   */
  async smartSync(localSnapshots, localVersionsList = [], activeSnapshotId = null) {
    if (!this.isAuthenticated() || !this.isConfigured()) return null;

    notifySyncState('syncing', 'Syncing with cloud...');
    try {
      const result = await callConvex('mutation', 'snapshots:smartSync', {
        sessionToken: currentSessionToken,
        localSnapshots: localSnapshots.map(s => ({
          id: s.id,
          name: s.name,
          courses: s.courses || [],
          metrics: normalizeMetrics(s.metrics),
          createdAt: s.createdAt ? (typeof s.createdAt === 'number' ? s.createdAt : new Date(s.createdAt).getTime()) : Date.now(),
          updatedAt: s.updatedAt ? (typeof s.updatedAt === 'number' ? s.updatedAt : new Date(s.updatedAt).getTime()) : Date.now(),
        })),
        localVersions: localVersionsList.map(v => ({
          clientSnapshotId: v.clientSnapshotId,
          versionNumber: v.versionNumber,
          name: v.name,
          note: v.note || '',
          courses: v.courses || [],
          metrics: normalizeMetrics(v.metrics),
          createdAt: v.createdAt ? (typeof v.createdAt === 'number' ? v.createdAt : new Date(v.createdAt).getTime()) : Date.now(),
        })),
        activeSnapshotId: activeSnapshotId || undefined,
      });

      notifySyncState('synced', 'All changes synced');
      return result;
    } catch (e) {
      notifySyncState('error', e.message);
      throw e;
    }
  },

  /**
   * Start periodic background sync polling
   */
  startBackgroundSync(syncCallback, intervalMs = 15000) {
    this.stopBackgroundSync();
    if (!this.isAuthenticated()) return;

    syncInterval = setInterval(async () => {
      if (document.hidden) return; // Save bandwidth when tab inactive
      if (this.isAuthenticated()) {
        try {
          await syncCallback();
        } catch (e) {
          console.warn('Periodic sync error', e);
        }
      }
    }, intervalMs);
  },

  /**
   * Stop periodic sync
   */
  stopBackgroundSync() {
    if (syncInterval) {
      clearInterval(syncInterval);
      syncInterval = null;
    }
  },
};
