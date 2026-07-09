// Проверка совершеннолетия для лент с пометкой 18+.
// Доступ есть, если: в профиле указана дата рождения и человеку есть 18 лет,
// ЛИБО он подтвердил возраст в баннере (флаг хранится локально в браузере).

export function ageFromBirth(birth?: string | null): number | null {
  if (!birth) return null;
  const d = new Date(birth);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

const KEY = "tf_adult_ok";
export function adultConfirmed(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}
export function confirmAdult(): void {
  try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ }
}

// Разрешён ли доступ к контенту 18+ (по дате рождения или подтверждению).
export function isAdultAllowed(birth?: string | null): boolean {
  const age = ageFromBirth(birth);
  if (age != null && age >= 18) return true;
  return adultConfirmed();
}
