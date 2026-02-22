/**
 * app.js — Point d'entrée, état global, gestion des événements
 *
 * Ordre de chargement des scripts :
 *   storage.js → importer.js → algorithm.js → dragdrop.js → export.js → ui.js → app.js
 */

// ── État global ──────────────────────────────────────────────
window.AppState = {
  rooms:     [],
  employees: [],
  options: {
    balanceBedType:    false,
    ignoreFloor:       false,
    gouvernanteActive: false,
    maxDeparts:        null,  // null = pas de limite
    maxRecouches:      null   // null = pas de limite
  }
};

// ── Employées par défaut (7 FDC + 1 gouvernante) ─────────────
function buildDefaultEmployees() {
  const fdcs = [];
  for (let i = 1; i <= 7; i++) {
    fdcs.push({ id: `fdc${i}`, name: `FDC ${i}`, isGouvernante: false, rooms: [] });
  }
  fdcs.push({ id: 'gouvernante', name: 'Gouvernante', isGouvernante: true, rooms: [] });
  return fdcs;
}

// ── Synchronisation des checkboxes avec l'état ───────────────
function syncCheckboxes(options) {
  document.getElementById('opt-balance-bedtype').checked = options.balanceBedType    || false;
  document.getElementById('opt-ignore-floor').checked    = options.ignoreFloor       || false;
  document.getElementById('opt-gouvernante').checked     = options.gouvernanteActive || false;
  const inpD = document.getElementById('inp-max-departs');
  const inpR = document.getElementById('inp-max-recouches');
  if (inpD) inpD.value = options.maxDeparts  ?? '';
  if (inpR) inpR.value = options.maxRecouches ?? '';
}

// ── Initialisation ────────────────────────────────────────────
function initApp() {
  // Charger depuis localStorage si disponible
  const saved = loadState();
  if (saved) {
    window.AppState = saved;
    syncCheckboxes(window.AppState.options);
    renderAll(window.AppState);

    // Restaurer l'état visuel de l'étape 2 si des chambres existent
    if (saved.rooms && saved.rooms.length > 0) {
      document.getElementById('btn-import').classList.add('done');
      document.getElementById('import-status').textContent =
        `${saved.rooms.length} chambre${saved.rooms.length > 1 ? 's' : ''}`;
    }

    showToast('Session restaurée', 'info');
  } else {
    window.AppState.employees = buildDefaultEmployees();
    renderAll(window.AppState);
  }

  // Initialiser le drag & drop
  initDragLeaveListeners();

  // ── Bouton : Import Excel ──────────────────────────────────
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('file-input').click();
  });

  document.getElementById('file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const { rooms, format } = await parseExcel(file);

      // Réinitialiser les assignations en conservant les employées
      window.AppState.rooms = rooms;
      window.AppState.employees.forEach(emp => { emp.rooms = []; });

      saveState(window.AppState);
      renderAll(window.AppState);

      // Marquer l'étape 2 comme complétée
      document.getElementById('btn-import').classList.add('done');
      document.getElementById('import-status').textContent =
        `${rooms.length} chambre${rooms.length > 1 ? 's' : ''}`;

      showToast(`${rooms.length} chambre${rooms.length > 1 ? 's' : ''} importée${rooms.length > 1 ? 's' : ''} (format : ${format})`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
      console.error('[FDC] Erreur import:', err);
    }

    // Reset pour permettre de re-sélectionner le même fichier
    e.target.value = '';
  });

  // ── Bouton : Répartir ──────────────────────────────────────
  document.getElementById('btn-distribute').addEventListener('click', () => {
    const state = window.AppState;

    if (state.rooms.length === 0) {
      showToast('Importez d\'abord un fichier Excel', 'error');
      return;
    }

    const activeFDC = state.employees.filter(e => !e.isGouvernante);
    if (activeFDC.length === 0) {
      showToast('Ajoutez au moins une femme de chambre', 'error');
      return;
    }

    const result = distributeRooms(state.rooms, state.employees, state.options);
    state.employees = result;

    saveState(state);
    renderAll(state);

    // Résumé de la répartition
    const totalElig = state.rooms.filter(r => !r.blocked && r.status !== 'PROPRE' && r.status !== 'NONE').length;
    showToast(`Répartition effectuée — ${totalElig} chambres distribuées`, 'success');
  });

  // ── Bouton : Réinitialiser ────────────────────────────────
  document.getElementById('btn-reset').addEventListener('click', () => {
    if (!confirm('Réinitialiser les chambres ? Les noms des FDC sont conservés.')) return;

    // Garder les employées (noms conservés), vider leurs chambres
    window.AppState.rooms = [];
    window.AppState.employees.forEach(emp => { emp.rooms = []; });
    window.AppState.options = {
      balanceBedType: false, ignoreFloor: false, gouvernanteActive: false,
      maxDeparts: null, maxRecouches: null
    };

    saveState(window.AppState);
    syncCheckboxes(window.AppState.options);
    renderAll(window.AppState);

    // Réinitialiser l'étape 2 (le modèle reste chargé)
    document.getElementById('btn-import').classList.remove('done');
    document.getElementById('import-status').textContent = 'Chambres';

    showToast('Chambres réinitialisées (employées conservées)', 'info');
  });

  // ── Bouton : Charger template Excel ──────────────────────
  document.getElementById('btn-load-template').addEventListener('click', () => {
    document.getElementById('template-input').click();
  });

  document.getElementById('template-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      setTemplateBuffer(buffer);
      document.getElementById('template-status').textContent = 'Chargé';
      document.getElementById('btn-load-template').classList.add('done');
      document.getElementById('btn-load-template').title = `Modèle chargé : ${file.name}`;
      showToast(`Modèle chargé : ${file.name}`, 'success');
    } catch (err) {
      showToast('Erreur lors du chargement du modèle', 'error');
    }
    e.target.value = '';
  });

  // ── Bouton : Imprimer ─────────────────────────────────────
  document.getElementById('btn-export-pdf').addEventListener('click', () => {
    triggerPrint(window.AppState);
  });

  // ── Bouton : Export Excel ─────────────────────────────────
  document.getElementById('btn-export-excel').addEventListener('click', () => {
    if (window.AppState.rooms.length === 0) {
      showToast('Aucune donnée à exporter', 'error');
      return;
    }
    exportExcel(window.AppState);
  });

  // ── Options : Équilibrer Twin/Grand lit ───────────────────
  document.getElementById('opt-balance-bedtype').addEventListener('change', (e) => {
    window.AppState.options.balanceBedType = e.target.checked;
    saveState(window.AppState);
    renderAll(window.AppState);
  });

  // ── Options : Ignorer étages ──────────────────────────────
  document.getElementById('opt-ignore-floor').addEventListener('change', (e) => {
    window.AppState.options.ignoreFloor = e.target.checked;
    saveState(window.AppState);
  });

  // ── Options : Activer gouvernante ─────────────────────────
  document.getElementById('opt-gouvernante').addEventListener('change', (e) => {
    window.AppState.options.gouvernanteActive = e.target.checked;
    saveState(window.AppState);
    renderAll(window.AppState);
  });

  // ── Options : Max Départs / Max Recouches par FDC ─────────
  // Ces champs ne sont actifs que quand la gouvernante est activée
  document.getElementById('inp-max-departs').addEventListener('change', (e) => {
    const val = parseInt(e.target.value);
    window.AppState.options.maxDeparts = isNaN(val) || val <= 0 ? null : val;
    saveState(window.AppState);
  });

  document.getElementById('inp-max-recouches').addEventListener('change', (e) => {
    const val = parseInt(e.target.value);
    window.AppState.options.maxRecouches = isNaN(val) || val <= 0 ? null : val;
    saveState(window.AppState);
  });
}

// ── Fonctions globales (appelées depuis le HTML généré) ───────

/**
 * Ajouter une nouvelle FDC
 */
function addEmployee() {
  const state      = window.AppState;
  const id         = 'fdc_' + Date.now();
  const fdcCount   = state.employees.filter(e => !e.isGouvernante).length + 1;

  const newEmployee = {
    id,
    name:           `FDC ${fdcCount}`,
    isGouvernante:  false,
    rooms:          []
  };

  // Insérer avant la gouvernante
  const govIdx = state.employees.findIndex(e => e.isGouvernante);
  if (govIdx !== -1) {
    state.employees.splice(govIdx, 0, newEmployee);
  } else {
    state.employees.push(newEmployee);
  }

  saveState(state);
  renderAll(state);
}

/**
 * Supprimer une FDC — ses chambres retournent dans le pool non attribué
 */
function removeEmployee(employeeId) {
  const state = window.AppState;
  const emp   = state.employees.find(e => e.id === employeeId);
  if (!emp) return;

  const roomCount = emp.rooms.length;

  // Retirer l'employée (les chambres retournent automatiquement au pool
  // car renderUnassignedPool calcule les non-assignées depuis state.rooms)
  state.employees = state.employees.filter(e => e.id !== employeeId);

  saveState(state);
  renderAll(state);

  showToast(
    `${emp.name} supprimée${roomCount > 0 ? ` — ${roomCount} chambre${roomCount > 1 ? 's' : ''} libérée${roomCount > 1 ? 's' : ''}` : ''}`,
    'info'
  );
}

/**
 * Renommer une FDC (appelé onblur du champ contenteditable)
 */
function renameEmployee(employeeId, newName) {
  const emp = window.AppState.employees.find(e => e.id === employeeId);
  if (!emp) return;

  const trimmed = newName.trim();
  if (trimmed && trimmed !== emp.name) {
    emp.name = trimmed;
    saveState(window.AppState);
  }
}

// ════════════════════════════════════════════════════════════
// FONCTIONS D'ÉDITION DU TABLEAU (appelées depuis le HTML)
// ════════════════════════════════════════════════════════════

/**
 * Bascule le type de lit d'une chambre (GL ou Twin, exclusifs)
 * Cliquer sur le type déjà actif → le désactive (NONE)
 */
function toggleBedType(roomId, bedType) {
  const state = window.AppState;
  const room  = state.rooms.find(r => r.id === roomId);
  if (!room) return;

  // Si déjà actif → désactiver (NONE), sinon activer
  room.bedType = (room.bedType === bedType) ? 'NONE' : bedType;

  // Synchroniser dans les employées (la chambre peut être assignée)
  state.employees.forEach(emp => {
    const r = emp.rooms.find(r => r.id === roomId);
    if (r) r.bedType = room.bedType;
  });

  saveState(state);
  renderAll(state);
}

/**
 * Bascule le statut "bloqué" d'une chambre.
 * RÈGLE : on peut uniquement bloquer les chambres en Départ.
 */
function toggleBlocked(roomId) {
  const state = window.AppState;
  const room  = state.rooms.find(r => r.id === roomId);
  if (!room) return;

  // Seules les chambres DÉPART peuvent être bloquées (et déblocables)
  if (!room.blocked && room.status !== 'DEPART') {
    showToast('Seules les chambres en Départ peuvent être bloquées', 'error');
    return;
  }

  room.blocked = !room.blocked;

  // Si on bloque la chambre → la retirer de toutes les FDC
  if (room.blocked) {
    state.employees.forEach(emp => {
      emp.rooms = emp.rooms.filter(r => r.id !== roomId);
    });
  }

  saveState(state);
  renderAll(state);
}

// ── Démarrage ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initApp);
