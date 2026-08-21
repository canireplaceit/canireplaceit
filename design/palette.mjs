/**
 * Build an M3-shaped tonal palette around the existing brand blue.
 *
 * M3's HCT "tone" IS CIE L*, so a tone ramp is an L* ramp at fixed chroma/hue.
 * We work in CIE LCh(ab) — near enough to HCT for a neutral ramp, and exact for
 * the thing that matters here: equal perceptual lightness steps.
 */

const BRAND = "#2f6fed";

/* ---- colour conversion, sRGB <-> Lab/LCh (D65) ---- */
const f2s = v => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const s2f = v => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const rgb2hex = rgb =>
  "#" + rgb.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("");

const M = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.0721750],
  [0.0193339, 0.1191920, 0.9503041],
];
const Mi = [
  [ 3.2404542, -1.5371385, -0.4985314],
  [-0.9692660,  1.8760108,  0.0415560],
  [ 0.0556434, -0.2040259,  1.0572252],
];
const WP = [0.95047, 1.0, 1.08883];

function rgb2lab(rgb) {
  const l = rgb.map(s2f);
  const xyz = M.map(r => r[0] * l[0] + r[1] * l[1] + r[2] * l[2]).map((v, i) => v / WP[i]);
  const f = xyz.map(v => (v > 216 / 24389 ? Math.cbrt(v) : (24389 / 27 * v + 16) / 116));
  return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
}
function lab2rgb([L, a, bb]) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - bb / 200;
  const g = t => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) * 27 / 24389);
  const xyz = [g(fx) * WP[0], L > 8 ? ((L + 16) / 116) ** 3 * WP[1] : L * 27 / 24389 * WP[1], g(fz) * WP[2]];
  return Mi.map(r => r[0] * xyz[0] + r[1] * xyz[1] + r[2] * xyz[2]).map(f2s);
}
const lab2lch = ([L, a, b]) => [L, Math.hypot(a, b), (Math.atan2(b, a) * 180 / Math.PI + 360) % 360];
const lch2lab = ([L, C, h]) => [L, C * Math.cos(h * Math.PI / 180), C * Math.sin(h * Math.PI / 180)];

const inGamut = rgb => rgb.every(v => v >= -0.0005 && v <= 1.0005);

/** Tone -> hex at a hue, reducing chroma until it fits sRGB (M3 does the same). */
function tone(T, C, h) {
  for (let c = C; c >= 0; c -= 0.5) {
    const rgb = lab2rgb(lch2lab([T, c, h]));
    if (inGamut(rgb)) return rgb2hex(rgb);
  }
  return rgb2hex(lab2rgb(lch2lab([T, 0, h])));
}

/* ---- relative luminance + contrast, to verify the pairs ---- */
const lum = hex => {
  const [r, g, b] = hex2rgb(hex).map(s2f);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/* ---- the palettes ---- */
const [BL, BC, BH] = lab2lch(rgb2lab(hex2rgb(BRAND)));
console.log(`brand ${BRAND}  ->  L*=${BL.toFixed(1)} C=${BC.toFixed(1)} h=${BH.toFixed(1)}\n`);

// M3 neutral chroma is very low but not zero — it keeps greys related to the brand.
const N = 3, NV = 7;

const TONES = {
  light: {
    "surface":                   ["N", 98],
    "surface-dim":               ["N", 87],
    "surface-bright":            ["N", 98],
    "surface-container-lowest":  ["N", 100],
    "surface-container-low":     ["N", 96],
    "surface-container":         ["N", 94],
    "surface-container-high":    ["N", 92],
    "surface-container-highest": ["N", 90],
    "on-surface":                ["N", 10],
    "on-surface-variant":        ["NV", 30],
    "outline":                   ["NV", 50],
    "outline-variant":           ["NV", 80],
    "inverse-surface":           ["N", 20],
    "inverse-on-surface":        ["N", 95],
  },
  dark: {
    "surface":                   ["N", 6],
    "surface-dim":               ["N", 6],
    "surface-bright":            ["N", 24],
    "surface-container-lowest":  ["N", 4],
    "surface-container-low":     ["N", 10],
    "surface-container":         ["N", 12],
    "surface-container-high":    ["N", 17],
    "surface-container-highest": ["N", 22],
    "on-surface":                ["N", 90],
    "on-surface-variant":        ["NV", 80],
    "outline":                   ["NV", 60],
    "outline-variant":           ["NV", 30],
    "inverse-surface":           ["N", 90],
    "inverse-on-surface":        ["N", 20],
  },
};

for (const theme of ["light", "dark"]) {
  console.log(`--- ${theme} : neutral surfaces ---`);
  for (const [role, [pal, T]] of Object.entries(TONES[theme])) {
    console.log(`  --${role}: ${tone(T, pal === "N" ? N : NV, BH)};`.padEnd(48) + `/* ${pal}-${T} */`);
  }
  console.log();
}

/* accents: brand + the three verdicts, at M3's accent tones */
const ACCENTS = {
  brand: BH,
  yes:   lab2lch(rgb2lab(hex2rgb("#167a52")))[2],
  almost:lab2lch(rgb2lab(hex2rgb("#a15a05")))[2],
  no:    lab2lch(rgb2lab(hex2rgb("#c62f2f")))[2],
};
const ACCENT_C = { brand: BC, yes: 45, almost: 55, no: 62 };

for (const theme of ["light", "dark"]) {
  console.log(`--- ${theme} : accents ---`);
  for (const [name, h] of Object.entries(ACCENTS)) {
    const C = ACCENT_C[name];
    const main = theme === "light" ? 40 : 80;
    const on   = theme === "light" ? 100 : 20;
    const cont = theme === "light" ? 90 : 30;
    const onC  = theme === "light" ? 10 : 90;
    console.log(
      `  --${name}: ${tone(main, C, h)};`.padEnd(26) +
      `--on-${name}: ${tone(on, C, h)};`.padEnd(26) +
      `--${name}-container: ${tone(cont, C, h)};`.padEnd(34) +
      `--on-${name}-container: ${tone(onC, C, h)};`
    );
  }
  console.log();
}

/* ---- contrast audit of the pairs we will actually ship ---- */
console.log("--- contrast audit (AA needs 4.5 small text / 3.0 large+UI) ---");
const check = (label, fg, bg, need) => {
  const r = contrast(fg, bg);
  console.log(`  ${label.padEnd(46)} ${r.toFixed(2)}:1  ${r >= need ? "PASS" : "**FAIL**"} (need ${need})`);
};
for (const theme of ["light", "dark"]) {
  const T = TONES[theme];
  const g = role => tone(T[role][1], T[role][0] === "N" ? N : NV, BH);
  const acc = (n, t) => tone(t, ACCENT_C[n], ACCENTS[n]);
  const mainT = theme === "light" ? 40 : 80;
  console.log(` [${theme}]`);
  check("on-surface / surface", g("on-surface"), g("surface"), 4.5);
  check("on-surface-variant / surface", g("on-surface-variant"), g("surface"), 4.5);
  check("on-surface-variant / surface-container", g("on-surface-variant"), g("surface-container"), 4.5);
  check("on-surface / surface-container-highest", g("on-surface"), g("surface-container-highest"), 4.5);
  check("outline / surface", g("outline"), g("surface"), 3.0);
  check("outline-variant / surface (decorative)", g("outline-variant"), g("surface"), 1.0);
  check("brand / surface", acc("brand", mainT), g("surface"), 4.5);
  check("yes / surface", acc("yes", mainT), g("surface"), 4.5);
  check("almost / surface", acc("almost", mainT), g("surface"), 4.5);
  check("no / surface", acc("no", mainT), g("surface"), 4.5);
  check("on-brand / brand (button label)", acc("brand", theme === "light" ? 100 : 20), acc("brand", mainT), 4.5);
  console.log();
}
