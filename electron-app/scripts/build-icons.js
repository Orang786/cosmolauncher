const path = require('path');
const fs   = require('fs');

// Создаём SVG иконку программно если нет PNG
function createSVGIcon() {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="512" height="512" viewBox="0 0 512 512" 
     xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0d0a1a"/>
      <stop offset="100%" style="stop-color:#1a0d2e"/>
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#7c3aed"/>
      <stop offset="100%" style="stop-color:#a855f7"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="8" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  
  <!-- Фон -->
  <rect width="512" height="512" rx="100" fill="url(#bg)"/>
  
  <!-- Внешнее кольцо -->
  <circle cx="256" cy="256" r="180" 
          fill="none" 
          stroke="url(#accent)" 
          stroke-width="3" 
          opacity="0.4"/>
  
  <!-- Внутренний круг -->
  <circle cx="256" cy="256" r="130" 
          fill="url(#accent)" 
          opacity="0.12"/>
  
  <!-- Звезда ✦ -->
  <text x="256" y="290" 
        font-family="Arial, sans-serif"
        font-size="160"
        font-weight="900"
        fill="url(#accent)"
        text-anchor="middle"
        filter="url(#glow)">✦</text>
  
  <!-- Название -->
  <text x="256" y="430"
        font-family="Arial, sans-serif"
        font-size="42"
        font-weight="700"
        fill="#c084fc"
        text-anchor="middle"
        opacity="0.9">COSMO</text>
</svg>`;

  const assetsDir = path.join(__dirname, '../assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  fs.writeFileSync(path.join(assetsDir, 'icon.svg'), svg);
  console.log('✅ SVG иконка создана');
}

createSVGIcon();