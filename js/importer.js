/**
 * importer.js — Import et parsing du fichier des chambres du jour
 *
 * FORMAT PRINCIPAL (étape 2) — PDF « Rapport Détail Gouvernante » (Oracle OPERA)
 *   Voir parsePdf() + parseGouvernanteReport() plus bas.
 *   Colonnes lues : Num. cham, Type, Statut (propreté), Statut FO, Statut de réservation
 *   Règle de décision (ordre : Statut FO → Statut de réservation → Statut propreté) :
 *     OCC + « Due Out »                       → DEPART
 *     OCC + autre (Stayover, Arrived, …)      → RECOUCHE
 *     VAC + « Departed » (incl. Departed/Arrival) → DEPART
 *     VAC + autre  →  propreté : Clean → PROPRE / Dirty → DEPART / Out of Order → BLOQUÉ
 *   La 2ᵉ ligne « DEP(Linen Change) » est ignorée.
 *   bedType : dernier chiffre 7→GL_SIMPLE, 9→GL_DOUBLE (auto) ; sinon NONE
 *             (GL/TW jamais pré-coché — la gouvernante choisit manuellement).
 *   Note : TRI→Triple, QAD→Quadruple, SAE→Suite.
 *   Exclues : type PF, chambre 9610, lignes sans numéro.
 *
 * FORMATS EXCEL (hérités, conservés en secours via parseRoomsFile) :
 *
 * FORMAT A — Export PMS hôtel (ibis/Accor style)
 *   Détecté si le fichier contient "N° Chambre" ou "Etat" dans les en-têtes
 *   Colonnes utilisées : N° Chambre, Type Chambre, Etat, Statut séjour
 *   Le n° de chambre suffit pour déduire l'étage (101→1, 201→2, etc.)
 *   Mapping Etat + Statut séjour → status FDC :
 *     OCC-Sal + "Départ attendu"  → DEPART
 *     OCC-Sal + "Présent"         → RECOUCHE
 *     LIB-Sal                     → DEPART  (chambre libérée, besoin nettoyage)
 *     LIB-Prp                     → PROPRE
 *     HS-*                        → BLOQUÉ
 *   Type Chambre → bedType :
 *     TWI         → TWIN
 *     DBL, SAE    → GRAND_LIT
 *     TRI, QAD    → NONE (chambres spéciales)
 *
 * FORMAT B — Fichier manuel utilisateur
 *   En-têtes en ligne 0 : Chambre, Étage, Départ, Recouche, Propre, Grand lit, Twin, Bloqué
 *   Valeurs : x / 1 / TRUE / oui / yes
 */

// ── Détection de l'étage depuis le numéro de chambre ─────────
// Convention hôtelière : les 2 premiers chiffres = étage
// 101 → 1, 212 → 2, 301 → 3, 1205 → 12
function deriveFloor(roomNumber) {
  const digits = String(roomNumber).replace(/[^0-9]/g, '');
  if (digits.length >= 3) {
    return parseInt(digits.slice(0, digits.length - 2)) || 0;
  }
  return 0;
}

// ── Normalisation booléenne (format manuel) ───────────────────
const TRUE_VALUES = new Set(['x', '1', 'true', 'oui', 'yes', 'o', 'vrai', 'v', '✓', '✔']);

function normalizeBoolean(val) {
  if (val === null || val === undefined || val === '') return false;
  return TRUE_VALUES.has(String(val).toLowerCase().trim());
}

// ── Cherche la ligne d'en-tête dans le tableau ────────────────
// Retourne l'index de la ligne (ou -1 si non trouvé)
function findHeaderRow(rows, keywords) {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const rowStr = rows[i].join('|').toLowerCase();
    if (keywords.every(kw => rowStr.includes(kw))) {
      return i;
    }
  }
  return -1;
}

// ── Trouver l'index d'une colonne dans la ligne d'en-tête ─────
function colIndex(headerRow, ...aliases) {
  for (let i = 0; i < headerRow.length; i++) {
    const cell = String(headerRow[i]).toLowerCase().trim();
    for (const alias of aliases) {
      if (cell.includes(alias.toLowerCase())) return i;
    }
  }
  return -1;
}

// ══════════════════════════════════════════════════════════════
// FORMAT A — Parsing PMS hôtel
// ══════════════════════════════════════════════════════════════
function parsePmsFormat(rows, headerRowIdx) {
  const header = rows[headerRowIdx];

  // Indices des colonnes
  const iRoom    = colIndex(header, 'n° chambre', 'chambre', 'room');
  const iType    = colIndex(header, 'type chambre', 'type');
  const iEtat    = colIndex(header, 'etat', 'état', 'state');
  const iStatut  = colIndex(header, 'statut séjour', 'statut sejour', 'statut', 'status');
  const iChgDrap = colIndex(header, 'chg. draps', 'chg draps', 'draps');

  if (iRoom === -1) throw new Error('Colonne "N° Chambre" introuvable dans le fichier PMS.');
  if (iEtat === -1) throw new Error('Colonne "Etat" introuvable dans le fichier PMS.');

  const rooms = [];

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];

    const roomNum = String(row[iRoom] || '').trim();
    if (!roomNum || !/\d/.test(roomNum)) continue; // ignorer lignes sans numéro de chambre

    const typeChambre = String(row[iType] || '').trim().toUpperCase();
    const etat        = String(row[iEtat] || '').trim();
    const statutSej   = iStatut !== -1 ? String(row[iStatut] || '').trim() : '';
    const chgDraps    = iChgDrap !== -1 ? String(row[iChgDrap] || '').trim() : '';

    // ── Statut bloqué ────────────────────────────────────────
    const blocked = etat.toUpperCase().startsWith('HS');

    // ── Status chambre ────────────────────────────────────────
    let status = 'NONE';
    if (!blocked) {
      const etatUp   = etat.toUpperCase();
      const statutUp = statutSej.toLowerCase();

      if (etatUp === 'OCC-SAL') {
        if (statutUp.includes('départ') || statutUp.includes('depart')) {
          status = 'DEPART';
        } else if (statutUp.includes('présent') || statutUp.includes('present')) {
          status = 'RECOUCHE';
        } else {
          // OCC-Sal sans statut précis → Recouche par défaut
          status = 'RECOUCHE';
        }
      } else if (etatUp === 'LIB-SAL') {
        // Libre mais sale = chambre libérée, besoin nettoyage = Départ
        status = 'DEPART';
      } else if (etatUp === 'LIB-PRP') {
        status = 'PROPRE';
      } else if (etatUp === 'OCC-PRP') {
        // Occupée-Propre (cas rare) = Recouche déjà nettoyée, on l'affiche comme Recouche
        status = 'RECOUCHE';
      }
    }

    // ── Type de lit ───────────────────────────────────────────
    // Règle hôtel : dernier chiffre 7 → GL + 1 lit simple, 9 → GL + 2 lits simples.
    // Sinon, bedType = NONE (l'utilisateur définit GL/TW manuellement).
    const lastDigit = roomNum.slice(-1);
    const bedType = lastDigit === '7' ? 'GL_SIMPLE'
                  : lastDigit === '9' ? 'GL_DOUBLE'
                  : 'NONE';

    // ── Étage déduit du numéro de chambre ─────────────────────
    const floor = deriveFloor(roomNum);

    // ── Note enrichie ─────────────────────────────────────────
    let note = '';
    if (typeChambre === 'TRI') note = 'Triple';
    else if (typeChambre === 'QAD') note = 'Quadruple';
    else if (typeChambre === 'SAE') note = 'Suite';
    if (chgDraps === 'X' || chgDraps === 'x') {
      note = note ? note + ' · Chg. Draps' : 'Chg. Draps';
    }

    rooms.push({
      id:         `room-${i}-${roomNum}`,
      roomNumber: roomNum,
      floor,
      status:     blocked ? 'NONE' : status,
      bedType,
      blocked,
      note,
      assignedTo: null
    });
  }

  return rooms;
}

// ══════════════════════════════════════════════════════════════
// FORMAT B — Parsing fichier manuel utilisateur
// ══════════════════════════════════════════════════════════════

// Variantes d'en-têtes acceptées
const MANUAL_ALIASES = {
  roomNumber: ['chambre', 'room', 'n° chambre', 'numero', 'numéro', 'n°'],
  floor:      ['étage', 'etage', 'floor', 'niveau', 'niv'],
  depart:     ['départ', 'depart', 'dep', 'dép', 'checkout'],
  recouche:   ['recouche', 'rec', 'séjour', 'sejour', 'stayover'],
  propre:     ['propre', 'prop', 'clean', 'vide'],
  grandLit:   ['grand lit', 'grandlit', 'gl', 'grand-lit', 'double'],
  twin:       ['twin', 'tw', 'lits jumeaux'],
  blocked:    ['bloqué', 'bloque', 'hors service', 'hs', 'blocked', 'maintenance'],
  note:       ['remarque', 'note', 'notes', 'commentaire', 'comment']
};

function findManualColumnKey(header) {
  const h = String(header).toLowerCase().trim();
  for (const [key, aliases] of Object.entries(MANUAL_ALIASES)) {
    for (const alias of aliases) {
      if (h === alias || h.includes(alias) || alias.includes(h)) {
        return key;
      }
    }
  }
  return null;
}

function parseManualFormat(rows, headerRowIdx) {
  const header = rows[headerRowIdx];
  const colMap = {}; // clé interne → index de colonne

  header.forEach((h, idx) => {
    const key = findManualColumnKey(h);
    if (key && !(key in colMap)) colMap[key] = idx;
  });

  const missing = ['roomNumber'].filter(k => !(k in colMap));
  if (missing.length > 0) {
    throw new Error(
      `Colonne introuvable : Chambre.\nEn-têtes détectés : ${header.filter(Boolean).join(', ')}`
    );
  }

  const get = (row, key) => (key in colMap) ? (row[colMap[key]] ?? '') : '';

  const rooms = [];

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.every(c => c === '' || c == null)) continue;

    const roomNum = String(get(row, 'roomNumber')).trim();
    if (!roomNum) continue;

    const isDepart   = normalizeBoolean(get(row, 'depart'));
    const isRecouche = normalizeBoolean(get(row, 'recouche'));
    const isPropre   = normalizeBoolean(get(row, 'propre'));

    let status = 'NONE';
    if (isDepart)        status = 'DEPART';
    else if (isRecouche) status = 'RECOUCHE';
    else if (isPropre)   status = 'PROPRE';

    const isGrandLit = normalizeBoolean(get(row, 'grandLit'));
    const isTwin     = normalizeBoolean(get(row, 'twin'));
    let bedType = 'NONE';
    if (isGrandLit)  bedType = 'GRAND_LIT';
    else if (isTwin) bedType = 'TWIN';
    // Règle hôtel prioritaire : dernier chiffre 7/9 → type auto
    const lastDigit = roomNum.slice(-1);
    if (lastDigit === '7') bedType = 'GL_SIMPLE';
    else if (lastDigit === '9') bedType = 'GL_DOUBLE';

    const blocked = normalizeBoolean(get(row, 'blocked'));

    // Étage : depuis la colonne ou déduit du numéro
    const floorRaw = get(row, 'floor');
    const floor = floorRaw
      ? parseInt(String(floorRaw).replace(/[^0-9-]/g, '')) || deriveFloor(roomNum)
      : deriveFloor(roomNum);

    rooms.push({
      id:         `room-${i}-${roomNum}`,
      roomNumber: roomNum,
      floor,
      status:     blocked ? 'NONE' : status,
      bedType,
      blocked,
      note:       String(get(row, 'note') || '').trim(),
      assignedTo: null
    });
  }

  return rooms;
}

// ══════════════════════════════════════════════════════════════
// FORMAT PDF — Rapport Détail Gouvernante (Oracle OPERA)
// ══════════════════════════════════════════════════════════════

// Configuration du worker pdf.js (chargé depuis le même CDN que la lib)
if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

const PDF_ROOM_TYPES = new Set(['TWI', 'TRI', 'QAD', 'DBL', 'SAE', 'PF']);

/**
 * Extrait le texte d'un PDF et le reconstruit en lignes visuelles.
 * Chaque item de texte est regroupé par coordonnée Y (même ligne),
 * puis trié par X (ordre des colonnes de gauche à droite).
 *
 * @param {File} file
 * @returns {Promise<Array<{ y: number, text: string, cells: Array<{str:string,x:number}> }>>}
 */
async function extractPdfLines(file) {
  if (!window.pdfjsLib) {
    throw new Error('pdf.js non chargé. Vérifiez votre connexion internet.');
  }

  const buffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;

  const lines = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();

    const items = content.items
      .filter(it => it.str && it.str.trim() !== '')
      .map(it => ({ str: it.str.trim(), x: it.transform[4], y: it.transform[5] }))
      .sort((a, b) => (b.y - a.y) || (a.x - b.x));

    let current = null;
    for (const it of items) {
      if (!current || Math.abs(current.y - it.y) > 3) {
        current = { y: it.y, cells: [] };
        lines.push(current);
      }
      current.cells.push({ str: it.str, x: it.x });
    }
  }

  return lines.map(l => ({
    y: l.y,
    cells: l.cells,
    text: l.cells.map(c => c.str).join(' ').replace(/\s+/g, ' ').trim()
  }));
}

// ── Décision : Statut FO + Statut de réservation + propreté → statut FDC ──
function statusFromGouvernante(statutFo, reservation, cleanliness) {
  const fo    = statutFo.toUpperCase();
  const res   = reservation.toLowerCase();
  const clean = cleanliness.toLowerCase();

  if (fo === 'OCC') {
    if (res.includes('due out')) return { status: 'DEPART', blocked: false };
    return { status: 'RECOUCHE', blocked: false };
  }

  // VAC
  if (res.includes('depart')) return { status: 'DEPART', blocked: false }; // Departed, Departed/Arrival

  // VAC + reste (Not Reserved, Arrival…) → on regarde la propreté
  if (clean.includes('out of order') || clean.includes('order')) return { status: 'NONE', blocked: true };
  if (clean.includes('dirty')) return { status: 'DEPART', blocked: false };
  return { status: 'PROPRE', blocked: false }; // Clean (ou vide) → propre
}

/**
 * Transforme les lignes extraites du PDF en tableau de Room[].
 * @param {Array<{text:string, cells:Array}>} lines
 * @returns {Array}
 */
function parseGouvernanteReport(lines) {
  const headerFound = lines.some(l => {
    const t = l.text.toLowerCase();
    return t.includes('statut fo') || (t.includes('num') && t.includes('statut de r'));
  });
  if (!headerFound) {
    throw new Error(
      'En-tête du « Rapport Détail Gouvernante » introuvable. ' +
      'Vérifiez que le PDF est bien ce rapport (colonnes Num. cham / Type / Statut FO…).'
    );
  }

  const rooms = [];

  for (let i = 0; i < lines.length; i++) {
    const tokens = lines[i].text.split(' ').filter(Boolean);
    if (tokens.length < 3) continue;

    const roomNum = tokens[0];
    if (!/^\d{3,4}$/.test(roomNum)) continue; // ignore en-têtes, pieds de page, dates, lignes « DEP(Linen Change) »

    const type = (tokens[1] || '').toUpperCase();
    if (!PDF_ROOM_TYPES.has(type)) continue; // ligne inattendue
    if (type === 'PF' || roomNum === '9610') continue; // fausses chambres

    let rest = tokens.slice(2).join(' ');

    // ── Statut propreté (début du reste) ─────────────────────
    let cleanliness = '';
    const mClean = rest.match(/^(Out of Order|Dirty|Clean)\b\s*/i);
    if (mClean) {
      cleanliness = mClean[1];
      rest = rest.slice(mClean[0].length);
    }

    // ── Statut FO ────────────────────────────────────────────
    let statutFo = '';
    const mFo = rest.match(/^(OCC|VAC)\b\s*/i);
    if (mFo) {
      statutFo = mFo[1].toUpperCase();
      rest = rest.slice(mFo[0].length);
    } else {
      continue; // pas de statut FO exploitable
    }

    // ── Statut de réservation (reste), « DEP(Linen Change) » retiré ──
    const reservation = rest
      .replace(/DEP\s*\(\s*Linen Change\s*\)/ig, '')
      .replace(/\s+/g, ' ')
      .trim();

    const { status, blocked } = statusFromGouvernante(statutFo, reservation, cleanliness);

    // ── Type de lit ──────────────────────────────────────────
    // Règle hôtel : dernier chiffre 7 → GL + 1 lit simple, 9 → GL + 2 lits simples (auto, non modifiable).
    // Sinon bedType = NONE : la gouvernante coche GL ou TW manuellement (jamais pré-coché à l'import).
    const lastDigit = roomNum.slice(-1);
    let bedType = 'NONE';
    if (lastDigit === '7')      bedType = 'GL_SIMPLE';
    else if (lastDigit === '9') bedType = 'GL_DOUBLE';

    // ── Note ─────────────────────────────────────────────────
    let note = '';
    if (type === 'TRI')      note = 'Triple';
    else if (type === 'QAD') note = 'Quadruple';
    else if (type === 'SAE') note = 'Suite';

    rooms.push({
      id:         `room-${i}-${roomNum}`,
      roomNumber: roomNum,
      floor:      deriveFloor(roomNum),
      status:     blocked ? 'NONE' : status,
      bedType,
      blocked,
      note,
      assignedTo: null
    });
  }

  return rooms;
}

async function parsePdf(file) {
  const lines = await extractPdfLines(file);
  const rooms = parseGouvernanteReport(lines);
  if (rooms.length === 0) {
    throw new Error('Aucune chambre valide trouvée dans le PDF.');
  }
  rooms.sort((a, b) =>
    a.floor - b.floor ||
    a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true })
  );
  return { rooms, format: 'PDF — Rapport Détail Gouvernante' };
}

// ══════════════════════════════════════════════════════════════
// POINT D'ENTRÉE PRINCIPAL
// ══════════════════════════════════════════════════════════════
/**
 * Parse le fichier des chambres du jour et retourne { rooms, format }.
 * PDF « Rapport Détail Gouvernante » par défaut ; .xls/.xlsx en secours.
 *
 * @param {File} file
 * @returns {Promise<{ rooms: Array, format: string }>}
 */
function parseRoomsFile(file) {
  const name = (file && file.name ? file.name : '').toLowerCase();
  if (name.endsWith('.pdf')) {
    return parsePdf(file);
  }
  return parseExcel(file);
}

/**
 * Parse un fichier .xls ou .xlsx et retourne un tableau de Room[]
 * Détecte automatiquement le format (PMS ou manuel)
 *
 * @param {File} file
 * @returns {Promise<{ rooms: Array, format: string }>}
 */
function parseExcel(file) {
  return new Promise((resolve, reject) => {
    if (!window.XLSX) {
      reject(new Error('SheetJS non chargé. Vérifiez votre connexion internet.'));
      return;
    }

    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });

        // Première feuille
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        // Tableau 2D brut
        const rows = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          defval: '',
          raw: false
        });

        if (rows.length < 2) {
          reject(new Error('Le fichier est vide ou ne contient pas de données.'));
          return;
        }

        // ── Détection automatique du format ──────────────────
        // FORMAT A : recherche "n° chambre" + "etat" dans les 25 premières lignes
        const pmsHeaderIdx = findHeaderRow(rows, ['n° chambre', 'etat']);
        const pmsAltIdx    = findHeaderRow(rows, ['chambre', 'statut séjour']);

        let rooms;
        let format;

        if (pmsHeaderIdx !== -1) {
          rooms  = parsePmsFormat(rows, pmsHeaderIdx);
          format = 'PMS (export hôtel)';
        } else if (pmsAltIdx !== -1) {
          rooms  = parsePmsFormat(rows, pmsAltIdx);
          format = 'PMS (export hôtel)';
        } else {
          // FORMAT B : cherche "chambre" dans les 5 premières lignes
          const manualIdx = findHeaderRow(rows, ['chambre']);
          if (manualIdx !== -1) {
            rooms  = parseManualFormat(rows, manualIdx);
            format = 'Manuel';
          } else {
            // Dernier essai : supposer que la ligne 0 est l'en-tête
            rooms  = parseManualFormat(rows, 0);
            format = 'Manuel (auto)';
          }
        }

        if (rooms.length === 0) {
          reject(new Error('Aucune chambre valide trouvée dans le fichier.'));
          return;
        }

        // Tri final : étage ASC, puis numéro naturel
        rooms.sort((a, b) =>
          a.floor - b.floor ||
          a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true })
        );

        resolve({ rooms, format });

      } catch (err) {
        reject(new Error('Erreur lecture fichier : ' + err.message));
      }
    };

    reader.onerror = () => reject(new Error('Impossible de lire le fichier.'));
    reader.readAsArrayBuffer(file);
  });
}
