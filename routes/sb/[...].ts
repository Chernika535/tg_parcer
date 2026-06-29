// Прокси всех /sb/* запросов в Supabase (межсерверный трафик — провайдер не режет).
export default defineEventHandler((event) => {
  const SUPABASE = process.env.SUPABASE_URL || "https://kklxahjnptrgnwcrpauh.supabase.co";
  const path = event.path.replace(/^\/sb/, "");
  return proxyRequest(event, SUPABASE + path);
});
