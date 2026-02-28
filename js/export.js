/**
 * export.js — Export Excel (SheetJS) et impression PDF (window.print)
 */

// ── Template buffer (chargé une fois via file picker) ─────────
let _templateBuffer = null;

function setTemplateBuffer(buf) {
  _templateBuffer = buf;
}

// ── Export depuis template — manipulation ZIP/XML directe ─────
// Charge le template XLSX (= ZIP), clone la feuille pour chaque
// employée en injectant les valeurs via le XML brut, puis reconstruit
// le ZIP. Le styles.xml est modifié uniquement pour ajouter le style X taille 14.
async function exportExcelFromTemplate(state) {
  if (!window.JSZip) {
    showToast('JSZip non chargé — export standard utilisé', 'info');
    exportExcelGenerated(state);
    return;
  }

  const today    = new Date();
  const dateStr  = today.toLocaleDateString('fr-FR');
  const fileDate = today.toISOString().slice(0, 10);
  const toExport = state.employees.filter(e =>
    e.isGouvernante ? state.options.gouvernanteActive : e.active !== false
  );

  try {
    // ── 1. Ouvrir le template comme ZIP ──────────────────────
    const zip         = await JSZip.loadAsync(_templateBuffer);
    const workbookXml = await zip.file('xl/workbook.xml').async('text');
    const relsXml     = await zip.file('xl/_rels/workbook.xml.rels').async('text');
    const ctXml       = await zip.file('[Content_Types].xml').async('text');

    // Trouver le fichier XML de la première feuille
    const wsRelM  = relsXml.match(/Target="worksheets\/([^"]+\.xml)"/);
    const tplFile = wsRelM ? wsRelM[1] : 'sheet1.xml';
    const tplXml  = await zip.file(`xl/worksheets/${tplFile}`).async('text');

    // Styles de référence : index s de la colonne A, lignes 7-38
    const rowStyles = extractRowStyles(tplXml);

    // Extraire l'index de style de F7 (référence bordures pour le X)
    const f7StyleIdx = (() => {
      const pos = tplXml.indexOf('r="F7"');
      if (pos === -1) return null;
      const start = tplXml.lastIndexOf('<c', pos);
      if (start === -1) return null;
      const tag = tplXml.slice(start, tplXml.indexOf('>', start) + 1);
      const m = tag.match(/\bs="(\d+)"/);
      return m ? m[1] : null;
    })();

    // Ajouter un style X taille 14 dans styles.xml (bordures héritées de F7)
    const stylesXmlRaw = await zip.file('xl/styles.xml').async('text');
    const { newStylesXml, xStyleIdx } = addXStyle(stylesXmlRaw, f7StyleIdx);

    // ── 2. Construire le ZIP de sortie ────────────────────────
    const outZip    = new JSZip();
    const skipPaths = new Set([
      'xl/workbook.xml', 'xl/_rels/workbook.xml.rels',
      '[Content_Types].xml', 'xl/calcChain.xml',
      'xl/styles.xml'   // remplacé par la version modifiée
    ]);
    zip.forEach(path => { if (path.startsWith('xl/worksheets/')) skipPaths.add(path); });

    // Copier tous les fichiers non modifiés (sharedStrings, images…)
    const copies = [];
    zip.forEach((path, file) => {
      if (!skipPaths.has(path))
        copies.push(file.async('arraybuffer').then(buf => outZip.file(path, buf)));
    });
    await Promise.all(copies);

    // Écrire le styles.xml modifié
    outZip.file('xl/styles.xml', newStylesXml);

    // ── 3. Une feuille XML par employée ──────────────────────
    const sheetDefs = [];
    toExport.forEach((emp, idx) => {
      const key = `sheet${idx + 1}.xml`;
      outZip.file(`xl/worksheets/${key}`,
        injectDataIntoSheet(tplXml, emp, dateStr, rowStyles, xStyleIdx));
      sheetDefs.push({ key, name: sanitizeSheetName(emp.name) });
    });

    // ── 4. Reconstruire les manifestes ────────────────────────
    outZip.file('xl/workbook.xml',            buildWorkbookXml(workbookXml, sheetDefs));
    outZip.file('xl/_rels/workbook.xml.rels', buildWorkbookRels(relsXml,    sheetDefs));
    outZip.file('[Content_Types].xml',        buildContentTypes(ctXml,       sheetDefs));

    // ── 5. Télécharger ────────────────────────────────────────
    const blob = await outZip.generateAsync({
      type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 }
    });
    const url = URL.createObjectURL(blob);
    const a   = Object.assign(document.createElement('a'), {
      href: url, download: `FDC_${fileDate}.xlsx`
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    const n = sheetDefs.length;
    showToast(`Export Excel — ${n} feuille${n > 1 ? 's' : ''} (template hôtel)`, 'success');

  } catch (err) {
    console.error('[FDC] Erreur export template ZIP:', err);
    showToast('Erreur export template — export standard généré', 'error');
    exportExcelGenerated(state);
  }
}

// ── Ajout d'un style X (taille 14, gras, centré) dans styles.xml ─
function addXStyle(stylesXml, baseCellStyleIdx) {
  try {
    // Hériter du borderId de la cellule de référence (ex. F7) pour préserver les bordures
    let borderId = '0';
    if (baseCellStyleIdx != null) {
      const xfsSection = stylesXml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/);
      if (xfsSection) {
        const xfRe = /<xf\b([^>]*)>/g;
        let m, idx = 0;
        while ((m = xfRe.exec(xfsSection[1])) !== null) {
          if (idx++ === parseInt(baseCellStyleIdx)) {
            const bM = m[1].match(/borderId="(\d+)"/);
            if (bM) borderId = bM[1];
            break;
          }
        }
      }
    }
    const fontIdx = parseInt(stylesXml.match(/<fonts\s+count="(\d+)"/)[1]);
    const xfIdx   = parseInt(stylesXml.match(/<cellXfs\s+count="(\d+)"/)[1]);
    const font = '<font><b/><sz val="14"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>';
    const xf   = `<xf numFmtId="0" fontId="${fontIdx}" fillId="0" borderId="${borderId}" xfId="0"` +
                 ` applyFont="1" applyBorder="1" applyAlignment="1">` +
                 `<alignment horizontal="center" vertical="center"/></xf>`;
    const xml = stylesXml
      .replace(/(<fonts\s+count=")(\d+)(")/, `$1${fontIdx + 1}$3`)
      .replace('</fonts>', font + '</fonts>')
      .replace(/(<cellXfs\s+count=")(\d+)(")/, `$1${xfIdx + 1}$3`)
      .replace('</cellXfs>', xf + '</cellXfs>');
    return { newStylesXml: xml, xStyleIdx: xfIdx };
  } catch (e) {
    console.warn('[FDC] addXStyle: impossible de modifier styles.xml', e);
    return { newStylesXml: stylesXml, xStyleIdx: null };
  }
}

// ── Extraction de l'index de style de la colonne A (lignes 7-38) ─
function extractRowStyles(sheetXml) {
  const styles = {};
  for (let row = 7; row <= 38; row++) {
    const ref = `A${row}`;
    // Localiser l'attribut r="A{row}" dans le XML
    const pos = sheetXml.indexOf(`r="${ref}"`);
    if (pos === -1) { styles[row] = null; continue; }
    // Remonter au début du tag <c
    const start = sheetXml.lastIndexOf('<c', pos);
    if (start === -1) { styles[row] = null; continue; }
    // Extraire le tag d'ouverture complet
    const end = sheetXml.indexOf('>', start);
    const tag = sheetXml.slice(start, end + 1);
    const sM  = tag.match(/\bs="(\d+)"/);
    styles[row] = sM ? sM[1] : null;
  }
  return styles;
}

// ── Injection des données de l'employée dans le XML de la feuille ─
function injectDataIntoSheet(sheetXml, employee, dateStr, rowStyles, xStyleIdx) {
  let xml = sheetXml;

  const sorted = [...employee.rooms].sort((a, b) =>
    a.floor - b.floor ||
    String(a.roomNumber).localeCompare(String(b.roomNumber), undefined, { numeric: true })
  );

  // En-tête : date (A4) et nom employée (C4, cellule maître de fusion)
  xml = upsertInlineCell(xml, 4, 'A', dateStr, null);
  xml = upsertInlineCell(xml, 4, 'C', employee.name, null);

  // Lignes 7-38 : données chambres, avec saut de ligne entre étages
  const xSty = xStyleIdx != null ? String(xStyleIdx) : null;
  let rowOffset = 0, lastFloor = null;
  for (let i = 0; i < sorted.length; i++) {
    const room = sorted[i];
    // Insérer une ligne vide entre chaque changement d'étage
    if (lastFloor !== null && room.floor !== lastFloor) rowOffset++;
    const row = 7 + i + rowOffset;
    if (row > 38) break;
    lastFloor = room.floor;

    const isD  = room.status  === 'DEPART';
    const isR  = room.status  === 'RECOUCHE';
    const isGL = room.bedType === 'GRAND_LIT';
    const isTW = room.bedType === 'TWIN';

    // null = préserve le style d'origine du template (bordures, fond alternant)
    xml = upsertInlineCell(xml, row, 'E', room.roomNumber, null);
    if (isD)  xml = upsertInlineCell(xml, row, 'F', 'X', xSty ?? null);
    if (isR)  xml = upsertInlineCell(xml, row, 'G', 'X', xSty ?? null);
    if (isGL) xml = upsertInlineCell(xml, row, 'K', 'FAIRE EN GRAND LIT', null);
    if (isTW) xml = upsertInlineCell(xml, row, 'L',
      isR ? 'LAISSER EN TWIN' : 'FAIRE EN TWIN', null);
  }

  return xml;
}

// ── Insertion / mise à jour d'une cellule inline dans le XML ──
function upsertInlineCell(sheetXml, rowNum, col, value, style) {
  const ref     = `${col}${rowNum}`;
  const sAttr   = style ? ` s="${style}"` : '';
  const newCell = `<c r="${ref}"${sAttr} t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;

  // Récupère l'attribut s= : si style fourni explicitement, l'utiliser ; sinon préserver celui du tag
  const getS = str => { if (style != null) return sAttr; const m = str.match(/\bs="(\d+)"/); return m ? ` s="${m[1]}"` : ''; };

  // Cas 1 : cellule self-closing  <c r="..." s="N"/>
  const scRe = new RegExp(`<c\\s[^>]*r="${ref}"[^>]*/>`);
  if (scRe.test(sheetXml))
    return sheetXml.replace(scRe, m =>
      `<c r="${ref}"${getS(m)} t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`);

  // Cas 2 : cellule avec contenu  <c r="...">...</c>
  const fullRe = new RegExp(`<c\\s[^>]*r="${ref}"[^>]*>[\\s\\S]*?</c>`);
  if (fullRe.test(sheetXml))
    return sheetXml.replace(fullRe, m =>
      `<c r="${ref}"${getS(m)} t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`);

  // Cas 3 : cellule absente → insérer dans la ligne existante
  const rowRe = new RegExp(`(<row\\s[^>]*r="${rowNum}"[^>]*>)([\\s\\S]*?)(</row>)`);
  if (rowRe.test(sheetXml))
    return sheetXml.replace(rowRe, (_, open, content, close) =>
      `${open}${sortRowCells(content + newCell)}${close}`);

  // Cas 4 : ligne absente → insérer avant </sheetData>
  return sheetXml.replace('</sheetData>',
    `<row r="${rowNum}">${newCell}</row></sheetData>`);
}

// ── Tri des cellules d'une ligne par colonne (ordre OOXML requis) ─
function sortRowCells(rowContent) {
  const cells = [];
  const re = /<c[\s>][\s\S]*?<\/c>|<c\s[^>]*\/>/g;
  let m;
  while ((m = re.exec(rowContent)) !== null) cells.push(m[0]);
  cells.sort((a, b) => {
    const ca = (a.match(/r="([A-Z]+)/) || [])[1] || '';
    const cb = (b.match(/r="([A-Z]+)/) || [])[1] || '';
    return colToNum(ca) - colToNum(cb);
  });
  return cells.join('');
}

function colToNum(col) {
  let n = 0;
  for (const c of col) n = n * 26 + c.charCodeAt(0) - 64;
  return n;
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Reconstruction workbook.xml (liste des feuilles) ──────────
function buildWorkbookXml(original, sheetDefs) {
  const sheets = sheetDefs.map((s, i) =>
    `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId_ws${i + 1}"/>`
  ).join('');
  return original.replace(/<sheets>[\s\S]*?<\/sheets>/, `<sheets>${sheets}</sheets>`);
}

// ── Reconstruction xl/_rels/workbook.xml.rels ─────────────────
function buildWorkbookRels(original, sheetDefs) {
  // Retirer les anciennes relations worksheet, conserver tout le reste
  let xml = original.replace(
    /<Relationship\s[^>]*Type="[^"]*\/worksheet"[^>]*\/>/g, '');
  const rels = sheetDefs.map((s, i) =>
    `<Relationship Id="rId_ws${i + 1}" ` +
    `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ` +
    `Target="worksheets/${s.key}"/>`
  ).join('');
  return xml.replace('</Relationships>', rels + '</Relationships>');
}

// ── Reconstruction [Content_Types].xml ────────────────────────
function buildContentTypes(original, sheetDefs) {
  let xml = original.replace(
    /<Override PartName="\/xl\/worksheets\/[^"]*"[^\/]*\/>/g, '');
  const overrides = sheetDefs.map(s =>
    `<Override PartName="/xl/worksheets/${s.key}" ` +
    `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join('');
  return xml.replace('</Types>', overrides + '</Types>');
}

// ── Helpers styles ────────────────────────────────────────────
function xlCell(v, rgb, bold, align, border) {
  const s = {};
  if (rgb)   s.fill   = { patternType: 'solid', fgColor: { rgb } };
  if (bold || align) s.font = {};
  if (bold)  s.font.bold = true;
  if (align) s.alignment = { horizontal: align, vertical: 'center', wrapText: true };
  if (border) s.border = {
    top:    { style: 'thin', color: { rgb: '999999' } },
    bottom: { style: 'thin', color: { rgb: '999999' } },
    left:   { style: 'thin', color: { rgb: '999999' } },
    right:  { style: 'thin', color: { rgb: '999999' } }
  };
  return { v, t: typeof v === 'number' ? 'n' : 's', s };
}

function sanitizeSheetName(name) {
  return (name || 'FDC')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\\\/\?\*\[\]]/g, '')
    .trim()
    .slice(0, 31) || 'FDC';
}

// ── Tâches de nettoyage (structure du template hôtel) ─────────
const TACHES = [
  'Chambre :',
  'Ouvrir la fenêtre',
  'Couper clim / chauffage',
  'Enlever le linge sale',
  "Vérifier l'alèze (poils)",
  'Faire le lit',
  'Tête de lit, chevet, lampes de chevet',
  'Téléphone',
  'Pouf + Table nomade',
  'Bureau + chaise + poubelle',
  'Hublot',
  'Meuble TV + TV, télécommande',
  'Prises & interrupteurs',
  'Penderie 5 cintres',
  'Aspirer moquette, sous le lit',
  'Salle de Bain',
  'Enlever serviettes, tapis (linge sale)',
  'Poubelle',
  'Douche + paroi',
  'Lavabo',
  "Produits d'accueil à compléter",
  'WC',
  'Support papier WC + réserve',
  'Sol',
  'PETIT PONCTUEL DU JOUR',
  'Penderie + Etagère',
  'Poussière Chambre',
  'Porte chambre + Porte SDB',
  'Rebord fenêtre',
  'Vérification fuites',
  'Gel douche',
  'Alèze'  // 32 lignes : rows 7→38
];

// ── Construction d'une feuille FDC ────────────────────────────
function buildFDCSheet(employee, date) {
  const ws = {};

  const sortedRooms = [...employee.rooms].sort((a, b) =>
    a.floor - b.floor ||
    a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true })
  );
  const stats = calcStats(employee);

  // ── Ligne 1 : Titre ────────────────────────────────────────
  // (r=0, cols A→N = 0→13)
  ws['A1'] = xlCell('Feuille de Travail Femmes de Chambre', '9BBB59', true, 'center');

  // ── Ligne 2 : spacer (vide) ────────────────────────────────

  // ── Ligne 3 : en-têtes pass/date ──────────────────────────
  ws['A3'] = xlCell('DATE',    'BDBDBD', true, 'center', true);
  ws['B3'] = xlCell('PASSE n°','BDBDBD', true, 'center', true);
  ws['C3'] = xlCell('PASSE PRIS — NOM + SIGNATURE FEMME DE CHAMBRE', 'BDBDBD', true, 'center', true);

  // ── Ligne 4 : valeurs date / nom employée ─────────────────
  ws['A4'] = xlCell(date,           'FFFFFF', false, 'center', true);
  ws['C4'] = xlCell(employee.name,  'FFFFFF', true,  'center', true);

  // ── Ligne 5 : spacer ──────────────────────────────────────

  // ── Ligne 6 : en-têtes colonnes ───────────────────────────
  // (r=5)
  const H6 = 'D4D4D4';
  ws['A6'] = xlCell('TRAVAUX JOURNALIERS',   H6, true, 'center', true);
  ws['E6'] = xlCell('n°',                    H6, true, 'center', true);
  ws['F6'] = xlCell('D',                     H6, true, 'center', true);
  ws['G6'] = xlCell('R',                     H6, true, 'center', true);
  ws['H6'] = xlCell('R à blanc',             H6, true, 'center', true);
  ws['I6'] = xlCell('0 SERVICE + HORAIRE',   H6, true, 'center', true);
  ws['J6'] = xlCell('NPD',                   H6, true, 'center', true);
  ws['K6'] = xlCell('DOUBLE',                H6, true, 'center', true);
  ws['L6'] = xlCell('TWIN',                  H6, true, 'center', true);
  ws['M6'] = xlCell('LIT BB',                H6, true, 'center', true);
  ws['N6'] = xlCell('Commentaire :',         H6, true, 'center', true);

  // ── Lignes 7-38 : tâches + données chambres ───────────────
  for (let i = 0; i < TACHES.length; i++) {
    const row = 7 + i;   // ligne Excel 7 à 38
    const bg  = (i % 2 === 0) ? 'FFFFFF' : 'F3F3F3';
    const isPonctuel = TACHES[i] === 'PETIT PONCTUEL DU JOUR';

    // Colonne A : tâche
    ws[`A${row}`] = xlCell(TACHES[i], bg, isPonctuel, 'left', true);

    // Colonnes E-N : données chambre (si la chambre existe pour cette ligne)
    const room = sortedRooms[i];
    if (room) {
      const isD  = room.status === 'DEPART';
      const isR  = room.status === 'RECOUCHE';
      const isGL = room.bedType === 'GRAND_LIT';
      const isTW = room.bedType === 'TWIN';

      ws[`E${row}`] = xlCell(room.roomNumber,                    bg, true,  'center', true);
      if (isD) ws[`F${row}`] = xlCell('X', bg, true, 'center', true);
      if (isR) ws[`G${row}`] = xlCell('X', bg, true, 'center', true);
      if (isGL) ws[`K${row}`] = xlCell('FAIRE EN GRAND LIT',    bg, false, 'left', true);
      if (isTW) ws[`L${row}`] = xlCell(
        isR ? 'LAISSER EN TWIN' : 'FAIRE EN TWIN',              bg, false, 'left', true);
    } else {
      // Cellules vides avec bordure pour maintenir la grille
      for (const col of ['E','F','G','H','I','J','K','L','M','N']) {
        ws[`${col}${row}`] = xlCell('', bg, false, null, true);
      }
    }
  }

  // ── Ligne 40 : récapitulatif ───────────────────────────────
  ws['A40'] = xlCell(
    `Total : ${stats.total}  |  Départs : ${stats.departs}  |  Recouches : ${stats.recouches}  |  Twin : ${stats.twins}  |  Grand lit : ${stats.grandLits}`,
    'EAF2EA', true, 'left'
  );

  // ── Plage ─────────────────────────────────────────────────
  ws['!ref'] = 'A1:N40';

  // ── Largeurs colonnes (reprises du template) ───────────────
  ws['!cols'] = [
    { wch: 32 }, // A  tâches
    { wch: 13 }, // B
    { wch: 25 }, // C  nom/signature
    { wch: 1  }, // D  séparateur visuel
    { wch: 7  }, // E  n°
    { wch: 4  }, // F  D
    { wch: 4  }, // G  R
    { wch: 7  }, // H  R à blanc
    { wch: 20 }, // I  0 SERVICE
    { wch: 7  }, // J  NPD
    { wch: 22 }, // K  DOUBLE
    { wch: 19 }, // L  TWIN
    { wch: 8  }, // M  LIT BB
    { wch: 18 }  // N  Commentaire
  ];

  // ── Hauteurs lignes ────────────────────────────────────────
  ws['!rows'] = [
    { hpx: 20 }, // 1 titre
    { hpx: 5  }, // 2 spacer
    { hpx: 18 }, // 3 en-tête pass
    { hpx: 18 }, // 4 valeurs
    { hpx: 5  }, // 5 spacer
    { hpx: 36 }, // 6 en-têtes colonnes (haut)
    ...Array(32).fill({ hpx: 18 }), // 7-38 données
    { hpx: 5  }, // 39
    { hpx: 18 }  // 40 récap
  ];

  // ── Fusions ────────────────────────────────────────────────
  ws['!merges'] = [
    { s:{r:0,c:0}, e:{r:0,c:13} },  // A1 : titre
    { s:{r:2,c:2}, e:{r:2,c:13} },  // C3 : PASSE PRIS header
    { s:{r:3,c:2}, e:{r:3,c:13} },  // C4 : nom employée
    { s:{r:5,c:0}, e:{r:5,c:3}  },  // A6 : TRAVAUX JOURNALIERS
    { s:{r:39,c:0},e:{r:39,c:13} }  // A40 : récap
  ];

  return ws;
}

// ── Export Excel : dispatch template ou génération ────────────
function exportExcel(state) {
  if (_templateBuffer) {
    // async — gère ses propres erreurs et retombe sur exportExcelGenerated si besoin
    exportExcelFromTemplate(state);
  } else {
    if (!window.XLSX) {
      showToast('SheetJS non chargé, export impossible', 'error');
      return;
    }
    exportExcelGenerated(state);
  }
}

// ── Export Excel généré (sans template) ───────────────────────
function exportExcelGenerated(state) {
  const wb   = XLSX.utils.book_new();
  const date = new Date().toLocaleDateString('fr-FR');

  const toExport = state.employees.filter(e => {
    if (e.isGouvernante) return state.options.gouvernanteActive;
    return e.active !== false;
  });

  // ── Une feuille par employée ──────────────────────────────
  for (const employee of toExport) {
    const ws = buildFDCSheet(employee, date);
    XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(employee.name));
  }

  // ── Feuille récapitulative ────────────────────────────────
  const recapAoa = [
    [`Récapitulatif — ${date}`],
    [],
    ['Employée', 'Total', 'Départs', 'Recouches', 'Twin', 'Grand lit'],
    ...toExport.map(e => {
      const s = calcStats(e);
      return [e.name, s.total, s.departs, s.recouches, s.twins, s.grandLits];
    }),
    [],
    ['TOTAL',
      toExport.reduce((s, e) => s + calcStats(e).total,     0),
      toExport.reduce((s, e) => s + calcStats(e).departs,   0),
      toExport.reduce((s, e) => s + calcStats(e).recouches, 0),
      toExport.reduce((s, e) => s + calcStats(e).twins,     0),
      toExport.reduce((s, e) => s + calcStats(e).grandLits, 0)
    ]
  ];
  const recapWs = XLSX.utils.aoa_to_sheet(recapAoa);
  recapWs['!cols'] = [{ wch: 22 }, { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 8 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, recapWs, 'Récapitulatif');

  const fileDate = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `FDC_${fileDate}.xlsx`);
  showToast('Export Excel téléchargé', 'success');
}

// ── Impression / Export PDF ───────────────────────────────────
/**
 * Génère une feuille de travail par FDC, format hôtel :
 *   n° | D | R | DOUBLE | TWIN | Note
 * Règles :
 *   D     = X si status DÉPART
 *   R     = X si status RECOUCHE
 *   DOUBLE = "FAIRE EN GRAND LIT" si bedType GRAND_LIT
 *   TWIN   = "FAIRE EN TWIN" (Départ+Twin) ou "LAISSER EN TWIN" (Recouche+Twin)
 *   Ligne vide entre chaque changement d'étage
 */
function triggerPrint(state) {
  const printLayout = document.getElementById('print-layout');
  const date = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  // Employées à imprimer (FDC actives + gouvernante si activée et non vide)
  const toPrint = state.employees.filter(e => {
    if (e.isGouvernante) return state.options.gouvernanteActive && e.rooms.length > 0;
    return e.rooms.length > 0;
  });

  const buildPage = (employee) => {
    const stats = calcStats(employee);
    const sortedRooms = [...employee.rooms].sort((a, b) =>
      a.floor - b.floor ||
      a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true })
    );

    // Construire les lignes avec séparateur d'étage
    let rows = '';
    let lastFloor = null;

    for (const r of sortedRooms) {
      // Ligne vide entre étages
      if (lastFloor !== null && r.floor !== lastFloor) {
        rows += `<tr class="print-floor-sep"><td colspan="6"></td></tr>`;
      }
      lastFloor = r.floor;

      const isDepart   = r.status === 'DEPART';
      const isRecouche = r.status === 'RECOUCHE';
      const isTwin     = r.bedType === 'TWIN';
      const isGL       = r.bedType === 'GRAND_LIT';

      const cellD      = isDepart   ? '<span class="print-x">✕</span>' : '';
      const cellR      = isRecouche ? '<span class="print-x">✕</span>' : '';
      const cellDouble = isGL ? 'FAIRE EN GRAND LIT' : '';
      const cellTwin   = isTwin
        ? (isRecouche ? 'LAISSER EN TWIN' : 'FAIRE EN TWIN')
        : '';

      rows += `
        <tr>
          <td class="pt-num">${escapeHtml(r.roomNumber)}</td>
          <td class="pt-d">${cellD}</td>
          <td class="pt-r">${cellR}</td>
          <td class="pt-double">${cellDouble}</td>
          <td class="pt-twin">${cellTwin}</td>
          <td class="pt-note">${escapeHtml(r.note || '')}</td>
        </tr>`;
    }

    const empLabel = employee.isGouvernante
      ? employee.name
      : employee.name;

    return `
      <div class="print-page">
        <div class="print-header-row">
          <div class="print-date">${date}</div>
          <div class="print-emp-name">${escapeHtml(empLabel)}</div>
          <div class="print-summary">${stats.departs} Dép. · ${stats.recouches} Rec. · Total ${stats.total}</div>
        </div>

        <table class="print-fdc-table">
          <thead>
            <tr>
              <th class="pt-num">n°</th>
              <th class="pt-d">D</th>
              <th class="pt-r">R</th>
              <th class="pt-double">DOUBLE</th>
              <th class="pt-twin">TWIN</th>
              <th class="pt-note">Commentaire</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  };

  // ── Page récapitulative ───────────────────────────────────
  const allFDC = state.employees.filter(e => !e.isGouvernante);
  const recapRows = allFDC.map(e => {
    const s = calcStats(e);
    return `
      <tr>
        <td>${escapeHtml(e.name)}</td>
        <td>${s.departs}</td>
        <td>${s.recouches}</td>
        <td>${s.total}</td>
        <td>${s.twins > 0 ? s.twins + ' TW' : ''}</td>
        <td>${s.grandLits > 0 ? s.grandLits + ' GL' : ''}</td>
      </tr>`;
  }).join('');

  const recapPage = `
    <div class="print-page print-recap-page">
      <div class="print-header-row">
        <div class="print-date">${date}</div>
        <div class="print-emp-name">Récapitulatif</div>
        <div class="print-summary"></div>
      </div>
      <table class="print-fdc-table">
        <thead>
          <tr>
            <th>Employée</th>
            <th>Départs</th>
            <th>Recouches</th>
            <th>Total</th>
            <th>Twin</th>
            <th>Grand lit</th>
          </tr>
        </thead>
        <tbody>${recapRows}</tbody>
      </table>
    </div>`;

  printLayout.innerHTML = toPrint.map(e => buildPage(e)).join('') + recapPage;
  window.print();
}
