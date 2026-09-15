'use strict';

/* ---------- Carte de base ---------- */

const map = L.map('map', { zoomControl: true }).setView([43.6, 6.2], 13); // Var, par défaut

const baseLayers = {
  osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; les contributeurs d\'OpenStreetMap'
  }),
  'ign-plan': L.tileLayer(
    'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
    '&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}' +
    '&STYLE=normal&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&FORMAT=image/png',
    { maxZoom: 19, attribution: '&copy; IGN - Géoplateforme' }
  ),
  'ign-ortho': L.tileLayer(
    'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
    '&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}' +
    '&STYLE=normal&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&FORMAT=image/jpeg',
    { maxZoom: 19, attribution: '&copy; IGN - Géoplateforme' }
  )
};

baseLayers.osm.addTo(map);

/* ---------- Couche géologique BRGM (WMS 1/50 000) ---------- */

// Ces 3 couches (SCAN_D_GEOL50, SCAN_H_GEOL50, SCAN_H_RELIEF_GEOL50) ne sont
// exposées que par ce service WMS ; mapsref.brgm.fr/wxs/referentiel/geologie
// n'a que des couches globales (SCAN_GEOL50) et ne les contient pas.
// Échelle d'affichage utile : environ 1/9 000 à 1/251 000 (zoom ville/département).
const BRGM_WMS_URL = 'https://geoservices.brgm.fr/geologie';

let geolLayer = null;

function setGeolLayer(layerName, opacity) {
  if (geolLayer) {
    map.removeLayer(geolLayer);
    geolLayer = null;
  }
  if (!layerName) return;
  geolLayer = L.tileLayer.wms(BRGM_WMS_URL, {
    layers: layerName,
    format: 'image/png',
    transparent: true,
    version: '1.3.0',
    opacity: opacity,
    attribution: '&copy; BRGM - GéoServices'
  });
  geolLayer.addTo(map);
}

function currentGeolLegendUrl(layerName) {
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetLegendGraphic',
    FORMAT: 'image/png',
    LAYER: layerName
  });
  return BRGM_WMS_URL + '?' + params.toString();
}

/* ---------- Panneau latéral ---------- */

const panel = document.getElementById('panel');
document.getElementById('btn-panel-toggle').addEventListener('click', () => {
  panel.classList.toggle('open');
});

const selectBasemap = document.getElementById('select-basemap');
selectBasemap.addEventListener('change', () => {
  Object.values(baseLayers).forEach((l) => map.removeLayer(l));
  baseLayers[selectBasemap.value].addTo(map);
});

const selectGeol = document.getElementById('select-geol');
const rangeOpacity = document.getElementById('range-opacity');

function refreshGeolLayer() {
  setGeolLayer(selectGeol.value, Number(rangeOpacity.value) / 100);
  refreshLegend();
}
selectGeol.addEventListener('change', refreshGeolLayer);
rangeOpacity.addEventListener('input', () => {
  if (geolLayer) geolLayer.setOpacity(Number(rangeOpacity.value) / 100);
});

/* ---------- Légende BRGM ---------- */

const legendPanel = document.getElementById('legend-panel');
const legendImage = document.getElementById('legend-image');
const legendEmpty = document.getElementById('legend-empty');
const legendTitle = document.getElementById('legend-title');

function refreshLegend() {
  const layerName = selectGeol.value;
  if (!layerName) {
    legendImage.hidden = true;
    legendEmpty.hidden = false;
    legendTitle.textContent = 'Légende';
    return;
  }
  legendTitle.textContent = 'Légende — ' + selectGeol.options[selectGeol.selectedIndex].text;
  legendImage.src = currentGeolLegendUrl(layerName);
  legendImage.hidden = false;
  legendEmpty.hidden = true;
}

document.getElementById('btn-legend-toggle').addEventListener('click', () => {
  legendPanel.hidden = !legendPanel.hidden;
});
document.getElementById('btn-legend-close').addEventListener('click', () => {
  legendPanel.hidden = true;
});

/* ---------- Import GPX / KML ---------- */

let trackLayer = null;

const fileInput = document.getElementById('file-track');
const trackInfo = document.getElementById('track-info');
const btnClearTrack = document.getElementById('btn-clear-track');

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = reader.result;
      const ext = file.name.toLowerCase().split('.').pop();
      const parsed = ext === 'kml' ? parseKML(text) : parseGPX(text);
      showTrack(parsed, file.name);
    } catch (err) {
      trackInfo.textContent = 'Erreur de lecture du fichier : ' + err.message;
    }
  };
  reader.readAsText(file);
});

btnClearTrack.addEventListener('click', clearTrack);

function clearTrack() {
  if (trackLayer) {
    map.removeLayer(trackLayer);
    trackLayer = null;
  }
  trackInfo.textContent = 'Aucun tracé chargé.';
  btnClearTrack.disabled = true;
  fileInput.value = '';
}

function showTrack(parsed, fileName) {
  clearTrack();

  const group = L.layerGroup();

  if (parsed.points.length > 1) {
    const latlngs = parsed.points.map((p) => [p.lat, p.lon]);
    L.polyline(latlngs, { color: '#d32f2f', weight: 4, opacity: 0.85 }).addTo(group);
  }

  parsed.waypoints.forEach((wp) => {
    const marker = L.marker([wp.lat, wp.lon]);
    if (wp.name) marker.bindPopup(escapeHtml(wp.name));
    marker.addTo(group);
  });

  group.addTo(map);
  trackLayer = group;

  const bounds = boundsOf(parsed);
  if (bounds) map.fitBounds(bounds, { padding: [30, 30] });

  trackInfo.innerHTML = buildStatsHtml(parsed, fileName);
  btnClearTrack.disabled = false;
}

function boundsOf(parsed) {
  const all = parsed.points.concat(parsed.waypoints);
  if (all.length === 0) return null;
  return L.latLngBounds(all.map((p) => [p.lat, p.lon]));
}

function buildStatsHtml(parsed, fileName) {
  const distKm = trackDistanceKm(parsed.points);
  const { up, down } = elevationGainLoss(parsed.points);
  const hasEle = parsed.points.some((p) => typeof p.ele === 'number');

  let html = '<strong>' + escapeHtml(fileName) + '</strong><br>';
  html += 'Distance : ' + distKm.toFixed(2) + ' km<br>';
  if (hasEle) {
    html += 'D+ : ' + Math.round(up) + ' m &nbsp; D- : ' + Math.round(down) + ' m<br>';
  }
  html += 'Points de tracé : ' + parsed.points.length +
    ' &nbsp; Repères : ' + parsed.waypoints.length;
  return html;
}

function trackDistanceKm(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversine(points[i - 1], points[i]);
  }
  return total;
}

function haversine(a, b) {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function toRad(deg) { return (deg * Math.PI) / 180; }

function elevationGainLoss(points) {
  let up = 0, down = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1].ele, b = points[i].ele;
    if (typeof a !== 'number' || typeof b !== 'number') continue;
    const diff = b - a;
    if (diff > 0) up += diff; else down += -diff;
  }
  return { up, down };
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* ---------- Parseur GPX ---------- */

function parseGPX(text) {
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('GPX invalide');

  const points = [];
  xml.querySelectorAll('trkpt, rtept').forEach((node) => {
    const lat = parseFloat(node.getAttribute('lat'));
    const lon = parseFloat(node.getAttribute('lon'));
    const eleNode = node.querySelector('ele');
    const ele = eleNode ? parseFloat(eleNode.textContent) : undefined;
    if (!isNaN(lat) && !isNaN(lon)) points.push({ lat, lon, ele });
  });

  const waypoints = [];
  xml.querySelectorAll('wpt').forEach((node) => {
    const lat = parseFloat(node.getAttribute('lat'));
    const lon = parseFloat(node.getAttribute('lon'));
    const nameNode = node.querySelector('name');
    if (!isNaN(lat) && !isNaN(lon)) {
      waypoints.push({ lat, lon, name: nameNode ? nameNode.textContent : '' });
    }
  });

  return { points, waypoints };
}

/* ---------- Parseur KML ---------- */

function parseKML(text) {
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('KML invalide');

  const points = [];
  xml.querySelectorAll('LineString > coordinates, Track coordinates, gx\\:coord').forEach((node) => {
    const raw = node.textContent.trim();
    raw.split(/\s+/).forEach((triplet) => {
      const [lon, lat, ele] = triplet.split(',').map(Number);
      if (!isNaN(lat) && !isNaN(lon)) {
        points.push({ lat, lon, ele: isNaN(ele) ? undefined : ele });
      }
    });
  });

  const waypoints = [];
  xml.querySelectorAll('Placemark').forEach((placemark) => {
    const pointNode = placemark.querySelector('Point > coordinates');
    if (!pointNode) return;
    const [lon, lat] = pointNode.textContent.trim().split(',').map(Number);
    if (isNaN(lat) || isNaN(lon)) return;
    const nameNode = placemark.querySelector('name');
    waypoints.push({ lat, lon, name: nameNode ? nameNode.textContent : '' });
  });

  return { points, waypoints };
}

/* ---------- Identification géologique hors-ligne (BD Charm-50) ---------- */
/* Point dans polygone sur les formations vectorielles du/des départements  */
/* chargés (fichiers data/<code>.geojson, listés dans data/departments.json)*/

const loadedDepartments = {}; // code -> FeatureCollection (avec _bbox par entité)

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInRings(lng, lat, rings) {
  if (!rings.length || !pointInRing(lng, lat, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(lng, lat, rings[i])) return false; // trou (île exclue)
  }
  return true;
}

function pointInGeometry(lng, lat, geometry) {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') return pointInRings(lng, lat, geometry.coordinates);
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some((poly) => pointInRings(lng, lat, poly));
  }
  return false;
}

function computeBBox(geometry) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const scanRing = (ring) => ring.forEach(([x, y]) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  });
  if (geometry.type === 'Polygon') geometry.coordinates.forEach(scanRing);
  else if (geometry.type === 'MultiPolygon') geometry.coordinates.forEach((p) => p.forEach(scanRing));
  return [minX, minY, maxX, maxY];
}

function findFormationAt(lng, lat) {
  for (const code in loadedDepartments) {
    const fc = loadedDepartments[code];
    for (const feature of fc.features) {
      const [minX, minY, maxX, maxY] = feature._bbox;
      if (lng < minX || lng > maxX || lat < minY || lat > maxY) continue;
      if (pointInGeometry(lng, lat, feature.geometry)) return feature.properties;
    }
  }
  return null;
}

function getProp(props, candidateNames) {
  for (const name of candidateNames) {
    const key = Object.keys(props).find((k) => k.toUpperCase() === name);
    if (key && props[key] !== null && props[key] !== undefined && props[key] !== '') {
      return props[key];
    }
  }
  return null;
}

function formatFormationProps(props) {
  const notation = getProp(props, ['NOTATION', 'CODE', 'SIGLE']);
  const nom = getProp(props, ['NOM', 'DESCR', 'LIBELLE', 'FORMATION', 'DESCRIPTIO', 'LIB']);
  const age = getProp(props, ['AGE', 'ETAGE', 'CHRONO', 'PERIODE']);

  let html = '';
  if (notation) html += '<strong style="font-size:1.15em;">' + escapeHtml(notation) + '</strong><br>';
  if (nom) html += escapeHtml(nom) + '<br>';
  if (age) html += '<em>' + escapeHtml(age) + '</em>';

  if (!html) {
    html = Object.entries(props)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => escapeHtml(k) + ' : ' + escapeHtml(String(v)))
      .join('<br>');
  }
  return html || 'Aucun attribut exploitable trouvé pour ce polygone.';
}

const selectDepartment = document.getElementById('select-department');
const departmentStatus = document.getElementById('department-status');

/* -- IndexedDB : persistance locale des départements importés par l'utilisateur -- */

const IDB_NAME = 'randogeol-db';
const IDB_STORE = 'departments';

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE, { keyPath: 'code' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(record) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGetAll() {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(code) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(code);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

/* -- Simplification Douglas-Peucker (tolérance en degrés, ~30 m à cette latitude) -- */

const SIMPLIFY_TOLERANCE_DEG = 0.0003;

function perpendicularDistance(pt, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(pt[0] - a[0], pt[1] - a[1]);
  const t = ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / (dx * dx + dy * dy);
  const px = a[0] + t * dx, py = a[1] + t * dy;
  return Math.hypot(pt[0] - px, pt[1] - py);
}

function douglasPeucker(points, epsilon) {
  if (points.length < 3) return points.slice();
  let dmax = 0, index = 0;
  const end = points.length - 1;
  for (let i = 1; i < end; i++) {
    const d = perpendicularDistance(points[i], points[0], points[end]);
    if (d > dmax) { dmax = d; index = i; }
  }
  if (dmax > epsilon) {
    const left = douglasPeucker(points.slice(0, index + 1), epsilon);
    const right = douglasPeucker(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[end]];
}

function simplifyRing(ring) {
  if (ring.length <= 4) return ring;
  const simplified = douglasPeucker(ring, SIMPLIFY_TOLERANCE_DEG);
  return simplified.length >= 4 ? simplified : ring;
}

function simplifyGeometry(geometry) {
  if (geometry.type === 'Polygon') {
    geometry.coordinates = geometry.coordinates.map(simplifyRing);
  } else if (geometry.type === 'MultiPolygon') {
    geometry.coordinates = geometry.coordinates.map((poly) => poly.map(simplifyRing));
  }
  return geometry;
}

function roundCoords(geometry) {
  const round = (pt) => [Math.round(pt[0] * 1e5) / 1e5, Math.round(pt[1] * 1e5) / 1e5];
  if (geometry.type === 'Polygon') {
    geometry.coordinates = geometry.coordinates.map((r) => r.map(round));
  } else if (geometry.type === 'MultiPolygon') {
    geometry.coordinates = geometry.coordinates.map((p) => p.map((r) => r.map(round)));
  }
  return geometry;
}

const PROPERTY_WHITELIST = ['NOTATION', 'DESCR', 'CODE', 'CODE_LEG', 'CARTE'];

function filterProperties(props) {
  const out = {};
  for (const key of Object.keys(props)) {
    if (PROPERTY_WHITELIST.includes(key.toUpperCase())) out[key] = props[key];
  }
  return out;
}

/* -- Chargement d'un département (embarqué avec l'app, ou importé) -- */

async function activateDepartment(code, geojson) {
  geojson.features.forEach((f) => { f._bbox = computeBBox(f.geometry); });
  loadedDepartments[code] = geojson;
}

async function initDepartments() {
  let builtIn = [];
  try {
    const res = await fetch('./data/departments.json');
    builtIn = await res.json();
  } catch (e) {
    builtIn = [];
  }

  let imported = [];
  try {
    imported = await idbGetAll();
  } catch (e) {
    imported = [];
  }

  renderDepartmentOptions(builtIn, imported);
  renderImportedList(imported);
}

function renderDepartmentOptions(builtIn, imported) {
  const options = ['<option value="">— Choisir —</option>'];
  builtIn.forEach((d) => {
    options.push('<option value="' + d.code + '" data-source="built-in" data-file="' +
      d.fichier + '">' + escapeHtml(d.nom) + '</option>');
  });
  imported.forEach((d) => {
    options.push('<option value="' + d.code + '" data-source="imported">' +
      escapeHtml(d.nom) + ' (importé)</option>');
  });
  selectDepartment.innerHTML = options.length > 1
    ? options.join('')
    : '<option value="">Aucun département disponible</option>';
}

function renderImportedList(imported) {
  const container = document.getElementById('imported-list');
  if (!imported.length) { container.innerHTML = ''; return; }
  container.innerHTML = imported.map((d) =>
    '<div class="imported-row"><span>' + escapeHtml(d.nom) + ' — ' +
    d.nbFeatures + ' formations</span>' +
    '<button data-code="' + d.code + '">Supprimer</button></div>'
  ).join('');
  container.querySelectorAll('button[data-code]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const code = btn.dataset.code;
      await idbDelete(code);
      delete loadedDepartments[code];
      await initDepartments();
      departmentStatus.textContent = 'Département supprimé.';
    });
  });
}

selectDepartment.addEventListener('change', async () => {
  const code = selectDepartment.value;
  if (!code || loadedDepartments[code]) return;
  const option = selectDepartment.selectedOptions[0];

  departmentStatus.textContent = 'Chargement des formations…';
  try {
    if (option.dataset.source === 'imported') {
      const record = (await idbGetAll()).find((d) => d.code === code);
      if (!record) throw new Error('Donnée importée introuvable');
      await activateDepartment(code, record.featureCollection);
    } else {
      const res = await fetch(option.dataset.file);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const geojson = await res.json();
      await activateDepartment(code, geojson);
    }
    departmentStatus.textContent = loadedDepartments[code].features.length +
      ' formations chargées. Cliquez sur la carte.';
  } catch (e) {
    departmentStatus.textContent = 'Erreur de chargement : ' + e.message;
  }
});

initDepartments();

/* -- Import d'un département depuis un zip BD Charm-50 (traitement 100% local) -- */

const fileDepartmentZip = document.getElementById('file-department-zip');
const inputDepartmentName = document.getElementById('input-department-name');
const btnImportDepartment = document.getElementById('btn-import-department');
const importStatus = document.getElementById('import-status');

function findZipEntry(zip, regex) {
  return Object.keys(zip.files).find((name) => regex.test(name) && !zip.files[name].dir);
}

btnImportDepartment.addEventListener('click', async () => {
  const file = fileDepartmentZip.files[0];
  if (!file) {
    importStatus.textContent = 'Choisissez un fichier .zip BD Charm-50 (BRGM) au préalable.';
    return;
  }

  importStatus.textContent = 'Lecture du zip…';
  // Laisse le navigateur peindre le message avant le traitement (peut être long).
  await new Promise((r) => setTimeout(r, 30));

  try {
    const buffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);

    const shpKey = findZipEntry(zip, /_S_FGEOL.*\.shp$/i);
    if (!shpKey) {
      throw new Error('Couche des formations (S_FGEOL) introuvable dans ce zip. ' +
        'Vérifiez qu\'il s\'agit bien d\'un export BD Charm-50 du BRGM.');
    }
    const base = shpKey.slice(0, -4);
    const dbfKey = findZipEntry(zip, new RegExp('^' + escapeRegExp(base) + '\\.dbf$', 'i'));
    const prjKey = findZipEntry(zip, new RegExp('^' + escapeRegExp(base) + '\\.prj$', 'i'));

    importStatus.textContent = 'Extraction des fichiers…';
    await new Promise((r) => setTimeout(r, 10));

    const [shpBuf, dbfBuf, prjBuf] = await Promise.all([
      zip.files[shpKey].async('arraybuffer'),
      dbfKey ? zip.files[dbfKey].async('arraybuffer') : null,
      prjKey ? zip.files[prjKey].async('arraybuffer') : null
    ]);

    importStatus.textContent = 'Analyse du shapefile et reprojection…';
    await new Promise((r) => setTimeout(r, 10));

    // cpg forcé en windows-1252 : les exports BD Charm-50 n'incluent pas de
    // fichier .cpg alors que leur .dbf est encodé en Windows-1252 (accents).
    const geojson = await shp({ shp: shpBuf, dbf: dbfBuf, prj: prjBuf, cpg: 'windows-1252' });

    importStatus.textContent = 'Simplification (' + geojson.features.length + ' polygones)…';
    await new Promise((r) => setTimeout(r, 10));

    const features = [];
    for (const feature of geojson.features) {
      const props = filterProperties(feature.properties || {});
      if (!props.NOTATION && !props.DESCR) continue;
      if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') continue;
      const simplified = simplifyGeometry(feature.geometry);
      const rounded = roundCoords(simplified);
      features.push({ type: 'Feature', properties: props, geometry: rounded });
    }

    // Détection du code département à partir du nom de fichier
    // (convention BRGM : GEO050K_HARM_0XX_S_FGEOL_2154.shp).
    const codeMatch = base.match(/HARM_(\d{2,3})/i);
    const code = codeMatch ? codeMatch[1] : 'imp-' + Date.now();
    const nom = inputDepartmentName.value.trim() || ('Département ' + code);

    const record = {
      code,
      nom,
      dateImport: new Date().toISOString(),
      nbFeatures: features.length,
      featureCollection: { type: 'FeatureCollection', features }
    };

    importStatus.textContent = 'Enregistrement local…';
    await idbPut(record);
    await activateDepartment(code, record.featureCollection);
    await initDepartments();
    selectDepartment.value = code;

    importStatus.textContent = features.length + ' formations importées pour « ' + nom + ' ». Disponible hors-ligne sur cet appareil.';
    fileDepartmentZip.value = '';
    inputDepartmentName.value = '';
  } catch (e) {
    importStatus.textContent = 'Erreur d\'import : ' + e.message;
  }
});

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ---------- Identification géologique au clic (GetFeatureInfo) ---------- */

map.on('click', (e) => {
  // 1) Priorité aux données vectorielles locales (BD Charm-50) si un
  //    département est chargé et couvre le point cliqué.
  if (Object.keys(loadedDepartments).length) {
    const props = findFormationAt(e.latlng.lng, e.latlng.lat);
    if (props) {
      L.popup().setLatLng(e.latlng).setContent(formatFormationProps(props)).openOn(map);
      return;
    }
  }

  // 2) Aucune correspondance locale : les couches scannées/harmonisées du
  //    BRGM sont déclarées non interrogeables ("LayerNotQueryable") sur son
  //    WMS public, donc une interrogation directe échoue systématiquement.
  //    On explique la situation plutôt que d'envoyer une requête vouée à échouer.
  const departmentLoaded = Object.keys(loadedDepartments).length > 0;
  const message = departmentLoaded
    ? 'Ce point est hors des départements chargés ci-dessus.'
    : 'Aucun département n\'est chargé.';

  L.popup().setLatLng(e.latlng).setContent(
    message + ' L\'identification précise nécessite les données vectorielles ' +
    'BD Charm-50 du département concerné.<br><br>' +
    'Pour l\'ajouter : téléchargez le fichier ' +
    '<code>GEO050K_HARM_0XX.zip</code> correspondant depuis ' +
    '<a href="https://infoterre.brgm.fr/formulaire/telechargement-cartes-geologiques-departementales-150-000-bd-charm-50" target="_blank" rel="noopener">' +
    'le formulaire BRGM</a> (XX = numéro du département), puis importez-le ' +
    'vous-même via la section « Ajouter un département » du panneau (📂).' +
    '<br><a href="' + wmsGetFeatureInfoUrl(e.latlng) + '" target="_blank" rel="noopener">' +
    'Tenter quand même une requête au serveur BRGM</a>'
  ).openOn(map);
});

function wmsGetFeatureInfoUrl(latlng) {
  const size = map.getSize();
  const bounds = map.getBounds();
  const crs = map.options.crs;
  const sw = crs.project(bounds.getSouthWest());
  const ne = crs.project(bounds.getNorthEast());
  const point = map.latLngToContainerPoint(latlng);

  const params = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetFeatureInfo',
    LAYERS: selectGeol.value || '',
    QUERY_LAYERS: selectGeol.value || '',
    STYLES: '',
    CRS: 'EPSG:3857',
    BBOX: [sw.x, sw.y, ne.x, ne.y].join(','),
    WIDTH: size.x,
    HEIGHT: size.y,
    I: Math.round(point.x),
    J: Math.round(point.y),
    INFO_FORMAT: 'text/plain',
    FEATURE_COUNT: 5
  });
  return BRGM_WMS_URL + '?' + params.toString();
}

/* ---------- Position GPS ---------- */

let gpsWatchId = null;
let gpsMarker = null;
let gpsAccuracyCircle = null;
let gpsFirstFix = true;

const checkboxGps = document.getElementById('checkbox-gps');
const gpsStatus = document.getElementById('gps-status');

checkboxGps.addEventListener('change', () => {
  if (checkboxGps.checked) startGps(); else stopGps();
});

function startGps() {
  if (!('geolocation' in navigator)) {
    gpsStatus.textContent = 'Géolocalisation non disponible sur cet appareil.';
    checkboxGps.checked = false;
    return;
  }
  gpsFirstFix = true;
  gpsStatus.textContent = 'Recherche du signal GPS…';
  gpsWatchId = navigator.geolocation.watchPosition(onGpsPosition, onGpsError, {
    enableHighAccuracy: true,
    maximumAge: 2000,
    timeout: 15000
  });
}

function stopGps() {
  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }
  if (gpsMarker) { map.removeLayer(gpsMarker); gpsMarker = null; }
  if (gpsAccuracyCircle) { map.removeLayer(gpsAccuracyCircle); gpsAccuracyCircle = null; }
  gpsStatus.textContent = '';
}

function onGpsPosition(pos) {
  const latlng = [pos.coords.latitude, pos.coords.longitude];
  gpsStatus.textContent = 'Précision : ±' + Math.round(pos.coords.accuracy) + ' m';

  if (!gpsMarker) {
    gpsMarker = L.circleMarker(latlng, {
      radius: 8,
      color: '#fff',
      weight: 2,
      fillColor: '#1976d2',
      fillOpacity: 1
    }).addTo(map);
    gpsAccuracyCircle = L.circle(latlng, {
      radius: pos.coords.accuracy,
      color: '#1976d2',
      weight: 1,
      fillColor: '#1976d2',
      fillOpacity: 0.12
    }).addTo(map);
  } else {
    gpsMarker.setLatLng(latlng);
    gpsAccuracyCircle.setLatLng(latlng);
    gpsAccuracyCircle.setRadius(pos.coords.accuracy);
  }

  if (gpsFirstFix) {
    map.setView(latlng, Math.max(map.getZoom(), 15));
    gpsFirstFix = false;
  }
}

function onGpsError(err) {
  gpsStatus.textContent = 'Erreur GPS : ' + err.message;
  checkboxGps.checked = false;
  stopGps();
}

/* ---------- Initialisation ---------- */

refreshGeolLayer();

/* ---------- Service worker ---------- */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js');
  });
}
