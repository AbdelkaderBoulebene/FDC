/**
 * storage.js — Sauvegarde et restauration de l'état en localStorage
 */

const STORAGE_KEY = 'fdc_app_state_v1';

/**
 * Sauvegarde l'état global dans localStorage
 * @param {Object} state - L'état global AppState
 */
function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('[FDC] Impossible de sauvegarder en localStorage:', e);
  }
}

/**
 * Charge l'état depuis localStorage
 * @returns {Object|null} L'état sauvegardé, ou null si absent/invalide
 */
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Vérification basique de structure
    if (!parsed.rooms || !parsed.employees || !parsed.options) return null;
    return parsed;
  } catch (e) {
    console.warn('[FDC] Impossible de charger depuis localStorage:', e);
    return null;
  }
}

/**
 * Efface l'état sauvegardé
 */
function clearState() {
  localStorage.removeItem(STORAGE_KEY);
}
