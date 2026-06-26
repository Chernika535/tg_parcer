// Подключение «читающего» Telegram-аккаунта по MTProto (GramJS).
// Одноразовый вход: send_code → sign_in (+ 2FA password). Сессия хранится в БД.
// Доступно только администратору приложения.
//
// ВНИМАНИЕ: используются публичные api_id/api_hash официального клиента (по запросу
// пользователя). Это вне правил Telegram и повышает риск блокировки аккаунта —
// использовать только на отдельном аккаунте.
import { TelegramClient } from "npm:telegram@2.22.2";
import { StringSession } from "npm:telegram@2.22.2/sessions";
import { Api } from "npm:telegram@2.22.2";
import { computeCheck } from "npm:telegram@2.22.2/Password";
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

function svc() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

async function requireAdmin(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!auth) return false;
  const db = svc();
  const { data } = await db.auth.getUser(auth);
  if (!data.user) return false;
  const { data: prof } = await db.from("profiles").select("role").eq("id", data.user.id).single();
  return prof?.role === "admin";
}

async function makeClient(sess: string): Promise<TelegramClient> {
  const client = new TelegramClient(new StringSession(sess), API_ID, API_HASH, {
    connectionRetries: 3,
    useWSS: true,
  });
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

    if (!(await requireAdmin(req))) return json({ error: "только администратор" }, 403);

    if (body.action === "send_code") {
      if (!body.phone) return json({ error: "нет номера" }, 400);
      const client = await makeClient("");
      const res = await client.sendCode({ apiId: API_ID, apiHash: API_HASH }, body.phone);
      const tmp = client.session.save() as unknown as string;
      await db.from("tg_session").upsert({
        id: "default",
        tmp_session: tmp,
        phone_code_hash: res.phoneCodeHash,
        session: null,
      });
      await client.disconnect();
      return json({ ok: true });
    }

    if (body.action === "sign_in") {
      const { data: row } = await db.from("tg_session").select("*").eq("id", "default").single();
      if (!row?.tmp_session) return json({ error: "сначала запросите код" }, 400);
      const client = await makeClient(row.tmp_session);
      try {
        await client.invoke(
          new Api.auth.SignIn({
            phoneNumber: body.phone!,
            phoneCodeHash: row.phone_code_hash!,
            phoneCode: body.code!,
          }),
        );
      } catch (e) {
        const msg = (e as { errorMessage?: string; message?: string }).errorMessage ||
          (e as Error).message || String(e);
        if (msg.includes("SESSION_PASSWORD_NEEDED")) {
          if (!body.password) {
            await client.disconnect();
            return json({ need_password: true });
          }
          const pwd = await client.invoke(new Api.account.GetPassword());
          const check = await computeCheck(pwd, body.password);
          await client.invoke(new Api.auth.CheckPassword({ password: check }));
        } else {
          await client.disconnect();
          return json({ error: msg }, 400);
        }
      }
      const sess = client.session.save() as unknown as string;
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
