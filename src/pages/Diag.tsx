import { useState } from "react";
import { appConfig } from "../lib/supabase.ts";
import { TopBar } from "../components/States.tsx";

// Диагностика сети: запускаем разные запросы и показываем результат прямо на
// экране. Нужна, чтобы понять, что именно не проходит в России без VPN.
type Row = { name: string; status: string; ms: number; info: string };

export default function Diag() {
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);

  async function timed(name: string, fn: () => Promise<string>): Promise<Row> {
    const t0 = Date.now();
    try {
      const info = await fn();
      return { name, status: "OK", ms: Date.now() - t0, info };
    } catch (e) {
      return { name, status: "FAIL", ms: Date.now() - t0, info: (e as Error).message };
    }
  }

  async function withTimeout(p: Promise<Response>, ms: number): Promise<Response> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      return await p;
    } finally {
      clearTimeout(t);
    }
  }

  async function run() {
    setRunning(true);
    setRows([]);
    const cfg = appConfig();
    const base = cfg.supabaseUrl.replace(/\/$/, "");
    const key = cfg.supabaseAnonKey;
    const out: Row[] = [];

    // 1. Картинка-прокси (GET функции) — браузерный fetch.
    out.push(
      await timed("1. img GET (функция)", async () => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 15000);
        const r = await fetch(`${base}/functions/v1/img?u=https://telegram.org/img/t_logo.png`, { signal: ctrl.signal }).finally(() => clearTimeout(t));
        return `HTTP ${r.status}, ${r.headers.get("content-type")}`;
      }),
    );
    setRows([...out]);

    // 2. feeds GET (функция, ключ в query).
    out.push(
      await timed("2. feeds GET (функция)", async () => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 15000);
        const r = await fetch(`${base}/functions/v1/feeds?apikey=${encodeURIComponent(key)}&action=public`, { signal: ctrl.signal }).finally(() => clearTimeout(t));
        const txt = await r.text();
        return `HTTP ${r.status}, ${txt.slice(0, 80)}`;
      }),
    );
    setRows([...out]);

    // 3. read-channels GET (функция).
    out.push(
      await timed("3. read-channels GET", async () => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 15000);
        const r = await fetch(`${base}/functions/v1/read-channels?apikey=${encodeURIComponent(key)}&channels=durov`, { signal: ctrl.signal }).finally(() => clearTimeout(t));
        const txt = await r.text();
        return `HTTP ${r.status}, ${txt.slice(0, 80)}`;
      }),
    );
    setRows([...out]);

    // 4. feeds POST (функция) — для сравнения GET vs POST.
    out.push(
      await timed("4. feeds POST (функция)", async () => {
        const r = await withTimeout(
          fetch(`${base}/functions/v1/feeds?apikey=${encodeURIComponent(key)}`, {
            method: "POST",
            headers: { "content-type": "text/plain;charset=UTF-8" },
            body: JSON.stringify({ action: "public" }),
          }),
          15000,
        );
        const txt = await r.text();
        return `HTTP ${r.status}, ${txt.slice(0, 80)}`;
      }),
    );
    setRows([...out]);

    // 5. REST GET (таблица feeds напрямую).
    out.push(
      await timed("5. REST GET (/rest/v1)", async () => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 15000);
        const r = await fetch(`${base}/rest/v1/feeds?select=id&limit=1`, {
          headers: { apikey: key },
          signal: ctrl.signal,
        }).finally(() => clearTimeout(t));
        const txt = await r.text();
        return `HTTP ${r.status}, ${txt.slice(0, 60)}`;
      }),
    );
    setRows([...out]);

    setRunning(false);
  }

  return (
    <>
      <TopBar title="Диагностика" />
      <div className="content">
        <div className="card">
          <p className="muted">Запусти БЕЗ VPN (лучше в инкогнито). Покажет, какие запросы проходят.</p>
          <button className="btn" onClick={run} disabled={running}>
            {running ? "Проверяю…" : "Запустить проверку"}
          </button>
        </div>
        {rows.map((r) => (
          <div className="card" key={r.name} style={{ fontSize: 13 }}>
            <b style={{ color: r.status === "OK" ? "green" : "var(--pink)" }}>
              {r.status} · {r.ms} мс
            </b>
            <div>{r.name}</div>
            <div className="muted" style={{ wordBreak: "break-all" }}>{r.info}</div>
          </div>
        ))}
      </div>
    </>
  );
}
