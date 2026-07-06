// «Умное» разглаживание кожи без внешних ML-моделей: сглаживаем ТОЛЬКО пиксели
// телесного цвета (кожу), а глаза, брови, губы, волосы, фон остаются резкими.
// Так прыщики/неровности смягчаются, а детали лица не «замыливаются».

// Насколько пиксель похож на кожу (0..1). Комбинируем RGB- и YCbCr-эвристики —
// классический приём «до-ML» бьюти-фильтров.
function skinFactor(r: number, g: number, b: number): number {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const rule1 = r > 95 && g > 40 && b > 20 && (mx - mn) > 15 && Math.abs(r - g) > 15 && r > g && r > b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  const rule2 = cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173;
  if (rule1 && rule2) return 1;
  if (rule1 || rule2) return 0.5;
  return 0;
}

let tmpC: HTMLCanvasElement | null = null;
function tmp(w: number, h: number): HTMLCanvasElement {
  if (!tmpC) tmpC = document.createElement("canvas");
  if (tmpC.width !== w) tmpC.width = w;
  if (tmpC.height !== h) tmpC.height = h;
  return tmpC;
}

// Разглаживает кожу прямо в переданном canvas (на месте).
export function smoothSkin(canvas: HTMLCanvasElement, amount = 0.55): void {
  const W = canvas.width, H = canvas.height;
  if (!W || !H) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  // Небольшой радиус: сглаживаем микронеровности, не превращая лицо в «кашу».
  const blurPx = Math.max(1.5, Math.min(6, Math.round(Math.min(W, H) / 220)));
  const t = tmp(W, H);
  const tc = t.getContext("2d");
  if (!tc) return;
  tc.clearRect(0, 0, W, H);
  tc.filter = `blur(${blurPx}px)`;
  tc.drawImage(canvas, 0, 0);
  tc.filter = "none";

  let base: ImageData, blur: ImageData;
  try {
    base = ctx.getImageData(0, 0, W, H);
    blur = tc.getImageData(0, 0, W, H);
  } catch { return; } // tainted canvas — просто пропускаем
  const d = base.data, u = blur.data;
  for (let i = 0; i < d.length; i += 4) {
    const f = skinFactor(d[i], d[i + 1], d[i + 2]) * amount;
    if (f > 0) {
      d[i] += (u[i] - d[i]) * f;
      d[i + 1] += (u[i + 1] - d[i + 1]) * f;
      d[i + 2] += (u[i + 2] - d[i + 2]) * f;
    }
  }
  ctx.putImageData(base, 0, 0);
}
