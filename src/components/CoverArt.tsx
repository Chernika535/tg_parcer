// Стильный детерминированный SVG-паттерн (градиент + мягкие фигуры) для обложек
// лент без своего фото. Никаких букв — только графика.

// Старые ссылки на обложки указывали на прокси /sb старого хостинга Onreza.
// Публичные файлы covers доступны непосредственно через Supabase Storage.
function coverUrl(url: string): string {
  try {
    const u = new URL(url, window.location.origin);
    if ((u.hostname === "polistay.online" || u.hostname === "www.polistay.online" || u.hostname.endsWith(".pages.dev")) && u.pathname.startsWith("/sb/storage/v1/object/public/covers/")) {
      return "https://kklxahjnptrgnwcrpauh.supabase.co" + u.pathname.slice(3) + u.search;
    }
  } catch { /* сохраняем исходную ссылку */ }
  return url;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const PALETTES: [string, string, string][] = [
  ["#00b8a9", "#18d0b6", "#9af0e3"],
  ["#7c5cff", "#b18bff", "#ff9ad1"],
  ["#ff6b6b", "#ff9f6b", "#ffd36b"],
  ["#3a86ff", "#5fa8ff", "#9bd0ff"],
  ["#ff7eb3", "#ff65a3", "#7afcff"],
  ["#23a6d5", "#23d5ab", "#a6f7d5"],
  ["#f6d365", "#fda085", "#ffb3a7"],
  ["#5f6df0", "#a06bff", "#e0a6ff"],
];

export default function CoverArt({
  seed,
  src,
  className,
}: {
  seed: string;
  src?: string | null;
  className?: string;
}) {
  if (src) {
    return <img className={className} src={coverUrl(src)} alt="" loading="lazy" style={{ objectFit: "cover" }} />;
  }
  const h = hash(seed || "x");
  const pal = PALETTES[h % PALETTES.length];
  const id = `g${h.toString(36)}`;
  const r = (n: number) => (hash(seed + n) % 1000) / 1000;
  const angle = 90 + (h % 80);

  return (
    <svg className={className} viewBox="0 0 200 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={id} gradientTransform={`rotate(${angle} .5 .5)`}>
          <stop offset="0%" stopColor={pal[0]} />
          <stop offset="100%" stopColor={pal[1]} />
        </linearGradient>
        <radialGradient id={`${id}b`}>
          <stop offset="0%" stopColor={pal[2]} stopOpacity="0.85" />
          <stop offset="100%" stopColor={pal[2]} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="200" height="120" fill={`url(#${id})`} />
      <circle cx={40 + r(1) * 120} cy={r(2) * 100} r={34 + r(3) * 26} fill={`url(#${id}b)`} />
      <circle cx={r(4) * 200} cy={40 + r(5) * 70} r={26 + r(6) * 30} fill="#fff" opacity="0.12" />
      <circle cx={140 + r(7) * 60} cy={80 + r(8) * 40} r={20 + r(9) * 24} fill="#000" opacity="0.06" />
    </svg>
  );
}
