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
    const body = (await req.json()) as { action: string; phone?: string; code?: string; password?: string; session?: string };
    const db = svc();

    if (body.action === "status") {
      const { data } = await db.from("tg_session").select("session").eq("id", "default").maybeSingle();
      return json({ connected: !!data?.session });
    }

    // Выдаём строку сессии читающего аккаунта вошедшим пользователям — чтение
    // закрытых каналов выполняется в браузере (GramJS на edge не работает).
    if (body.action === "get_session") {
      const auth = req.headers.get("authorization")?.replace("Bearer ", "");
      if (!auth) return json({ error: "нужен вход" }, 401);
      const { data: u } = await db.auth.getUser(auth);
      if (!u.user) return json({ error: "нужен вход" }, 401);
      const { data } = await db.from("tg_session").select("session").eq("id", "default").maybeSingle();
      return json({ session: data?.session ?? null });
    }

    if (!(await isAdmin(req))) return json({ error: "только администратор" }, 403);

    if (body.action === "send_code") {
      if (!body.phone) return json({ error: "нет номера" }, 400);
      const { Client, StorageMemory } = await mt();
      const phone = body.phone;
      // deno-lint-ignore no-explicit-any
      const store = async (c: any) => {
        const authStr = await c.exportAuthString();
        await db.from("tg_session").upsert({ id: "default", tmp_session: authStr, phone_code_hash: null, session: null });
        await c.disconnect();
      };
      const errs: string[] = [];
      // A: sendCode без ручного connect (MTKruto коннектится сам)
      try {
        const c = new Client({ storage: new StorageMemory(), apiId: API_ID, apiHash: API_HASH });
        await c.sendCode(phone);
        await store(c);
        return json({ ok: true });
      } catch (e) {
        errs.push("A:" + ((e as Error).message || String(e)) + "/" + ((e as { constructor?: { name?: string } }).constructor?.name));
      }
      // B: connect, затем sendCode
      try {
        const c = new Client({ storage: new StorageMemory(), apiId: API_ID, apiHash: API_HASH });
        await c.connect();
        await c.sendCode(phone);
        await store(c);
        return json({ ok: true });
      } catch (e) {
        errs.push("B:" + ((e as Error).message || String(e)) + "/" + ((e as { constructor?: { name?: string } }).constructor?.name));
      }
      return json({ error: "DIAG " + errs.join("  ||  ") }, 500);
    }

    if (body.action === "sign_in") {
      const { data: row } = await db.from("tg_session").select("*").eq("id", "default").single();
      if (!row?.tmp_session) return json({ error: "сначала запросите код" }, 400);
      const client = await makeClient(row.tmp_session);
      try {
        await client.checkCode(body.code);
      } catch (e) {
        const msg = (e as Error).message || String(e);
        await client.disconnect();
        if (/password/i.test(msg)) {
          return json({ error: "На аккаунте включена 2FA. Отключите облачный пароль (Настройки → Конфиденциальность → Облачный пароль) и повторите." }, 400);
        }
        return json({ error: msg }, 400);
      }
      const sess = await client.exportAuthString();
      await db.from("tg_session").update({ session: sess, tmp_session: null, phone_code_hash: null }).eq("id", "default");
      await client.disconnect();
      return json({ ok: true, connected: true });
    }

    if (body.action === "set_session") {
      if (!body.session || body.session.length < 10) return json({ error: "пустая строка сессии" }, 400);
      await db.from("tg_session").update({ session: body.session.trim(), tmp_session: null, phone_code_hash: null }).eq("id", "default");
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
