/**
 * Fonts bundled in /assets/fonts. libass selects fonts by family name + bold
 * flag, so each (family, weight) pair maps to the name libass must see.
 */
export interface FontFace {
  family: string;
  weight: number;
  assName: string;
  bold: boolean;
  file: string;
}

export const FONT_FACES: FontFace[] = [
  { family: "Montserrat", weight: 700, assName: "Montserrat", bold: true, file: "Montserrat-Bold.ttf" },
  { family: "Montserrat", weight: 800, assName: "Montserrat ExtraBold", bold: false, file: "Montserrat-ExtraBold.ttf" },
  { family: "Montserrat", weight: 900, assName: "Montserrat Black", bold: false, file: "Montserrat-Black.ttf" },
  { family: "Bebas Neue", weight: 400, assName: "Bebas Neue", bold: false, file: "BebasNeue-Regular.ttf" },
];

export const AVAILABLE_FONT_FAMILIES = [...new Set(FONT_FACES.map((f) => f.family))];

/** Closest bundled face for a requested family/weight; falls back to Montserrat. */
export function resolveFont(family: string, weight: number): FontFace {
  const wanted = family.trim().toLowerCase();
  let faces = FONT_FACES.filter((f) => f.family.toLowerCase() === wanted);
  if (faces.length === 0) faces = FONT_FACES.filter((f) => f.family === "Montserrat");
  return faces.reduce((best, f) => (Math.abs(f.weight - weight) < Math.abs(best.weight - weight) ? f : best));
}
