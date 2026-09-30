// Small, self-contained HSL color-math utility — no dependency added since
// this is ~20 lines of arithmetic. Deliberately duplicated (not shared via a
// module import) in functions/src/colorMath.ts: the Expo app and Cloud
// Functions are separate npm packages with no shared module today, and this
// file is small enough that keeping two copies in sync is cheap compared to
// wiring up a cross-package shared module for it.

export interface Hsl {
  h: number; // 0-360
  s: number; // 0-100
  l: number; // 0-100
}

// @expo/ui's native SwiftUI ColorPicker emits "#RRGGBB" or, when opacity is
// involved, "#RRGGBBAA" (confirmed against ColorPickerView.swift's format
// string "#%02X%02X%02X%02X" — R,G,B, then alpha LAST). Every consumer of
// these colors expects plain 6-digit RGB, so strip a trailing alpha pair
// before doing anything else with the hex string.
function normalizeHex(hex: string): string {
  const bare = hex.replace('#', '');
  return bare.length === 8 ? bare.slice(0, 6) : bare;
}

export function hexToHsl(hex: string): Hsl {
  const bare = normalizeHex(hex);
  const r = parseInt(bare.slice(0, 2), 16) / 255;
  const g = parseInt(bare.slice(2, 4), 16) / 255;
  const b = parseInt(bare.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l: l * 100 };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
    case g: h = (b - r) / d + 2; break;
    default: h = (r - g) / d + 4; break;
  }
  h *= 60;

  return { h, s: s * 100, l: l * 100 };
}

function hueToRgb(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

export function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360 / 360;
  const ss = s / 100;
  const ll = l / 100;

  let r: number, g: number, b: number;
  if (ss === 0) {
    r = g = b = ll;
  } else {
    const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
    const p = 2 * ll - q;
    r = hueToRgb(p, q, hh + 1 / 3);
    g = hueToRgb(p, q, hh);
    b = hueToRgb(p, q, hh - 1 / 3);
  }

  const toHex = (v: number) => {
    const int = Math.round(v * 255);
    return int.toString(16).padStart(2, '0');
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

export interface DerivedBrandPalette {
  background: string; // 97% lightness — page/slide background fill, near-white (matches normal document conventions)
  surface: string;    // 5% lightness — accent panels/cover fills, near-black, used sparingly
  secondary: string;  // 25% lightness — headings, dividers, table borders
  accent: string;      // 65% lightness — highlights, callouts, chart series
}

// One user-chosen Primary color yields the entire tonal palette — same hue
// and saturation throughout, only lightness changes per role.
export function deriveBrandPalette(primaryHex: string): DerivedBrandPalette {
  const { h, s } = hexToHsl(primaryHex);
  return {
    background: hslToHex(h, s, 97),
    surface: hslToHex(h, s, 5),
    secondary: hslToHex(h, s, 25),
    accent: hslToHex(h, s, 65),
  };
}
