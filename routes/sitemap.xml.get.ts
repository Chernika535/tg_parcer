// Динамический sitemap: корень, список лент и каждая публичная лента (/feed/:id).
// Обновляется сам по мере появления новых лент. Домен берём из запроса.
type Feed = { id: number; updated_at?: string; created_at?: string; channels?: string[] };
function normCh(c: string): string {
  return (c || "").trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/^t\.me\//, "").replace(/^s\//, "").replace(/^@/, "")
    .split(/[/?#]/)[0].replace(/[^a-z0-9_]/g, "");
}

export default defineEventHandler(async (event) => {
  const SITE = getRequestURL(event).origin;
  const urls: { loc: string; lastmod?: string }[] = [
    { loc: `${SITE}/` },
    { loc: `${SITE}/feeds` },
    { loc: `${SITE}/tags` },
  ];

  try {
    const origin = SITE;
    const cfg = (await $fetch("/config.json", { baseURL: origin }).catch(() => null)) as
      | { supabaseUrl?: string; supabaseAnonKey?: string }
      | null;
    const base = process.env.SUPABASE_URL || cfg?.supabaseUrl || "https://kklxahjnptrgnwcrpauh.supabase.co";
    const key = cfg?.supabaseAnonKey || process.env.SUPABASE_ANON_KEY || "";
    const data = (await $fetch(`${base}/functions/v1/feeds`, {
      query: { apikey: key, action: "public" },
    }).catch(() => null)) as { feeds?: Feed[] } | null;
    const chans = new Set<string>();
    for (const f of data?.feeds ?? []) {
      urls.push({ loc: `${SITE}/feed/${f.id}`, lastmod: (f.updated_at || f.created_at)?.slice(0, 10) });
      for (const c of f.channels ?? []) { const n = normCh(c); if (n.length >= 3) chans.add(n); }
    }
    // Каждый канал из публичных лент — отдельным адресом (у нас есть страница /channel/:username).
    for (const c of chans) urls.push({ loc: `${SITE}/channel/${c}` });
  } catch {
    /* отдадим хотя бы статические адреса */
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
    .map((u) => `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`)
    .join("\n")}
</urlset>`;
  setResponseHeader(event, "content-type", "application/xml; charset=utf-8");
  return body;
});
