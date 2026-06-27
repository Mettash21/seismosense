// generate-icons.js
// Ejecutar con: node generate-icons.js
// Genera todos los iconos PWA necesarios sin dependencias externas

const { createCanvas } = (() => {
  try { return require('canvas'); }
  catch { return null; }
})() || {};

const fs = require('fs');
const path = require('path');

const SIZES = [72, 96, 128, 192, 512];
const ICONS_DIR = path.join(__dirname, 'icons');

if (!fs.existsSync(ICONS_DIR)) fs.mkdirSync(ICONS_DIR, { recursive: true });

// Si no tiene canvas instalado, genera SVGs inline que funcionan como íconos
function generateSVGIcon(size) {
  const s = size;
  const cx = s / 2;
  const cy = s / 2;
  const r = s * 0.45;

  // Coordenadas de la onda sísmica escalada
  const wavePoints = [
    [s*0.12, cy], [s*0.25, cy], [s*0.33, cy*0.35],
    [s*0.41, cy*1.65], [s*0.49, cy*0.55], [s*0.57, cy*1.35],
    [s*0.65, cy], [s*0.77, cy], [s*0.83, cy*0.5], [s*0.88, cy]
  ].map(p => p.join(',')).join(' ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#0f1830"/>
      <stop offset="100%" stop-color="#060a14"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#3d8bff" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#3d8bff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  
  <!-- Background -->
  <rect width="${s}" height="${s}" rx="${s*0.18}" fill="url(#bg)"/>
  
  <!-- Glow -->
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#glow)"/>
  
  <!-- Outer ring -->
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#1e2d4a" stroke-width="${s*0.025}"/>
  
  <!-- Inner ring -->
  <circle cx="${cx}" cy="${cy}" r="${r*0.75}" fill="none" stroke="#1e2d4a" stroke-width="${s*0.012}" stroke-dasharray="${s*0.06} ${s*0.04}"/>
  
  <!-- Seismic wave -->
  <polyline 
    points="${wavePoints}"
    fill="none" 
    stroke="#3d8bff" 
    stroke-width="${s*0.04}" 
    stroke-linecap="round" 
    stroke-linejoin="round"
  />
  
  <!-- Center dot -->
  <circle cx="${cx}" cy="${cy}" r="${s*0.04}" fill="#e74c3c"/>
  <circle cx="${cx}" cy="${cy}" r="${s*0.025}" fill="#ff6b6b"/>
</svg>`;
}

function generateBadgeSVG(size) {
  const s = size;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <rect width="${s}" height="${s}" rx="${s*0.2}" fill="#060a14"/>
  <circle cx="${s/2}" cy="${s/2}" r="${s*0.35}" fill="#e74c3c"/>
  <text x="${s/2}" y="${s/2+s*0.12}" text-anchor="middle" 
    font-family="Arial" font-size="${s*0.4}" font-weight="bold" fill="white">!</text>
</svg>`;
}

// Write SVG icons (work as PWA icons in most browsers)
SIZES.forEach(size => {
  const svgContent = generateSVGIcon(size);
  // Save as SVG with .png extension trick — actually save proper SVGs
  fs.writeFileSync(path.join(ICONS_DIR, `icon-${size}.svg`), svgContent);
  console.log(`✓ Generated icon-${size}.svg`);
});

// Badge
fs.writeFileSync(path.join(ICONS_DIR, 'badge-96.svg'), generateBadgeSVG(96));
console.log('✓ Generated badge-96.svg');

console.log('\n⚠ Nota: Los iconos se generaron como SVG.');
console.log('Para PNG, ejecuta: npm install canvas && node generate-icons.js');
console.log('O convierte los SVG a PNG en: https://cloudconvert.com/svg-to-png');
console.log('\nAlternativamente, usa los SVGs directamente actualizando manifest.json');
console.log('con type: "image/svg+xml" en lugar de "image/png"');
