/* =========================================================
   宇宙どうぶつ ジェネレーター（FQT LIFE COUNTER方式を移植）
   ・15パーツ（体・耳・目・口・鼻・しっぽ・羽・角・アンテナ・手・足・
     模様・背景・色・星）の組み合わせにより理論上9京通り以上
   ・このゲームでは13種の「人氣者」を進化の"最終形"として設定し、
     愛が育つ(=進化ステージが上がる)につれてパーツが1つずつ解放され、
     色も少しずつ本来の色に近づいていく、というかたちで実装した。
   ========================================================= */

// 体・パーツの色（68色）— FQT LIFE COUNTER本体と共通のパレット
const BODY_COLORS = [
  '#FFB3C6','#FFD6A5','#FFF3B0','#CDEAC0','#B5EAD7','#A0E7E5','#B4D4FF','#C7B7F5',
  '#F5B7EE','#F7A6A6','#FFDAC1','#E2F0CB','#B5D8EB','#D0BFFF','#FFC6FF','#9BF6FF',
  '#CAFFBF','#FDFFB6','#FFADAD','#A0C4FF','#BDB2FF','#FFC8DD','#BDE0FE','#A2D2FF',
  '#FFAFCC','#CDB4DB','#E4C1F9','#F1FFC4','#B8F2E6','#AED9E0',
  '#FFCFD2','#F1C0E8','#CFBAF0','#A3C4F3','#90DBF4','#8EECF5','#98F5E1','#B9FBC0',
  '#FBF8CC','#FDE4CF','#FFCB77','#F4B942','#EBC8FF','#D9B8FF','#C4A7FF','#B2A3FF',
  '#A6C3FF','#9DDAFF','#8FE3E8','#95E8D9','#B0EFC0','#D4F0A0','#F0E0A0','#F5C6A0',
  '#F5B0B0','#F5A0C6','#E0A0F0','#C0A0F5','#A0B0F5','#A0D0F5','#A0F0E0','#A0F0B0',
  '#D0F0A0','#F0D0A0','#F0A0A0','#F0A0D0','#C6E2FF','#FFDEE9'
];
const PATTERN_COLORS = ['#FFFFFF','#FFE5EC','#FFF1E6','#E8F6EF','#EAE4F5','#FFF9DB','#E7F5FF','#FDF0FF'];
const BG_COLORS = [
  '#1B2A55','#2A1B55','#1B4055','#551B3A','#1B5540','#3A1B55','#551B1B','#1B3A55',
  '#402A6E','#2A4E6E','#6E2A55','#2A6E4E','#6E4E2A','#4E2A6E','#2A6E6E','#6E2A2A',
  '#28304F','#4F284A','#284F3E','#4F3E28'
];
const NEUTRAL_BG_COLOR = '#1A1224';

function splitVariant(index, templateCount) {
  return { t: index % templateCount, v: Math.floor(index / templateCount) };
}

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// hex → HSL（h:0-360, s/l:0-100）
function hexToHsl(hex) {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn: h = (gn - bn) / d + (gn < bn ? 6 : 0); break;
      case gn: h = (bn - rn) / d + 2; break;
      default: h = (rn - gn) / d + 4;
    }
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

function hslCss(h, s, l) {
  return `hsl(${((h % 360) + 360) % 360}, ${s}%, ${l}%)`;
}

/**
 * 「反対色から本来の色へ」— 色相だけを180度分、progress(0〜1)に応じて回転させる。
 * progress=0: 本来の色相+180°（補色）から開始
 * progress=1: 本来の色相にぴったり一致
 */
function growingColor(targetHex, progress) {
  const { h, s, l } = hexToHsl(targetHex);
  const startHue = h + 180;
  const currentHue = startHue + progress * 180; // 180°分だけ順方向に回転
  return hslCss(currentHue, s, l);
}

/* ---------- 各パーツのSVGビルダー（FQT本体と同じロジック） ---------- */
function buildBackgroundSVG(bgIndex, idPrefix, bgColor) {
  const gradId = `${idPrefix}-bgGrad`;
  return `
    <defs>
      <radialGradient id="${gradId}" cx="50%" cy="42%" r="70%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.22"/>
        <stop offset="55%" stop-color="${bgColor}"/>
        <stop offset="100%" stop-color="${bgColor}" stop-opacity="0.9"/>
      </radialGradient>
    </defs>
    <rect x="0" y="0" width="200" height="200" fill="url(#${gradId})"/>`;
}

function buildStarsSVG(starIndex) {
  const { t, v } = splitVariant(starIndex, 5);
  const counts = [4, 6, 9, 12, 16];
  const count = counts[t];
  const sizeBase = 1.2 + v * 0.5;
  let stars = '', seed = starIndex * 9973 + 17;
  function nextRand() { seed = (seed * 48271) % 2147483647; return (seed % 1000) / 1000; }
  for (let i = 0; i < count; i++) {
    const x = (nextRand() * 180 + 10).toFixed(1);
    const y = (nextRand() * 90 + 5).toFixed(1);
    const r = (sizeBase * (0.6 + nextRand() * 0.8)).toFixed(1);
    const op = (0.5 + nextRand() * 0.5).toFixed(2);
    stars += `<circle cx="${x}" cy="${y}" r="${r}" fill="#ffffff" opacity="${op}"/>`;
  }
  return `<g>${stars}</g>`;
}

function buildTailSVG(tailIndex, color) {
  const { t, v } = splitVariant(tailIndex, 4);
  const curl = 10 + v * 8;
  const templates = [
    `M60,140 Q${20 - curl},150 ${15 - curl},110`,
    `M60,140 Q${10 - curl},130 ${20 - curl},90`,
    `M60,150 Q${25 - curl},170 ${40 - curl},185`,
    `M60,140 Q${5 - curl},110 ${30 - curl},80`
  ];
  return `<path d="${templates[t]}" stroke="${color}" stroke-width="14" fill="none" stroke-linecap="round"/>`;
}

function buildWingSVG(wingIndex, color) {
  const { t, v } = splitVariant(wingIndex, 2);
  const spread = 18 + v * 5, tilt = v * 4;
  const shape = t === 0
    ? `M0,0 Q-${28 + spread},-${10 + tilt} -${20 + spread},20 Q-10,10 0,0`
    : `M0,0 Q-${20 + spread},-${20 + tilt} -${10 + spread},25 Q-5,15 0,0`;
  return `<g opacity="0.9">
    <path d="${shape}" fill="${color}" opacity="0.55" transform="translate(38,95)"/>
    <path d="${shape}" fill="${color}" opacity="0.55" transform="translate(162,95) scale(-1,1)"/>
  </g>`;
}

function buildHornSVG(hornIndex, color) {
  const { t, v } = splitVariant(hornIndex, 2);
  const len = 16 + v * 4;
  if (t === 0) return `<path d="M100,55 Q96,${55 - len} 100,${40 - len}" stroke="${color}" stroke-width="8" fill="none" stroke-linecap="round"/>`;
  return `<path d="M85,58 Q78,${58 - len} 74,${45 - len}" stroke="${color}" stroke-width="7" fill="none" stroke-linecap="round"/>
    <path d="M115,58 Q122,${58 - len} 126,${45 - len}" stroke="${color}" stroke-width="7" fill="none" stroke-linecap="round"/>`;
}

function buildAntennaSVG(antennaIndex, color) {
  const { t, v } = splitVariant(antennaIndex, 2);
  const ballR = 4 + v * 1.2;
  if (t === 0) return `<line x1="100" y1="55" x2="100" y2="32" stroke="${color}" stroke-width="3"/><circle cx="100" cy="30" r="${ballR}" fill="${color}"/>`;
  return `<line x1="90" y1="56" x2="82" y2="30" stroke="${color}" stroke-width="3"/><circle cx="81" cy="27" r="${ballR}" fill="${color}"/>
    <line x1="110" y1="56" x2="118" y2="30" stroke="${color}" stroke-width="3"/><circle cx="119" cy="27" r="${ballR}" fill="${color}"/>`;
}

function buildEarSVG(earIndex, color) {
  const { t, v } = splitVariant(earIndex, 4);
  const size = 16 + v * 2.4, angle = v * 6;
  const shapes = [
    (cx, sign) => `<ellipse cx="${cx}" cy="${52 - size * 0.3}" rx="${size * 0.55}" ry="${size * 0.7}" fill="${color}" transform="rotate(${sign * angle} ${cx} 60)"/>`,
    (cx, sign) => `<path d="M${cx - size * 0.4},60 Q${cx},${60 - size * 1.4} ${cx + size * 0.4},60 Z" fill="${color}" transform="rotate(${sign * angle} ${cx} 60)"/>`,
    (cx, sign) => `<ellipse cx="${cx}" cy="68" rx="${size * 0.4}" ry="${size * 0.9}" fill="${color}" transform="rotate(${sign * (angle + 20)} ${cx} 58)"/>`,
    (cx, sign) => `<circle cx="${cx}" cy="${55 - size * 0.2}" r="${size * 0.6}" fill="${color}" transform="rotate(${sign * angle} ${cx} 60)"/>`
  ];
  const fn = shapes[t];
  return `${fn(62, -1)}${fn(138, 1)}`;
}

function buildEyeSVG(eyeIndex) {
  const { t, v } = splitVariant(eyeIndex, 4);
  const r = 9 + v * 1.4;
  const shapes = [
    (cx) => `<circle cx="${cx}" cy="95" r="${r}" fill="#2b2b2b"/><circle cx="${cx - 2}" cy="92" r="${r * 0.32}" fill="#ffffff"/>`,
    (cx) => `<ellipse cx="${cx}" cy="97" rx="${r}" ry="${r * 0.8}" fill="#2b2b2b"/><circle cx="${cx - 2}" cy="94" r="${r * 0.3}" fill="#ffffff"/>`,
    (cx) => `<ellipse cx="${cx}" cy="93" rx="${r}" ry="${r * 0.85}" fill="#2b2b2b" transform="rotate(-8 ${cx} 93)"/><circle cx="${cx - 1}" cy="90" r="${r * 0.3}" fill="#ffffff"/>`,
    (cx) => `<circle cx="${cx}" cy="95" r="${r * 1.05}" fill="#2b2b2b"/><circle cx="${cx - 3}" cy="91" r="${r * 0.35}" fill="#ffffff"/><circle cx="${cx + 2}" cy="97" r="${r * 0.2}" fill="#ffffff"/>`
  ];
  const fn = shapes[t];
  return `${fn(80)}${fn(120)}`;
}

function buildNoseSVG(noseIndex, color) {
  const { t } = splitVariant(noseIndex, 5);
  const shapes = [
    `<circle cx="100" cy="108" r="2.6" fill="${color}"/>`,
    `<ellipse cx="100" cy="108" rx="3.4" ry="2.4" fill="${color}"/>`,
    `<path d="M97,106 L103,106 L100,111 Z" fill="${color}"/>`,
    `<path d="M100,110 Q97,105 94,108 Q97,113 100,110 Q103,105 106,108 Q103,113 100,110 Z" fill="${color}" transform="scale(0.6) translate(66,72)"/>`,
    `<rect x="97.5" y="105.5" width="5" height="4" rx="2" fill="${color}"/>`
  ];
  return shapes[t];
}

function buildMouthSVG(mouthIndex) {
  const { t, v } = splitVariant(mouthIndex, 5);
  const w = 6 + v * 2;
  const shapes = [
    `<path d="M${100 - w},116 Q100,${122 + v} ${100 + w},116" stroke="#7a4a3a" stroke-width="2.2" fill="none" stroke-linecap="round"/>`,
    `<ellipse cx="100" cy="118" rx="${w * 0.6}" ry="${w * 0.5}" fill="#7a4a3a"/>`,
    `<path d="M${100 - w},119 Q100,${116 - v} ${100 + w},119" stroke="#7a4a3a" stroke-width="2.2" fill="none" stroke-linecap="round"/>`,
    `<line x1="${100 - w}" y1="117" x2="${100 + w}" y2="117" stroke="#7a4a3a" stroke-width="2.2" stroke-linecap="round"/>`,
    `<path d="M${100 - w},115 Q100,${124 + v} ${100 + w},115 Q100,${119 + v} ${100 - w},115 Z" fill="#7a4a3a" opacity="0.85"/>`
  ];
  return shapes[t];
}

function buildBodySVG(bodyIndex, color) {
  const { t, v } = splitVariant(bodyIndex, 4);
  const wobble = v * 3;
  const rx = 44 + t * 2, ry = 48 - t * 1.5 + wobble;
  return `<ellipse cx="100" cy="105" rx="${rx}" ry="${ry}" fill="${color}"/>`;
}

function buildPatternSVG(patternIndex, patternColor) {
  const { t, v } = splitVariant(patternIndex, 6);
  const opacity = (0.35 + v * 0.08).toFixed(2);
  if (t === 0) return '';
  if (t === 1) {
    let dots = '';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      dots += `<circle cx="${(100 + Math.cos(a) * 26).toFixed(1)}" cy="${(110 + Math.sin(a) * 26).toFixed(1)}" r="5" fill="${patternColor}" opacity="${opacity}"/>`;
    }
    return `<g>${dots}</g>`;
  }
  if (t === 2) {
    let lines = '';
    for (let i = 0; i < 4; i++) lines += `<ellipse cx="100" cy="${80 + i * 16}" rx="40" ry="5" fill="${patternColor}" opacity="${opacity}"/>`;
    return `<g>${lines}</g>`;
  }
  if (t === 3) return `<circle cx="72" cy="105" r="7" fill="${patternColor}" opacity="${Number(opacity) + 0.15}"/><circle cx="128" cy="105" r="7" fill="${patternColor}" opacity="${Number(opacity) + 0.15}"/>`;
  if (t === 4) return `<ellipse cx="100" cy="118" rx="22" ry="26" fill="${patternColor}" opacity="${opacity}"/>`;
  return `<path d="M100,128 Q94,120 88,124 Q92,132 100,138 Q108,132 112,124 Q106,120 100,128 Z" fill="${patternColor}" opacity="${Number(opacity) + 0.2}"/>`;
}

function buildHandSVG(handIndex, color) {
  const { t, v } = splitVariant(handIndex, 3);
  const r = 8 + v * 0.8, lift = t * 6;
  return `<circle cx="${62 - v}" cy="${125 - lift}" r="${r}" fill="${color}"/><circle cx="${138 + v}" cy="${125 - lift}" r="${r}" fill="${color}"/>`;
}

function buildFootSVG(footIndex, color) {
  const { t, v } = splitVariant(footIndex, 3);
  const r = 9 + v * 0.8, gap = 16 + t * 4;
  return `<ellipse cx="${100 - gap}" cy="150" rx="${r}" ry="${r * 0.8}" fill="${color}"/><ellipse cx="${100 + gap}" cy="150" rx="${r}" ry="${r * 0.8}" fill="${color}"/>`;
}

/* =========================================================
   進化に応じたパーツ解放スケジュール
   progress(0〜1)は「進化ステージ（14段階＝13回の進化）の進み具合」で決まる。
   体・目・口は最初から見えていて、残り11個のパーツ
  （鼻・耳・手・足・模様・しっぽ・背景・角・アンテナ・羽・星）を
   13回の進化に割り振っている。パーツの種類は11個しか無いため、
   2回だけは新パーツが無く、色の変化だけになる。
   ========================================================= */
const UNLOCK_SCHEDULE = [
  { part: "body",       at: 0 },
  { part: "eye",        at: 0 },
  { part: "mouth",      at: 0 },
  { part: "nose",       at: 1 / 13 },
  { part: "ear",        at: 2 / 13 },
  { part: "hand",       at: 3 / 13 },
  { part: "foot",       at: 4 / 13 },
  { part: "pattern",    at: 5 / 13 },
  { part: "tail",       at: 6 / 13 },
  { part: "background", at: 7 / 13 },
  // 8/13 は新パーツ無し（色の変化のみ）
  { part: "horn",       at: 9 / 13 },
  { part: "antenna",    at: 10 / 13 },
  // 11/13 は新パーツ無し（色の変化のみ）
  { part: "wing",       at: 12 / 13 },
  { part: "star",       at: 1 }
];

function isUnlocked(part, progress) {
  const entry = UNLOCK_SCHEDULE.find(e => e.part === part);
  return entry ? progress >= entry.at : true;
}

/**
 * targetParts: 人氣者13体のうちの1体分の parts オブジェクト（species.json）
 * progress: 0〜1。「答えた設問の割合」と「愛パワーの到達度」の小さい方。
 *           130問構成なら、実質130段階できめ細かく変化する。
 */
function generateCreatureSVG({ targetParts, progress = 0, idPrefix = "c" }) {
  progress = Math.max(0, Math.min(1, progress));

  const targetBody = BODY_COLORS[targetParts.color % BODY_COLORS.length];
  const bodyColor = growingColor(targetBody, progress);
  const patternColor = PATTERN_COLORS[targetParts.pattern % PATTERN_COLORS.length];
  const targetBg = BG_COLORS[targetParts.background % BG_COLORS.length];
  const bgColor = isUnlocked("background", progress)
    ? growingColor(targetBg, Math.min(1, (progress - 0.55) / 0.45))
    : NEUTRAL_BG_COLOR;

  const starCount = isUnlocked("star", progress)
    ? Math.min(targetParts.star, Math.round((targetParts.star + 1) * Math.min(1, progress * 1.3)))
    : 0;

  let svg = "";
  svg += buildBackgroundSVG(targetParts.background, idPrefix, bgColor);
  if (isUnlocked("star", progress)) svg += buildStarsSVG(starCount);
  if (isUnlocked("tail", progress)) svg += buildTailSVG(targetParts.tail, bodyColor);
  if (isUnlocked("wing", progress)) svg += buildWingSVG(targetParts.wing, bodyColor);
  if (isUnlocked("foot", progress)) svg += buildFootSVG(targetParts.foot, bodyColor);
  svg += buildBodySVG(targetParts.body, bodyColor);
  if (isUnlocked("pattern", progress)) svg += buildPatternSVG(targetParts.pattern, patternColor);
  if (isUnlocked("hand", progress)) svg += buildHandSVG(targetParts.hand, bodyColor);
  if (isUnlocked("ear", progress)) svg += buildEarSVG(targetParts.ear, bodyColor);
  if (isUnlocked("horn", progress)) svg += buildHornSVG(targetParts.horn, bodyColor);
  if (isUnlocked("antenna", progress)) svg += buildAntennaSVG(targetParts.antenna, bodyColor);
  svg += buildEyeSVG(targetParts.eye);
  if (isUnlocked("nose", progress)) svg += buildNoseSVG(targetParts.nose, "#7a4a3a");
  svg += buildMouthSVG(targetParts.mouth);

  return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">${svg}</svg>`;
}
