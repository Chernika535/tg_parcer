// Отдельный MTProto-воркер для Deno Deploy (бесплатно, полноценный Deno).
// Эндпоинты:
//   POST /tg-connect  { action: status|send_code|sign_in|disconnect, phone, code, password }
//   POST /read-mt     { channels: string[] }
// Сессию хранит в таблице public.tg_session в Supabase (service role).
//
// ENV (задать в Deno Deploy → Settings → Environment Variables):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Всё тяжёлое грузим лениво (при первом запросе), чтобы старт сервера был
// мгновенным — иначе Deno Deploy валит «Warm up».
// deno-lint-ignore no-explicit-any
let _mt: any;
async function mt() {
  if (!_mt) _mt = await import("https://deno.land/x/mtkruto/mod.ts");
  return _mt;
}
// deno-lint-ignore no-explicit-any
let _createClient: any;
async function loadCreateClient() {
  if (!_createClient) {
    const m = await import("https://esm.sh/@supabase/supabase-js@2.39.8?target=denonext");
    _createClient = m.createClient;
  }
  return _createClient;
}

const API_ID = 2040;
const API_HASH = "b18441a1ff607e10a989891a5462e627";
const LIMIT = 20;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...cors, "content-type": "application/json" } });

async function svc() {
  const createClient = await loadCreateClient();
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

async function isAdmin(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!auth) return false;
  const db = await svc();
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

async function handleConnect(req: Request): Promise<Response> {
  const body = (await req.json()) as { action: string; phone?: string; code?: string; password?: string };
  const db = await svc();

  if (body.action === "status") {
    const { data } = await db.from("tg_session").select("session").eq("id", "default").maybeSingle();
    return json({ connected: !!data?.session });
  }

  if (!(await isAdmin(req))) return json({ error: "только администратор" }, 403);

  const { functions, types } = await mt();

  if (body.action === "send_code") {
    if (!body.phone) return json({ error: "нет номера" }, 400);
    const client = await makeClient();
    const sent = await client.invoke(
      new functions.auth.sendCode({
        phoneNumber: body.phone,
        apiId: API_ID,
        apiHash: API_HASH,
        settings: new types.CodeSettings({}),
      }),
    );
    const phoneCodeHash = (sent as unknown as { phoneCodeHash: string }).phoneCodeHash;
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
      await client.invoke(
        new functions.auth.signIn({
          phoneNumber: body.phone!,
          phoneCodeHash: row.phone_code_hash!,
          phoneCode: body.code!,
        }),
      );
    } catch (e) {
      const msg = (e as Error).message || String(e);
      if (msg.includes("PASSWORD")) {
        if (!body.password) {
          await client.disconnect();
          return json({ need_password: true });
        }
        try {
          await (client as unknown as { checkPassword: (p: string) => Promise<unknown> }).checkPassword(body.password);
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
}

function norm(input: string): string | null {
  let s = input.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/^t\.me\//, "").replace(/^s\//, "").replace(/^@/, "");
  s = s.split(/[/?#]/)[0].replace(/[^a-z0-9_]/g, "");
  return s.length >= 3 && s.length <= 64 ? s : null;
}

async function handleRead(req: Request): Promise<Response> {
  const db = await svc();
  const { data: row } = await db.from("tg_session").select("session").eq("id", "default").maybeSingle();
  if (!row?.session) return json({ posts: [], unavailable: [], noAccount: true });

  const body = (await req.json()) as { channels?: string[] };
  const channels = [...new Set((body.channels ?? []).map(norm).filter(Boolean) as string[])];
  if (channels.length === 0) return json({ posts: [], unavailable: [] });

  const client = await makeClient(row.session);
  const posts: Record<string, unknown>[] = [];
  const unavailable: string[] = [];
  for (const ch of channels) {
    try {
      const msgs = await client.getHistory("@" + ch, { limit: LIMIT });
      if (!msgs?.length) {
        unavailable.push(ch);
        continue;
      }
      for (const m of msgs) {
        const mm = m as unknown as {
          id: number; text?: string; caption?: string; date?: Date;
          photo?: unknown; video?: unknown; document?: unknown;
        };
        const text = mm.text ?? mm.caption ?? "";
        const hasMedia = !!(mm.photo || mm.video || mm.document);
        if (!text && !hasMedia) continue;
        posts.push({
          channel: ch,
          msgId: mm.id,
          postedAt: (mm.date ? new Date(mm.date) : new Date()).toISOString(),
          text,
          hasMedia,
          media: [],
          link: `https://t.me/${ch}/${mm.id}`,
        });
      }
    } catch (_e) {
      unavailable.push(ch);
    }
  }
  await client.disconnect();
  posts.sort((a, b) => String(b.postedAt).localeCompare(String(a.postedAt)));
  return json({ posts, unavailable });
}

const PORT = Number(Deno.env.get("PORT") ?? 8000);
console.log(`[mt] starting, PORT=${PORT}`);

Deno.serve({ port: PORT }, async (req: Request) => {
  const url = new URL(req.url);
  console.log(`[mt] ${req.method} ${url.pathname}`);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (req.method === "POST" && url.pathname === "/tg-connect") return await handleConnect(req);
    if (req.method === "POST" && url.pathname === "/read-mt") return await handleRead(req);
    return json({ ok: true, service: "mt-worker" });
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
