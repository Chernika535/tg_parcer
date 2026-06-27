// Подключение читающего Telegram-аккаунта (MTKruto). Тяжёлая библиотека грузится
// ЛЕНИВО внутри обработчиков, иначе функция падает на старте (503 boot error).
// Публичные api_id/api_hash официального клиента (по запросу пользователя).
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

const API_ID = 2040;
const API_HASH = "b18441a1ff607e10a989891a5462e627";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...cors, "content-type": "application/json" } });

// deno-lint-ignore no-explicit-any
let _mt: any;
async function mt() {
  if (!_mt) _mt = await import("https://deno.land/x/mtkruto/mod.ts");
  return _mt;
}

function svc() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

async function isAdmin(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!auth) return false;
  const db = svc();
  const { data } = await db.auth.getUser(auth);
  if (!data.user) return false;
  const { data: prof } = await db.from("profiles").select("role").eq("id", data.user.id).single();
  return prof?.role === "admin";
}

// deno-lint-ignore no-explicit-any
async function makeClient(authStr?: string): Promise<any> {
  const { Client, StorageMemory } = await mt();
  const client = new Client({ storage: new StorageMemory(), apiId: API_ID, apiHash: API_HASH });
  if (authStr) await client.importAuthString(authStr);
  await client.connect();
  return client;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = (await req.json()) as { action: string; phone?: string; code?: string; password?: string };
    const db = svc();

    if (body.action === "status") {
      const { data } = await db.from("tg_session").select("session").eq("id", "default").maybeSingle();
      return json({ connected: !!data?.session });
    }

    if (!(await isAdmin(req))) return json({ error: "только администратор" }, 403);

    const { checkPassword } = await mt();

    if (body.action === "send_code") {
      if (!body.phone) return json({ error: "нет номера" }, 400);
      const client = await makeClient();
      const sent = (await client.invoke({
        _: "auth.sendCode",
        phone_number: body.phone,
        api_id: API_ID,
        api_hash: API_HASH,
        settings: { _: "codeSettings" },
      })) as { phone_code_hash: string };
      const phoneCodeHash = sent.phone_code_hash;
      const authStr = await client.exportAuthString();
      await db.from("tg_session").upsert({ id: "default", tmp_session: authStr, phone_code_hash: phoneCodeHash, session: null });
      await client.disconnect();
      return json({ ok: true });
    }

    if (body.action === "sign_in") {
      const { data: row } = await db.from("tg_session").select("*").eq("id", "default").single();
      if (!row?.tmp_session) return json({ error: "сначала запросите код" }, 400);
      const client = await makeClient(row.tmp_session);
      try {
        await client.invoke({
          _: "auth.signIn",
          phone_number: body.phone!,
          phone_code_hash: row.phone_code_hash!,
          phone_code: body.code!,
        });
      } catch (e) {
        const msg = (e as Error).message || String(e);
        if (msg.includes("PASSWORD")) {
          if (!body.password) {
            await client.disconnect();
            return json({ need_password: true });
          }
          try {
            const ap = await client.invoke({ _: "account.getPassword" });
            const input = await checkPassword(body.password, ap);
            await client.invoke({ _: "auth.checkPassword", password: input });
          } catch (e2) {
            await client.disconnect();
            return json({ error: "Неверный облачный пароль (2FA): " + ((e2 as Error).message || String(e2)) }, 400);
          }
        } else {
          await client.disconnect();
          return json({ error: msg }, 400);
        }
      }
      const sess = await client.exportAuthString();
      await db.from("tg_session").update({ session: sess, tmp_session: null, phone_code_hash: null }).eq("id", "default");
      await client.disconnect();
      return json({ ok: true, connected: true });
    }

    if (body.action === "disconnect") {
      await db.from("tg_session").update({ session: null, tmp_session: null, phone_code_hash: null }).eq("id", "default");
      return json({ ok: true });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
