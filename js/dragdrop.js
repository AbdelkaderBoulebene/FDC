/**
 * dragdrop.js — Gestion du drag & drop HTML5 natif
 * Permet de déplacer les cartes chambres entre colonnes FDC et le pool
 */

// État interne du drag
let _draggedRoomId       = null;
let _draggedFromEmployee = null; // ID de l'employée source (ou 'unassigned')

// ── Démarrage du drag ─────────────────────────────────────────
function handleDragStart(event, roomId) {
  _draggedRoomId = roomId;

  // Trouver l'employée source
  const card   = event.currentTarget;
  const column = card.closest('[data-employee-id]');
  _draggedFromEmployee = column ? column.dataset.employeeId : 'unassigned';

  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', roomId);

  // Feedback visuel léger
  setTimeout(() => card.classList.add('dragging'), 0);
}

// ── Survol d'une zone de dépôt ────────────────────────────────
function handleDragOver(event) {
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = 'move';

  const zone = event.currentTarget;
  zone.classList.add('drag-over');
}

// ── Sortie d'une zone de dépôt ────────────────────────────────
function handleDragLeave(event) {
  // Ne retirer la classe que si on sort vraiment de la zone (pas vers un enfant)
  const zone   = event.currentTarget;
  const related = event.relatedTarget;
  if (related && zone.contains(related)) return;
  zone.classList.remove('drag-over');
}

// ── Dépôt ─────────────────────────────────────────────────────
function handleDrop(event, targetEmployeeId) {
  event.preventDefault();
  event.stopPropagation();

  const zone = event.currentTarget;
  zone.classList.remove('drag-over');

  if (!_draggedRoomId) return;

  const sourceId = _draggedFromEmployee;
  const targetId = targetEmployeeId;

  // Pas de changement si on dépose dans la même zone
  if (sourceId === targetId) {
    _draggedRoomId = null;
    return;
  }

  const state = window.AppState;

  // ── Trouver et retirer la chambre de sa source ────────────
  let room = null;

  if (sourceId && sourceId !== 'unassigned') {
    const sourceEmployee = state.employees.find(e => e.id === sourceId);
    if (sourceEmployee) {
      const idx = sourceEmployee.rooms.findIndex(r => r.id === _draggedRoomId);
      if (idx !== -1) {
        room = { ...sourceEmployee.rooms[idx] };
        sourceEmployee.rooms.splice(idx, 1);
      }
    }
  }

  // Si non trouvé dans les employées → chercher dans rooms généraux
  if (!room) {
    const baseRoom = state.rooms.find(r => r.id === _draggedRoomId);
    if (baseRoom) room = { ...baseRoom };
  }

  if (!room) {
    _draggedRoomId = null;
    return;
  }

  // ── Assigner à la destination ────────────────────────────
  if (targetId === 'unassigned') {
    // Retour au pool — la chambre est déjà retirée de la source, rien à faire
    room.assignedTo = null;
  } else {
    const targetEmployee = state.employees.find(e => e.id === targetId);
    if (targetEmployee) {
      room.assignedTo = targetId;
      targetEmployee.rooms.push(room);
    }
  }

  // ── Sauvegarder et re-rendre ─────────────────────────────
  _draggedRoomId       = null;
  _draggedFromEmployee = null;

  saveState(state);
  renderAll(state);
}

// ── Nettoyage global ──────────────────────────────────────────
function initDragLeaveListeners() {
  // Nettoyer les classes dragging/drag-over en fin de drag (même si pas de drop)
  document.addEventListener('dragend', () => {
    document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    _draggedRoomId       = null;
    _draggedFromEmployee = null;
  });
}
