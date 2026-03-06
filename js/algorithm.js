/**
 * algorithm.js — Algorithme de répartition équitable des chambres
 *
 * Priorités (ordre strict) :
 *  P1 : Équilibre RECOUCHES entre FDCs (distribuer en premier)
 *  P2 : Chaque FDC travaille sur le MOINS d'étages possible
 *  P3 : Équilibre DÉPARTS entre FDCs
 *  P4 : Équilibre Twin / Grand lit (toujours actif)
 *
 * Stratégie two-phase :
 *  Phase 1 — Recouches : score = équilibre R fort + regroupement étage léger
 *  Phase 2 — Départs   : score = regroupement étage fort (sur les étages déjà pris) + équilibre D
 *
 * Avec gouvernante : si maxRecouches/maxDeparts → FDC limitée, gouvernante reçoit le surplus
 */

// ── Charge pondérée ──────────────────────────────────────────
function calcLoad(rooms) {
  return rooms.reduce((sum, r) => {
    if (r.status === 'DEPART')   return sum + 3;
    if (r.status === 'RECOUCHE') return sum + 2;
    return sum;
  }, 0);
}

// ── Statistiques d'un employé ────────────────────────────────
function calcStats(employee) {
  const rooms = employee.rooms || [];
  return {
    total:     rooms.length,
    departs:   rooms.filter(r => r.status === 'DEPART').length,
    recouches: rooms.filter(r => r.status === 'RECOUCHE').length,
    propres:   rooms.filter(r => r.status === 'PROPRE').length,
    twins:     rooms.filter(r => r.bedType === 'TWIN').length,
    grandLits: rooms.filter(r => r.bedType === 'GRAND_LIT').length,
    load:      calcLoad(rooms)
  };
}

// ── Score d'attribution ──────────────────────────────────────
/**
 * Calcule le coût d'assigner `room` à `employee`.
 * Score plus bas = meilleur choix.
 *
 * @param {string} phase - 'recouche' ou 'depart'
 */
function scoreAssignment(employee, room, options, targets, phase) {
  const rooms     = employee.rooms;
  const recouches = rooms.filter(r => r.status === 'RECOUCHE').length;
  const departs   = rooms.filter(r => r.status === 'DEPART').length;
  const myFloors  = new Set(rooms.map(r => r.floor));

  let score = 0;

  if (phase === 'recouche') {
    // ── P1 (fort) : Équilibre Recouches
    const ecart = recouches - targets.recouches;
    if (ecart >= 0) score += 600 * (ecart + 1);
    else            score -= 30 * Math.abs(ecart); // léger avantage si en-dessous

    // ── P2 (secondaire) : Regroupement par étage
    if (!options.ignoreFloor) {
      if (myFloors.has(room.floor)) {
        score -= 200; // bonus modéré : même étage déjà tenu
      } else if (myFloors.size > 0) {
        score += 60 * myFloors.size; // pénalité par nouvel étage
      }
    }

  } else {
    // phase === 'depart'

    // ── P1 (très fort) : Regroupement par étage
    // Les étages ont déjà été "capturés" par les Recouches → les Départs suivent naturellement
    if (!options.ignoreFloor) {
      if (myFloors.has(room.floor)) {
        score -= 500; // fort bonus : même étage
      } else if (myFloors.size === 0) {
        score += 0;   // FDC sans chambre → neutre
      } else {
        score += 80 * myFloors.size; // pénalité progressive
      }
    }

    // ── P3 (secondaire) : Équilibre Départs
    const ecart = departs - targets.departs;
    if (ecart >= 0) score += 350 * (ecart + 1);
    else            score -= 20 * Math.abs(ecart);
  }

  // ── P4 : Équilibre Twin / Grand lit (toujours actif)
  if (room.bedType !== 'NONE') {
    const currentBed = rooms.filter(r => r.bedType === room.bedType).length;
    const targetBed  = room.bedType === 'TWIN' ? targets.twins : targets.grandLits;
    if (currentBed > targetBed) {
      score += 250 * (currentBed - targetBed);
    }
  }

  // Léger bonus charge globale (tie-breaker)
  score += calcLoad(rooms) * 0.5;

  return score;
}

// ── Trouver le meilleur employé pour une chambre ─────────────
function pickBest(fdcList, room, options, targets, phase) {
  let best      = fdcList[0];
  let bestScore = Infinity;

  for (const fdc of fdcList) {
    const s = scoreAssignment(fdc, room, options, targets, phase);
    if (s < bestScore) { bestScore = s; best = fdc; }
  }
  return best;
}

// ── Tri par étage puis numéro ─────────────────────────────────
function sortByFloor(rooms) {
  return [...rooms].sort((a, b) =>
    a.floor - b.floor ||
    a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true })
  );
}

// ── Distribution principale ───────────────────────────────────
/**
 * @param {Array}  rooms     - Toutes les chambres
 * @param {Array}  employees - Toutes les employées
 * @param {Object} options   - { balanceBedType, ignoreFloor, gouvernanteActive, maxDeparts, maxRecouches }
 * @returns {Array}          - Employées avec rooms assignées
 */
function distributeRooms(rooms, employees, options) {
  const allEmployees = employees.map(e => ({ ...e, rooms: [] }));
  const activeFDC    = allEmployees.filter(e => !e.isGouvernante && e.active !== false);
  const gouvernante  = allEmployees.find(e => e.isGouvernante);

  if (activeFDC.length === 0) return allEmployees;

  // ── Étape 1 : Filtrer les chambres distribuables ───────────
  const eligible = rooms.filter(r => !r.blocked && r.status !== 'PROPRE' && r.status !== 'NONE');

  const recoucheRooms = sortByFloor(eligible.filter(r => r.status === 'RECOUCHE'));
  const departRooms   = sortByFloor(eligible.filter(r => r.status === 'DEPART'));

  const n = activeFDC.length;

  // ── Étape 2 : Cibles par FDC ───────────────────────────────
  const totalTwins    = eligible.filter(r => r.bedType === 'TWIN').length;
  const totalGrandLits= eligible.filter(r => r.bedType === 'GRAND_LIT').length;

  const targets = {
    recouches: recoucheRooms.length / n,
    departs:   departRooms.length   / n,
    twins:     totalTwins    / n,
    grandLits: totalGrandLits / n
  };

  // ── Étape 3 : PHASE 1 — Distribuer les Recouches (équilibre R en priorité)
  for (const room of recoucheRooms) {
    // Filtrer FDC qui n'ont pas atteint leur max Recouches
    const available = activeFDC.filter(fdc => {
      if (options.gouvernanteActive && options.maxRecouches) {
        return fdc.rooms.filter(r => r.status === 'RECOUCHE').length < options.maxRecouches;
      }
      return true;
    });

    if (available.length > 0) {
      const best = pickBest(available, room, options, targets, 'recouche');
      best.rooms.push({ ...room, assignedTo: best.id });
    } else if (gouvernante && options.gouvernanteActive) {
      // Limite atteinte → gouvernante
      gouvernante.rooms.push({ ...room, assignedTo: gouvernante.id });
    } else {
      // Pas de gouvernante → forcer sur la moins chargée
      const best = pickBest(activeFDC, room, options, targets, 'recouche');
      best.rooms.push({ ...room, assignedTo: best.id });
    }
  }

  // ── Étape 4 : PHASE 2 — Distribuer les Départs (regroupement étage en priorité)
  // Les FDC ont déjà leurs étages "ancrés" par les Recouches → les Départs viennent se greffer
  for (const room of departRooms) {
    // Filtrer FDC qui n'ont pas atteint leur max Départs
    const available = activeFDC.filter(fdc => {
      if (options.gouvernanteActive && options.maxDeparts) {
        return fdc.rooms.filter(r => r.status === 'DEPART').length < options.maxDeparts;
      }
      return true;
    });

    if (available.length > 0) {
      const best = pickBest(available, room, options, targets, 'depart');
      best.rooms.push({ ...room, assignedTo: best.id });
    } else if (gouvernante && options.gouvernanteActive) {
      gouvernante.rooms.push({ ...room, assignedTo: gouvernante.id });
    } else {
      const best = pickBest(activeFDC, room, options, targets, 'depart');
      best.rooms.push({ ...room, assignedTo: best.id });
    }
  }

  // ── Étape 5 : Équilibrage D/R (TOUJOURS, pas seulement ignoreFloor)
  // Garantit un écart max de 1 sur les Départs et les Recouches entre toutes les FDC.
  // Utilise des déplacements (pas des échanges) pour éviter de créer de nouveaux déséquilibres.
  if (activeFDC.length > 1) {
    balanceByMove(activeFDC, 'DEPART',   options);
    balanceByMove(activeFDC, 'RECOUCHE', options);
  }

  // ── Étape 5b : Équilibrage du total de chambres par FDC ────
  // Cas non couvert par les deux passes séparées :
  // Si la même FDC est courte en D ET en R → D=±1, R=±1 mais total=±2.
  // Preuve : si total_over > total_under+1, nécessairement overD>underD OU overR>underR
  // → il existe toujours un déplacement sûr qui préserve D±1 et R±1.
  if (activeFDC.length > 1) {
    balanceTotals(activeFDC);
  }

  // ── Étape 6 : Équilibrage Twin / Grand lit (toujours)
  if (activeFDC.length > 1) {
    balanceBedTypes(activeFDC);
  }

  // ── Étape 6b : Ré-équilibrage D/R + Total après bedType (sécurité)
  // balanceBedTypes utilise la passe cross-status en repli → peut perturber D/R.
  if (activeFDC.length > 1) {
    balanceByMove(activeFDC, 'DEPART',   options);
    balanceByMove(activeFDC, 'RECOUCHE', options);
    balanceTotals(activeFDC);
  }

  // ── Étape 7 : Minimisation des étages par échanges sûrs
  // Échange uniquement des chambres de même status ET même bedType
  // → D/R/TW/GL inchangés, contraintes ±1 préservées
  if (activeFDC.length > 1) {
    optimizeFloors(activeFDC);
  }

  // ── Étape 8 : Optimisation étages pour la gouvernante (si active)
  // Inclut la gouvernante dans les échanges pour grouper ses étages
  if (options.gouvernanteActive && gouvernante && gouvernante.rooms.length > 0 && activeFDC.length > 0) {
    optimizeFloors([...activeFDC, gouvernante]);
  }

  return allEmployees;
}

// ── Équilibrage bed type par échanges ────────────────────────
function balanceBedTypes(activeFDC) {
  const totalTwins    = activeFDC.reduce((s, e) => s + e.rooms.filter(r => r.bedType === 'TWIN').length, 0);
  const totalGrandLits= activeFDC.reduce((s, e) => s + e.rooms.filter(r => r.bedType === 'GRAND_LIT').length, 0);
  const n             = activeFDC.length;
  const targetTwins   = totalTwins / n;
  const targetGLs     = totalGrandLits / n;

  const imbalance = (fdc) => {
    const tw = fdc.rooms.filter(r => r.bedType === 'TWIN').length;
    const gl = fdc.rooms.filter(r => r.bedType === 'GRAND_LIT').length;
    return Math.abs(tw - targetTwins) + Math.abs(gl - targetGLs);
  };

  let improved = true;
  let iterations = 0;

  while (improved && iterations < 100) {
    improved = false;
    iterations++;

    for (let i = 0; i < activeFDC.length; i++) {
      for (let j = i + 1; j < activeFDC.length; j++) {
        const fdc1 = activeFDC[i];
        const fdc2 = activeFDC[j];
        const before = imbalance(fdc1) + imbalance(fdc2);

        const swap = findBeneficialSwap(fdc1, fdc2, targetTwins, targetGLs, before);
        if (swap) {
          const idx1 = fdc1.rooms.findIndex(r => r.id === swap.r1.id);
          const idx2 = fdc2.rooms.findIndex(r => r.id === swap.r2.id);
          fdc1.rooms[idx1] = { ...swap.r2, assignedTo: fdc1.id };
          fdc2.rooms[idx2] = { ...swap.r1, assignedTo: fdc2.id };
          improved = true;
        }
      }
    }
  }
}

function findBeneficialSwap(fdc1, fdc2, targetTwins, targetGLs, imbalanceBefore) {
  const simulateSwap = (r1, r2) => {
    const newR1 = fdc1.rooms.map(r => r.id === r1.id ? r2 : r);
    const newR2 = fdc2.rooms.map(r => r.id === r2.id ? r1 : r);
    const tw1 = newR1.filter(r => r.bedType === 'TWIN').length;
    const gl1 = newR1.filter(r => r.bedType === 'GRAND_LIT').length;
    const tw2 = newR2.filter(r => r.bedType === 'TWIN').length;
    const gl2 = newR2.filter(r => r.bedType === 'GRAND_LIT').length;
    return Math.abs(tw1 - targetTwins) + Math.abs(gl1 - targetGLs) +
           Math.abs(tw2 - targetTwins) + Math.abs(gl2 - targetGLs);
  };

  const bedTypes = ['TWIN', 'GRAND_LIT', 'NONE'];

  // Passe 1 : même status → préserve les compteurs D/R
  for (const bed1 of bedTypes) {
    for (const bed2 of bedTypes) {
      if (bed1 === bed2) continue;
      for (const r1 of fdc1.rooms.filter(r => r.bedType === bed1)) {
        for (const r2 of fdc2.rooms.filter(r => r.bedType === bed2 && r.status === r1.status)) {
          if (simulateSwap(r1, r2) < imbalanceBefore - 0.01) return { r1, r2 };
        }
      }
    }
  }

  // Passe 2 : cross-status (repli si passe 1 insuffisante)
  for (const bed1 of bedTypes) {
    for (const bed2 of bedTypes) {
      if (bed1 === bed2) continue;
      for (const r1 of fdc1.rooms.filter(r => r.bedType === bed1)) {
        for (const r2 of fdc2.rooms.filter(r => r.bedType === bed2 && r.status !== r1.status)) {
          if (simulateSwap(r1, r2) < imbalanceBefore - 0.01) return { r1, r2 };
        }
      }
    }
  }

  return null;
}

/**
 * Équilibrage par déplacements de chambres d'un type donné.
 *
 * Stratégie : tant qu'une FDC a plus de (n+1) chambres du type par rapport
 * à une autre, on déplace une chambre de celle qui a trop vers celle qui a peu.
 * Cela garantit un écart max de 1 sans créer de déséquilibre secondaire.
 *
 * @param {string} statusType - 'DEPART' ou 'RECOUCHE'
 * @param {Object} options    - pour vérifier maxDeparts/maxRecouches
 */
// ── Minimisation des étages par échanges ─────────────────────
function distinctFloors(emp) {
  return new Set(emp.rooms.map(r => r.floor)).size;
}

function optimizeFloors(activeFDC) {
  let improved = true, iter = 0;
  while (improved && iter < 500) {
    improved = false; iter++;
    outer: for (let i = 0; i < activeFDC.length; i++) {
      for (let j = i + 1; j < activeFDC.length; j++) {
        const A = activeFDC[i], B = activeFDC[j];
        const before = distinctFloors(A) + distinctFloors(B);
        for (const rA of A.rooms) {
          for (const rB of B.rooms) {
            // Seulement même status ET même bedType → compteurs inchangés
            if (rA.status !== rB.status || rA.bedType !== rB.bedType) continue;
            if (rA.id === rB.id) continue;
            const afA = new Set([...A.rooms.filter(r => r.id !== rA.id).map(r => r.floor), rB.floor]).size;
            const afB = new Set([...B.rooms.filter(r => r.id !== rB.id).map(r => r.floor), rA.floor]).size;
            if (afA + afB < before) {
              const ia = A.rooms.findIndex(r => r.id === rA.id);
              const ib = B.rooms.findIndex(r => r.id === rB.id);
              A.rooms[ia] = { ...rB, assignedTo: A.id };
              B.rooms[ib] = { ...rA, assignedTo: B.id };
              improved = true; break outer;
            }
          }
        }
      }
    }
  }
}

// ── Équilibrage du total de chambres par FDC ─────────────────
/**
 * Garantit un écart max de 1 sur le total (D+R) par FDC.
 * Ne déplace un D ou R que si la source en a PLUS que la cible,
 * ce qui préserve mathématiquement le ±1 sur D et R.
 */
function balanceTotals(activeFDC) {
  let improved = true, iter = 0;
  while (improved && iter < 200) {
    improved = false; iter++;
    outer: for (let i = 0; i < activeFDC.length; i++) {
      for (let j = 0; j < activeFDC.length; j++) {
        if (i === j) continue;
        const over  = activeFDC[i];
        const under = activeFDC[j];
        if (over.rooms.length - under.rooms.length <= 1) continue;

        const overD  = over.rooms.filter(r => r.status === 'DEPART').length;
        const underD = under.rooms.filter(r => r.status === 'DEPART').length;
        const overR  = over.rooms.filter(r => r.status === 'RECOUCHE').length;
        const underR = under.rooms.filter(r => r.status === 'RECOUCHE').length;

        // Choisir le type dont over > under (déplacement safe pour ±1)
        let statusToMove = null;
        if      (overD > underD) statusToMove = 'DEPART';
        else if (overR > underR) statusToMove = 'RECOUCHE';
        if (!statusToMove) continue;

        const idx = over.rooms.findIndex(r => r.status === statusToMove);
        if (idx === -1) continue;

        const room = over.rooms.splice(idx, 1)[0];
        under.rooms.push({ ...room, assignedTo: under.id });
        improved = true;
        break outer;
      }
    }
  }
}

function balanceByMove(activeFDC, statusType, options) {
  const maxLimit = statusType === 'DEPART'
    ? (options?.gouvernanteActive ? options?.maxDeparts   : null)
    : (options?.gouvernanteActive ? options?.maxRecouches : null);

  let improved = true;
  let iter = 0;

  while (improved && iter < 300) {
    improved = false;
    iter++;

    for (let i = 0; i < activeFDC.length; i++) {
      for (let j = i + 1; j < activeFDC.length; j++) {
        const from = activeFDC[i];
        const to   = activeFDC[j];

        const ci = from.rooms.filter(r => r.status === statusType).length;
        const cj = to.rooms.filter(r => r.status === statusType).length;

        let mover = null;
        let target = null;
        let moverCount = 0;
        let targetCount = 0;

        if (ci > cj + 1) {
          mover = from; target = to; moverCount = ci; targetCount = cj;
        } else if (cj > ci + 1) {
          mover = to; target = from; moverCount = cj; targetCount = ci;
        } else {
          continue; // écart ≤ 1, ok
        }

        // Vérifier que la cible n'est pas au max
        if (maxLimit && targetCount >= maxLimit) continue;

        // Déplacer une chambre du type vers la cible
        // Préférer NONE bedType → préserve les compteurs TW/GL
        let idx = mover.rooms.findIndex(r => r.status === statusType && r.bedType === 'NONE');
        if (idx === -1) idx = mover.rooms.findIndex(r => r.status === statusType);
        if (idx === -1) continue;

        const room = mover.rooms.splice(idx, 1)[0];
        target.rooms.push({ ...room, assignedTo: target.id });
        improved = true;
      }
    }
  }
}
