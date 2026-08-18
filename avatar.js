import { blobatar } from 'https://cdn.jsdelivr.net/npm/blobatar/+esm';
import { happy, sad, idle } from 'https://cdn.jsdelivr.net/npm/blobatar/expression/+esm';

// Available expression definitions
export const EXPRESSIONS = {
  happy,
  sad,
  idle,
};

// Current active global mood state
let currentMood = 'idle'; // 'happy' | 'sad' | 'idle'

// Registry of DOM avatar elements to automatically update on mood or state changes
const registeredAvatars = new Map();

/**
 * Resolves an expression option into a valid Blobatar expression object.
 * @param {string|Object} [expr]
 * @returns {Object}
 */
function resolveExpression(expr) {
  if (!expr) {
    return EXPRESSIONS[currentMood] || idle;
  }
  if (typeof expr === 'string') {
    return EXPRESSIONS[expr.toLowerCase()] || idle;
  }
  return expr;
}

/**
 * Generates a deterministic Blobatar SVG string.
 * @param {string} name - Seed string (username, email, id, etc.)
 * @param {Object} [options] - Configuration overrides
 * @returns {string} - SVG string markup
 */
export function getBlobatarSvg(name, options = {}) {
  const seed = (name && typeof name === 'string' && name.trim()) ? name.trim() : 'blobatar';
  const expr = resolveExpression(options.expression);

  try {
    return blobatar(seed, {
      traits: { shape: 0.43, ...(options.traits || {}) }, // Organic shape
      background: options.background !== undefined ? options.background : 'circle',
      expression: expr,
      animate: options.animate || 'hover',
      ...options,
    });
  } catch (err) {
    console.warn('Failed to generate blobatar avatar:', err);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="50" fill="#6366f1"/>
      <circle cx="50" cy="40" r="18" fill="#ffffff"/>
      <path d="M 20 85 A 32 32 0 0 1 80 85 Z" fill="#ffffff"/>
    </svg>`;
  }
}

/**
 * Renders a Blobatar SVG directly into a DOM container element.
 * @param {string} name - Seed string
 * @param {HTMLElement} container - DOM container element
 * @param {Object} [options] - Additional options
 */
export function renderBlobatar(name, container, options = {}) {
  if (!container) return;
  const svg = getBlobatarSvg(name, options);
  container.innerHTML = svg;
}

/**
 * Registers an avatar container to automatically refresh when mood or profile changes.
 * @param {HTMLElement|string} target - Container element or element ID
 * @param {Function} getName - Function returning the current seed name
 * @param {Object} [options] - Custom rendering options
 */
export function registerAvatar(target, getName, options = {}) {
  const el = typeof target === 'string' ? document.getElementById(target) : target;
  if (!el) return;

  registeredAvatars.set(el, { getName, options });
  renderBlobatar(getName(), el, options);
}

/**
 * Unregisters an avatar container.
 * @param {HTMLElement|string} target
 */
export function unregisterAvatar(target) {
  const el = typeof target === 'string' ? document.getElementById(target) : target;
  if (el) registeredAvatars.delete(el);
}

/**
 * Gets the current avatar mood.
 * @returns {'happy'|'sad'|'idle'}
 */
export function getAvatarMood() {
  return currentMood;
}

/**
 * Sets the active avatar mood ('happy', 'sad', 'idle') and re-renders registered avatars.
 * @param {'happy'|'sad'|'idle'} mood
 */
export function setAvatarMood(mood) {
  const normalized = (mood || 'idle').toLowerCase();
  if (normalized !== 'happy' && normalized !== 'sad' && normalized !== 'idle') {
    return;
  }

  currentMood = normalized;
  refreshAllAvatars();
}

/**
 * Re-renders all registered avatars in the DOM.
 */
export function refreshAllAvatars() {
  registeredAvatars.forEach(({ getName, options }, el) => {
    if (!document.body.contains(el)) {
      registeredAvatars.delete(el);
      return;
    }
    const name = getName ? getName() : 'blobatar';
    renderBlobatar(name, el, options);
  });
}
