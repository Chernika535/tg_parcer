// Supabase Edge Function: вход через Telegram Login Widget.
// Проверяет подпись данных виджета секретом бота (server-side), заводит/находит
// пользователя и выдаёт сессию Supabase через одноразовый OTP (magiclink).
//
// Секреты (Supabase → Project Settings → Edge Functions → Secrets):
//   TELEGRAM_BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

type TgUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

const AUTH_TTL_SECONDS = 86400; // данные виджета считаем валидными сутки

async function verifyTelegram(user: TgUser, botToken: string): Promise<boolean> {
  const { hash, ...rest } = user;
  const dataCheckString = Object.keys(rest)
    .filter((k) => (rest as Record<string, unknown>)[k] !== undefined)
    .sort()
    .map((k) => `${k}=${(rest as Record<string, unknown>)[k]}`)
    .join("\n");

  const enc = new TextEncoder();
  // secret_key = SHA256(bot_token)
  const secretKey = await crypto.subtle.digest("SHA-256", enc.encode(botToken));
  const key = await crypto.subtle.importKey(
    "raw",
    secretKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(dataCheckString));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex !== hash) return false;

  // защита от старых/переигранных данных
  const now = Math.floor(Date.now() / 1000);
  if (now - user.auth_date > AUTH_TTL_SECONDS) return false;
  return true;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  try {
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!botToken || !url || !serviceKey) {
      return jsonResponse({ error: "функция не сконфигурирована (секреты)" }, 500);
    }

    const user = (await req.json()) as TgUser;
    if (!user?.id || !user?.hash) return jsonResponse({ error: "нет данных Telegram" }, 400);

    if (!(await verifyTelegram(user, botToken))) {
      return jsonResponse({ error: "подпись Telegram не прошла проверку" }, 401);
    }

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    const email = `tg${user.id}@telegram.local`;
    const displayName =
      [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || `tg${user.id}`;

    // создаём пользователя (если уже есть — игнорируем ошибку)
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { telegram_id: user.id, username: user.username, display_name: displayName },
    });

    let userId = created?.user?.id;
    if (createErr) {
      // уже существует — найдём его
      const { data: list } = await admin.auth.admin.listUsers();
      userId = list?.users.find((u) => u.email === email)?.id;
    }
    if (!userId) return jsonResponse({ error: "не удалось создать пользователя" }, 500);

    // апсерт профиля (роль не трогаем, чтобы не сбросить админа)
    await admin.from("profiles").upsert(
      {
        id: userId,
        telegram_id: user.id,
        username: user.username ?? null,
        display_name: displayName,
        photo_url: user.photo_url ?? null,
      },
      { onConflict: "id" },
    );

    // одноразовый OTP для входа на клиенте (verifyOtp)
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkErr || !link?.properties?.email_otp) {
      return jsonResponse({ error: "не удалось выдать сессию" }, 500);
    }

    return jsonResponse({ email, otp: link.properties.email_otp });
  } catch (e) {
    return jsonResponse({ error: (e as Error).message }, 500);
  }
});
