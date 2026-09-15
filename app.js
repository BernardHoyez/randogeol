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

/* ---------- Identification géologique au clic (GetFeatureInfo) ---------- */

map.on('click', (e) => {
  if (!geolLayer || !selectGeol.value) return;

  const size = map.getSize();
  const bounds = map.getBounds();
  const crs = map.options.crs;
  const sw = crs.project(bounds.getSouthWest());
  const ne = crs.project(bounds.getNorthEast());
  const point = map.latLngToContainerPoint(e.latlng);

  const params = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetFeatureInfo',
    LAYERS: selectGeol.value,
    QUERY_LAYERS: selectGeol.value,
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
  const url = BRGM_WMS_URL + '?' + params.toString();

  const popup = L.popup().setLatLng(e.latlng).setContent('Interrogation du serveur BRGM…').openOn(map);

  fetch(url)
    .then((r) => r.text())
    .then((text) => {
      const content = formatFeatureInfo(text, url);
      popup.setContent(content);
    })
    .catch(() => {
      // Le serveur peut refuser les requêtes cross-origin (fetch) : on propose
      // d'ouvrir la réponse brute dans un nouvel onglet en secours.
      popup.setContent(
        'Impossible d\'interroger le serveur depuis l\'application.<br>' +
        '<a href="' + url + '" target="_blank" rel="noopener">Voir la réponse brute</a>'
      );
    });
});

function formatFeatureInfo(text, rawUrl) {
  const cleaned = text.trim();
  const looksEmpty = cleaned === '' ||
    /no features? were found|aucune donnée|GetFeatureInfo results:\s*$/i.test(cleaned);
  if (looksEmpty) {
    return 'Aucune notation disponible ici pour cette couche ' +
      '(les cartes scannées/harmonisées du BRGM ne publient pas toujours ' +
      'la notation géologique en interrogation directe).<br>' +
      '<a href="' + rawUrl + '" target="_blank" rel="noopener">Voir la réponse brute</a>';
  }
  return '<pre style="white-space:pre-wrap;margin:0;font-size:.8rem;">' +
    escapeHtml(cleaned) + '</pre>';
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
