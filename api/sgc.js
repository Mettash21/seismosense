// api/sgc.js
// Proxy al catálogo oficial del Servicio Geológico Colombiano (SGC)
// Fuente real: ArcGIS FeatureServer del SGC (srvags.sgc.gov.co)

const SGC_URL = 'https://srvags.sgc.gov.co/arcgis/rest/services/catalogo_sismos/catalogo_de_sismos_2/FeatureServer/0/query';

const DEPT_NAMES = {
  '05': 'Antioquia', '08': 'Atlántico', '11': 'Bogotá D.C.', '13': 'Bolívar',
  '15': 'Boyacá', '17': 'Caldas', '18': 'Caquetá', '19': 'Cauca',
  '20': 'Cesar', '23': 'Córdoba', '25': 'Cundinamarca', '27': 'Chocó',
  '41': 'Huila', '44': 'La Guajira', '47': 'Magdalena', '50': 'Meta',
  '52': 'Nariño', '54': 'Norte de Santander', '63': 'Quindío', '66': 'Risaralda',
  '68': 'Santander', '70': 'Sucre', '73': 'Tolima', '76': 'Valle del Cauca',
  '81': 'Arauca', '85': 'Casanare', '86': 'Putumayo', '88': 'San Andrés y Providencia',
  '91': 'Amazonas', '94': 'Guainía', '95': 'Guaviare', '97': 'Vaupés', '99': 'Vichada'
};

async function fetchWithTimeout(url, ms = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch(e) { clearTimeout(timer); throw e; }
}

function buildPlace(attrs) {
  const rawCode = String(attrs.DEPT_CODIGO || '').trim();
  const code = rawCode.padStart(2, '0');
  const deptName = DEPT_NAMES[code];
  const depth = attrs.ESP_PROFUNDIDAD;
  const depthTxt = depth != null ? ` · ${depth.toFixed(0)}km prof.` : '';
  if (deptName) return `${deptName}, Colombia${depthTxt}`;
  return `Colombia (SGC)${depthTxt}`;
}

// Intentar la consulta con params progresivamente más simples si falla
async function tryQuery(paramsObj) {
  const params = new URLSearchParams(paramsObj);
  const url = `${SGC_URL}?${params.toString()}`;
  const res = await fetchWithTimeout(url, 9000);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'ArcGIS error');
  return data;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const attempts = [
    // Intento 1: consulta simple sin orderBy ni límite (lo más compatible)
    { where: '1=1', outFields: '*', f: 'json', returnGeometry: 'false' },
    // Intento 2: con límite explícito
    { where: '1=1', outFields: '*', f: 'json', returnGeometry: 'false', resultRecordCount: '500' },
    // Intento 3: filtrando solo campos necesarios
    { where: '1=1', outFields: 'OBJECTID,ESP_MAGNITUD,ESP_PROFUNDIDAD,ESP_LATITUD,ESP_LONGITUD,ESP_FECHA,DEPT_CODIGO', f: 'json', returnGeometry: 'false' },
  ];

  let data = null;
  let lastError = null;

  for (const attempt of attempts) {
    try {
      data = await tryQuery(attempt);
      break;
    } catch(e) {
      lastError = e.message;
      console.warn('[SGC Proxy] Intento falló:', JSON.stringify(attempt), '→', e.message);
    }
  }

  if (!data) {
    return res.status(200).json({
      type: 'FeatureCollection',
      features: [],
      error: lastError || 'Todos los intentos de consulta fallaron'
    });
  }

  try {
    const rawFeatures = data.features || [];

    let features = rawFeatures
      .filter(f => f.attributes.ESP_MAGNITUD != null && f.attributes.ESP_LATITUD != null && f.attributes.ESP_LONGITUD != null)
      .map(f => {
        const a = f.attributes;
        return {
          id: `sgc-${a.OBJECTID}`,
          type: 'Feature',
          properties: {
            mag: a.ESP_MAGNITUD,
            place: buildPlace(a),
            time: a.ESP_FECHA || Date.now(),
            url: ''
          },
          geometry: {
            type: 'Point',
            coordinates: [a.ESP_LONGITUD, a.ESP_LATITUD, a.ESP_PROFUNDIDAD || 10]
          }
        };
      });

    // Ordenar por fecha descendente en el servidor (ya que orderByFields falló en ArcGIS)
    features.sort((a, b) => b.properties.time - a.properties.time);
    features = features.slice(0, 300);

    return res.status(200).json({
      type: 'FeatureCollection',
      features,
      source: 'SGC Colombia (oficial)',
      count: features.length,
      fetchedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('[SGC Proxy] Error procesando datos:', error);
    return res.status(200).json({
      type: 'FeatureCollection',
      features: [],
      error: error.message
    });
  }
}
