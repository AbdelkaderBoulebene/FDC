/**
 * ui.js — Rendu de l'interface utilisateur
 */

// ── État UI ───────────────────────────────────────────────────
let _floorColumnVisible = true;   // visibilité colonne Étage

// ── Règle : quelles chambres peuvent être GL ou Twin ─────────
/**
 * Retourne true si la chambre peut être définie comme GL ou Twin.
 *
 * Règle hôtel :
 *  Étage 1 : TOUT sauf 107, 109, 124
 *  Étage 2 : TOUT sauf 207, 209, 224
 *  Étage 3 : SEULEMENT 303, 304, 322
 *  Étage 4 : SEULEMENT 403, 404, 422
 *  Étage 5 : SEULEMENT 503, 504, 522
 *  Autres  : aucune
 */
function canToggleBedType(room) {
  const num   = room.roomNumber;
  const floor = room.floor;
  const last2 = num.length >= 2 ? num.slice(-2) : num;

  if (floor === 1) return !['07', '09', '24'].includes(last2);
  if (floor === 2) return !['07', '09', '24'].includes(last2);
  if (floor === 3) return ['303', '304', '322'].includes(num);
  if (floor === 4) return ['403', '404', '422'].includes(num);
  if (floor === 5) return ['503', '504', '522'].includes(num);
  return false;
}

// ── Utilitaires HTML ─────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ── Badges pour les colonnes FDC ─────────────────────────────
function statusBadge(status, blocked) {
  if (blocked) return '<span class="badge badge-gray">Bloqué</span>';
  switch (status) {
    case 'DEPART':   return '<span class="badge badge-red">Départ</span>';
    case 'RECOUCHE': return '<span class="badge badge-orange">Recouche</span>';
    case 'PROPRE':   return '<span class="badge badge-green">Propre</span>';
    default:         return '';
  }
}

function bedTypeBadge(bedType) {
  switch (bedType) {
    case 'TWIN':      return '<span class="badge badge-blue">Twin</span>';
    case 'GRAND_LIT': return '<span class="badge badge-purple">GL</span>';
    default:          return '';
  }
}

// ══════════════════════════════════════════════════════════════
// ZONE A — Tableau principal (interactif)
// ══════════════════════════════════════════════════════════════
function renderRoomsTable(rooms) {
  const tbody   = document.getElementById('rooms-tbody');
  const countEl = document.getElementById('rooms-count');

  countEl.textContent = `${rooms.length} chambre${rooms.length !== 1 ? 's' : ''}`;

  if (rooms.length === 0) {
    tbody.innerHTML = `
      <tr id="rooms-empty-row">
        <td colspan="8" class="empty-table">
          <div class="empty-state">
            <span class="empty-icon">📋</span>
            <p>Importez un fichier Excel pour commencer</p>
          </div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = rooms.map(room => buildRoomRow(room)).join('');

  // Appliquer la visibilité de la colonne Étage
  applyFloorColumnVisibility();
}

/**
 * Construit le HTML d'une ligne de chambre
 * - Status : numéro de chambre coloré dans la colonne correspondante
 * - GL / Twin : boutons cliquables (selon règle hôtel)
 * - Bloqué : bouton visible uniquement pour les Départs
 */
function buildRoomRow(room) {
  const isDepart   = room.status === 'DEPART'   && !room.blocked;
  const isRecouche = room.status === 'RECOUCHE' && !room.blocked;
  const isPropre   = room.status === 'PROPRE'   && !room.blocked;

  const numDepart   = isDepart   ? `<span class="room-num-status status-num-depart">${escapeHtml(room.roomNumber)}</span>`   : '';
  const numRecouche = isRecouche ? `<span class="room-num-status status-num-recouche">${escapeHtml(room.roomNumber)}</span>` : '';
  const numPropre   = isPropre   ? `<span class="room-num-status status-num-propre">${escapeHtml(room.roomNumber)}</span>`   : '';

  const isGL   = room.bedType === 'GRAND_LIT';
  const isTwin = room.bedType === 'TWIN';
  const canBed = canToggleBedType(room);

  const rowClass = room.blocked ? 'row-blocked' : (isPropre ? 'row-propre' : '');

  const glBtn   = canBed
    ? `<button class="btn-bed ${isGL ? 'active active-gl' : ''}" onclick="toggleBedType('${escapeHtml(room.id)}', 'GRAND_LIT')" title="Grand lit">GL</button>`
    : `<span class="btn-bed btn-bed-disabled">—</span>`;

  const twinBtn = canBed
    ? `<button class="btn-bed ${isTwin ? 'active active-twin' : ''}" onclick="toggleBedType('${escapeHtml(room.id)}', 'TWIN')" title="Twin">TW</button>`
    : `<span class="btn-bed btn-bed-disabled">—</span>`;

  const canBlock   = room.status === 'DEPART' || room.blocked;
  const blockedBtn = canBlock
    ? `<button class="btn-blocked ${room.blocked ? 'active' : ''}" onclick="toggleBlocked('${escapeHtml(room.id)}')" title="${room.blocked ? 'Débloquer' : 'Bloquer'}">${room.blocked ? '🔒' : '🔓'}</button>`
    : `<span class="btn-blocked btn-blocked-disabled">—</span>`;

  return `
    <tr class="${rowClass}" data-room-id="${escapeHtml(room.id)}">
      <td class="cell-room">${escapeHtml(room.roomNumber)}</td>
      <td class="cell-floor cell-center">${room.floor}</td>
      <td class="cell-center cell-status">${numDepart}</td>
      <td class="cell-center cell-status">${numRecouche}</td>
      <td class="cell-center cell-status">${numPropre}</td>
      <td class="cell-center">${glBtn}</td>
      <td class="cell-center">${twinBtn}</td>
      <td class="cell-center">${blockedBtn}</td>
    </tr>`;
}

// ── Toggle colonne Étage ──────────────────────────────────────
function toggleFloorColumn() {
  _floorColumnVisible = !_floorColumnVisible;
  applyFloorColumnVisibility();

  const btn = document.getElementById('btn-toggle-floor');
  if (btn) btn.title = _floorColumnVisible ? 'Masquer colonne Étage' : 'Afficher colonne Étage';
}

function applyFloorColumnVisibility() {
  const display = _floorColumnVisible ? '' : 'none';
  const w = _floorColumnVisible ? '30px' : '0';
  // Colgroup col
  const col = document.querySelector('#rooms-table colgroup col.th-floor');
  if (col) { col.style.width = w; col.style.display = display; }
  // En-tête
  const thFloor = document.querySelector('#rooms-table thead th.th-floor');
  if (thFloor) thFloor.style.display = display;
  // Cellules de données
  document.querySelectorAll('#rooms-tbody td.cell-floor').forEach(td => {
    td.style.display = display;
  });
}

// ══════════════════════════════════════════════════════════════
// ZONE B — Colonnes par FDC
// ══════════════════════════════════════════════════════════════
function renderEmployeeColumns(employees, options) {
  const container = document.getElementById('fdc-columns');
  const distCount = document.getElementById('distributed-count');

  const activeFDC   = employees.filter(e => !e.isGouvernante);
  const gouvernante = employees.find(e => e.isGouvernante);

  // Moyennes pour détecter déséquilibres
  const allStats   = activeFDC.map(e => calcStats(e));
  const avg = (fn) => allStats.reduce((s, st) => s + fn(st), 0) / (activeFDC.length || 1);
  const avgD  = avg(st => st.departs);
  const avgR  = avg(st => st.recouches);
  const avgTw = avg(st => st.twins);
  const avgGL = avg(st => st.grandLits);

  // Nombre d'étages distincts par FDC (pour affichage)
  const floorCount = (emp) => new Set(emp.rooms.map(r => r.floor)).size;

  const totalDist = employees.reduce((s, e) => s + e.rooms.length, 0);
  distCount.textContent = `${totalDist} attribuée${totalDist !== 1 ? 's' : ''}`;

  const buildColumn = (employee, isGouvernante = false) => {
    const stats = calcStats(employee);
    const THRESHOLD = 1.5;

    const isImbalanced = !isGouvernante && activeFDC.length > 1 && (
      (avgD > 0 && Math.abs(stats.departs   - avgD)  > THRESHOLD) ||
      (avgR > 0 && Math.abs(stats.recouches - avgR)  > THRESHOLD) ||
      (options.balanceBedType && (
        (avgTw > 0 && Math.abs(stats.twins    - avgTw) > THRESHOLD) ||
        (avgGL > 0 && Math.abs(stats.grandLits- avgGL) > THRESHOLD)
      ))
    );

    const nbFloors  = floorCount(employee);
    const floorList = [...new Set(employee.rooms.map(r => r.floor))].sort((a, b) => a - b);

    const sortedRooms = [...employee.rooms].sort((a, b) =>
      a.floor - b.floor ||
      a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true })
    );

    const bedStatsHtml = options.balanceBedType ? `
      <span class="stat-item stat-twin"  title="Twin">${stats.twins} TW</span>
      <span class="stat-item stat-gl"    title="Grand lit">${stats.grandLits} GL</span>
    ` : '';

    const floorsBadge = !isGouvernante && nbFloors > 0
      ? `<span class="floors-badge" title="Étages : ${floorList.join(', ')}">Ét. ${floorList.join('·')}</span>`
      : '';

    return `
      <div class="fdc-column ${isImbalanced ? 'imbalanced' : ''} ${isGouvernante ? 'fdc-gouvernante' : ''}"
           data-employee-id="${escapeHtml(employee.id)}"
           ondragover="handleDragOver(event)"
           ondragleave="handleDragLeave(event)"
           ondrop="handleDrop(event, '${escapeHtml(employee.id)}')">

        <div class="fdc-header">
          ${isGouvernante ? '<span class="gov-crown" title="Gouvernante">👑</span>' : ''}
          <span class="fdc-name ${isGouvernante ? 'gouvernante-label' : ''}"
                contenteditable="true"
                spellcheck="false"
                data-employee-id="${escapeHtml(employee.id)}"
                onblur="renameEmployee('${escapeHtml(employee.id)}', this.textContent.trim())"
                onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur()}"
          >${escapeHtml(employee.name)}</span>
          ${isImbalanced ? '<span class="imbalance-indicator" title="Déséquilibre détecté">⚠</span>' : ''}
          ${!isGouvernante ? `<button class="btn-remove-fdc" onclick="removeEmployee('${escapeHtml(employee.id)}')" title="Supprimer">✕</button>` : ''}
        </div>

        <div class="fdc-stats">
          <span class="stat-item stat-depart"   title="Départs">${stats.departs} D</span>
          <span class="stat-item stat-recouche"  title="Recouches">${stats.recouches} R</span>
          <span class="stat-item stat-total"     title="Total">${stats.total} T</span>
          ${bedStatsHtml}
          ${floorsBadge}
        </div>

        <div class="fdc-rooms"
             data-employee-id="${escapeHtml(employee.id)}"
             ondragover="handleDragOver(event)"
             ondragleave="handleDragLeave(event)"
             ondrop="handleDrop(event, '${escapeHtml(employee.id)}')">
          ${sortedRooms.length > 0
            ? sortedRooms.map(r => renderRoomCard(r)).join('')
            : '<p class="pool-empty">Aucune chambre</p>'
          }
        </div>
      </div>
    `;
  };

  const fdcHTML         = activeFDC.map(e => buildColumn(e, false)).join('');
  const gouvernanteHTML = (options.gouvernanteActive && gouvernante)
    ? buildColumn(gouvernante, true)
    : '';

  container.innerHTML = fdcHTML + gouvernanteHTML;
}

// ── Carte chambre ─────────────────────────────────────────────
// draggable=true uniquement pour les cartes DANS les colonnes FDC
// (pas pour les cartes du pool non attribué)
function renderRoomCard(room, draggable = true) {
  const statusClass =
    room.blocked             ? 'blocked'          :
    room.status === 'DEPART'   ? 'status-depart'   :
    room.status === 'RECOUCHE' ? 'status-recouche' :
    room.status === 'PROPRE'   ? 'status-propre'   : '';

  const dragAttrs = draggable
    ? `draggable="true" ondragstart="handleDragStart(event, '${escapeHtml(room.id)}')"`
    : '';

  return `
    <div class="room-card ${statusClass}"
         ${dragAttrs}
         data-room-id="${escapeHtml(room.id)}">
      <div class="room-card-main">
        <span class="room-number">${escapeHtml(room.roomNumber)}</span>
        <span class="room-floor">Ét.${room.floor}</span>
        ${statusBadge(room.status, room.blocked)}
        ${bedTypeBadge(room.bedType)}
      </div>
    </div>
  `;
}

// ── Zone C : Pool non attribuées / Bloquées ───────────────────
function renderUnassignedPool(rooms, employees) {
  const unassignedEl  = document.getElementById('unassigned-pool');
  const blockedEl     = document.getElementById('blocked-pool');
  const unassignedCnt = document.getElementById('unassigned-count');
  const blockedCnt    = document.getElementById('blocked-count');

  const assignedIds = new Set();
  employees.forEach(e => e.rooms.forEach(r => assignedIds.add(r.id)));

  const unassigned = rooms.filter(r => !r.blocked && !assignedIds.has(r.id));
  const blocked    = rooms.filter(r => r.blocked);

  unassignedCnt.textContent = unassigned.length;
  blockedCnt.textContent    = blocked.length;

  // Pool : pas de drag (draggable=false)
  unassignedEl.innerHTML = unassigned.length > 0
    ? unassigned.map(r => renderRoomCard(r, false)).join('')
    : '<p class="pool-empty">Toutes les chambres sont attribuées</p>';

  blockedEl.innerHTML = blocked.length > 0
    ? blocked.map(r => renderRoomCard(r, false)).join('')
    : '<p class="pool-empty">Aucune chambre bloquée</p>';
}

// ── Rendu global ──────────────────────────────────────────────
function renderAll(state) {
  renderRoomsTable(state.rooms);
  renderEmployeeColumns(state.employees, state.options);
  renderUnassignedPool(state.rooms, state.employees);

  const hasRooms = state.rooms.length > 0;
  document.getElementById('btn-distribute').disabled   = !hasRooms;
  document.getElementById('btn-export-pdf').disabled   = !hasRooms;
  document.getElementById('btn-export-excel').disabled = !hasRooms;

  // Afficher le bloc Max D/R seulement si gouvernante active
  const maxDrBlock = document.getElementById('options-maxdr');
  if (maxDrBlock) {
    maxDrBlock.classList.toggle('visible', !!state.options.gouvernanteActive);
  }

  const opts = state.options;
  const parts = [];
  if (opts.balanceBedType)    parts.push('Twin/GL équilibré');
  if (opts.ignoreFloor)       parts.push('Étages ignorés');
  if (opts.gouvernanteActive) {
    const maxD = opts.maxDeparts  ? `max ${opts.maxDeparts}D` : '';
    const maxR = opts.maxRecouches? `max ${opts.maxRecouches}R` : '';
    parts.push('Gouvernante active' + (maxD || maxR ? ` (${[maxD,maxR].filter(Boolean).join(', ')})` : ''));
  }
  const el = document.getElementById('options-summary');
  if (el) el.textContent = parts.join(' · ');
}

// ── Toggle panneau options (engrenage) ────────────────────────
function toggleOptionsPanel() {
  const bar = document.getElementById('options-bar');
  const btn = document.getElementById('btn-options-toggle');
  const hidden = bar.classList.toggle('options-hidden');
  btn.classList.toggle('active', !hidden);
}

// ── Toggle collapse Zone A ────────────────────────────────────
function toggleZoneRooms() {
  const wrapper = document.getElementById('rooms-table-wrapper');
  const btn     = document.getElementById('btn-collapse-rooms');
  const collapsed = wrapper.classList.toggle('collapsed');
  btn.classList.toggle('collapsed', collapsed);
  btn.textContent = collapsed ? '▶' : '▼';
}

// ── Toast ─────────────────────────────────────────────────────
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  void toast.offsetWidth;
  toast.classList.add('visible');
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}
