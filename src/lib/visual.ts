// Детерминированные красивые обложки/градиенты из строки (название ленты/канала),
// когда пользователь не задал своё изображение.

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

// Палитра приятных пар оттенков (HSL hue), сочетается с акцентами приложения.
const PAIRS: [number, number][] = [
  [168, 192], // teal → cyan
  [255, 320], // violet → pink
  [12, 38], // coral → orange
  [200, 250], // blue → indigo
  [140, 168], // green → teal
  [330, 8], // pink → red
  [40, 60], // amber → yellow
  [275, 200], // purple → blue
];

export function coverGradient(seed: string): string {
  const h = hash(seed || "x");
  const [a, b] = PAIRS[h % PAIRS.length];
  const angle = 110 + (h % 40);
  return `linear-gradient(${angle}deg, hsl(${a} 75% 62%), hsl(${b} 72% 55%))`;
}

export function softGradient(seed: string): string {
  const h = hash(seed || "x");
  const [a, b] = PAIRS[h % PAIRS.length];
  return `linear-gradient(135deg, hsl(${a} 80% 92%), hsl(${b} 80% 88%))`;
}

export function initials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "•";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
