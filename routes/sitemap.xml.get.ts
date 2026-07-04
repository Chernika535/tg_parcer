// Динамический sitemap: корень, список лент и каждая публичная лента (/feed/:id).
// Обновляется сам по мере появления новых лент.
const SITE = "https://tgparser-feed.onreza.app";

type Feed = { id: number; updated_at?: string; created_at?: string };

export default defineEventHandler(async (event) => {
  const urls: { loc: string; lastmod?: string }[] = [
    { loc: `${SITE}/` },
    { loc: `${SITE}/feeds` },
    { loc: `${SITE}/tags` },
  ];

  try {
    const origin = getRequestURL(event).origin;
    const cfg = (await $fetch("/config.json", { baseURL: origin }).catch(() => null)) as
      | { supabaseUrl?: string; supabaseAnonKey?: string }
      | null;
    const base = process.env.SUPABASE_URL || cfg?.supabaseUrl || "https://kklxahjnptrgnwcrpauh.supabase.co";
    const key = cfg?.supabaseAnonKey || process.env.SUPABASE_ANON_KEY || "";
    const data = (await $fetch(`${base}/functions/v1/feeds`, {
      query: { apikey: key, action: "public" },
    }).catch(() => null)) as { feeds?: Feed[] } | null;
    for (const f of data?.feeds ?? []) {
      urls.push({ loc: `${SITE}/feed/${f.id}`, lastmod: (f.updated_at || f.created_at)?.slice(0, 10) });
    }
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
