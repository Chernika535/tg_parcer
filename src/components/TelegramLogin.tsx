import { useEffect, useRef } from "react";
import { appConfig } from "../lib/supabase.ts";
import type { TelegramUser } from "../lib/auth.tsx";

// Виджет входа Telegram. Требует, чтобы домен сайта был привязан к боту
// в @BotFather (/setdomain). Колбэк отдаёт данные пользователя с подписью.
export default function TelegramLogin({ onAuth }: { onAuth: (u: TelegramUser) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cb = `onTelegramAuth_${Math.random().toString(36).slice(2)}`;
    (window as unknown as Record<string, unknown>)[cb] = (user: TelegramUser) => onAuth(user);

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", appConfig().botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "6");
    script.setAttribute("data-onauth", `${cb}(user)`);
    script.setAttribute("data-request-access", "write");

    const node = ref.current;
    node?.appendChild(script);
    return () => {
      node?.replaceChildren();
      delete (window as unknown as Record<string, unknown>)[cb];
    };
  }, [onAuth]);

  return <div ref={ref} />;
}
