/**
 * Generador de iconos PWA a partir del logo TKL.
 *
 * Lee public/branding/logo-source.jpeg, ubica el circulo naranja (midiendo
 * sus pixeles, sin coordenadas a ojo) y genera en public/:
 *
 *   purpose "any" — el circulo centrado ocupando casi todo el lienzo:
 *     - icon-192.png           (192x192)
 *     - icon-512.png           (512x512)
 *     - apple-touch-icon.png   (180x180)
 *
 *   purpose "maskable" — Android recorta estos iconos con la forma que elija
 *   el launcher (circulo, squircle, gota...). Solo se garantiza visible el
 *   circulo central de diametro 80% del lienzo, asi que el logo va centrado y
 *   achicado para entrar completo en esa zona segura, sobre fondo blanco:
 *     - icon-maskable-192.png  (192x192)
 *     - icon-maskable-512.png  (512x512)
 *
 * Por que hacia falta: el recorte anterior tomaba "el 75% superior" de la
 * imagen y dejaba el circulo corrido hacia abajo y cortado; ademas el manifest
 * no declaraba purpose, y el launcher usaba esa imagen sin zona segura.
 *
 * Uso:
 *   npm run generate:icons            genera los PNG
 *   npm run generate:icons -- --check ademas verifica zona segura y centrado
 *                                     y escribe una vista previa con mascaras
 *                                     (circulo, squircle, cuadrado redondeado)
 *                                     en la carpeta que indique --preview=DIR
 *
 * Idempotente: corre N veces sin mas efecto que re-escribir los PNG.
 */
import sharp from "sharp";
import path from "path";
import fs from "fs";

const SOURCE     = path.resolve(process.cwd(), "public/branding/logo-source.jpeg");
const OUTPUT_DIR = path.resolve(process.cwd(), "public");

/** Diametro de la zona segura de un icono maskable, como fraccion del lienzo (spec W3C). */
export const MASKABLE_SAFE_ZONE = 0.8;
/** Diametro del logo en los maskable: dentro de la zona segura, con aire. */
const MASKABLE_LOGO_RATIO = 0.72;
/** Diametro del logo en los "any" y en apple-touch-icon. */
const ANY_LOGO_RATIO = 0.9;

type IconSpec = { name: string; size: number; logoRatio: number; maskable: boolean };

const ICONS: IconSpec[] = [
  { name: "icon-192.png",          size: 192, logoRatio: ANY_LOGO_RATIO,      maskable: false },
  { name: "icon-512.png",          size: 512, logoRatio: ANY_LOGO_RATIO,      maskable: false },
  { name: "apple-touch-icon.png",  size: 180, logoRatio: ANY_LOGO_RATIO,      maskable: false },
  { name: "icon-maskable-192.png", size: 192, logoRatio: MASKABLE_LOGO_RATIO, maskable: true },
  { name: "icon-maskable-512.png", size: 512, logoRatio: MASKABLE_LOGO_RATIO, maskable: true },
];

/** Naranja del logo (tolerante al ruido del JPEG). No matchea el azul de "Farmacias". */
function isOrange(r: number, g: number, b: number): boolean {
  return r > 200 && g > 100 && g < 200 && b < 110;
}

type Box = { left: number; top: number; right: number; bottom: number };

/** Caja que encierra los pixeles naranjas de una imagen. */
async function orangeBox(img: sharp.Sharp): Promise<Box> {
  const { data, info } = await img.clone().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const box: Box = { left: info.width, top: info.height, right: -1, bottom: -1 };
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      if (!isOrange(data[i], data[i + 1], data[i + 2])) continue;
      if (x < box.left) box.left = x;
      if (x > box.right) box.right = x;
      if (y < box.top) box.top = y;
      if (y > box.bottom) box.bottom = y;
    }
  }
  if (box.right < 0) throw new Error("No se encontro el circulo naranja en la imagen");
  return box;
}

/** El circulo del logo, recortado justo a su caja (cuadrada). */
async function extractLogo(): Promise<Buffer> {
  const src = sharp(SOURCE);
  const box = await orangeBox(src);
  const w = box.right - box.left + 1;
  const h = box.bottom - box.top + 1;
  if (Math.abs(w - h) > Math.max(w, h) * 0.03) {
    throw new Error(`La caja naranja no es un circulo (${w}x${h}): revisar la imagen fuente`);
  }
  // Lado = el mayor de los dos, centrado en el centro de la caja.
  const side = Math.max(w, h);
  const cx = (box.left + box.right) / 2;
  const cy = (box.top + box.bottom) / 2;
  const left = Math.round(cx - side / 2);
  const top  = Math.round(cy - side / 2);
  console.log(`[icons] circulo: centro=(${cx}, ${cy}) diametro=${side}`);
  return src.clone().extract({ left, top, width: side, height: side }).png().toBuffer();
}

async function renderIcon(logo: Buffer, spec: IconSpec): Promise<Buffer> {
  const logoSize = Math.round(spec.size * spec.logoRatio);
  const offset = Math.round((spec.size - logoSize) / 2);
  const resized = await sharp(logo).resize(logoSize, logoSize, { fit: "fill" }).png().toBuffer();
  return sharp({
    create: { width: spec.size, height: spec.size, channels: 3, background: "#ffffff" },
  })
    .composite([{ input: resized, left: offset, top: offset }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/* ── Verificacion ─────────────────────────────────────────────────────────── */

/**
 * Comprueba sobre el PNG ya generado que el circulo este centrado y, en los
 * maskable, que ningun pixel naranja quede fuera de la zona segura.
 */
async function checkIcon(spec: IconSpec, png: Buffer): Promise<string[]> {
  const errors: string[] = [];
  const box = await orangeBox(sharp(png));
  const c = (spec.size - 1) / 2;
  const dx = (box.left + box.right) / 2 - c;
  const dy = (box.top + box.bottom) / 2 - c;
  const tol = Math.max(1, spec.size * 0.01);
  if (Math.abs(dx) > tol || Math.abs(dy) > tol) {
    errors.push(`descentrado (dx=${dx.toFixed(1)}, dy=${dy.toFixed(1)})`);
  }
  if (box.left <= 0 || box.top <= 0 || box.right >= spec.size - 1 || box.bottom >= spec.size - 1) {
    errors.push("el circulo toca el borde (cortado)");
  }
  if (spec.maskable) {
    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const safeR = (spec.size * MASKABLE_SAFE_ZONE) / 2;
    let outside = 0;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * info.channels;
        if (!isOrange(data[i], data[i + 1], data[i + 2])) continue;
        if (Math.hypot(x - c, y - c) > safeR) outside++;
      }
    }
    if (outside > 0) errors.push(`${outside} px del logo fuera de la zona segura (80%)`);
    // Las esquinas (lo que la mascara recorta) tienen que ser fondo blanco.
    const corner = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return data[i] > 245 && data[i + 1] > 245 && data[i + 2] > 245;
    };
    const m = spec.size - 1;
    if (!corner(0, 0) || !corner(m, 0) || !corner(0, m) || !corner(m, m)) {
      errors.push("el fondo no es blanco");
    }
  }
  return errors;
}

/** Mascaras de launcher como SVG (blanco = visible). */
function maskSvg(shape: "circle" | "squircle" | "rounded", size: number): Buffer {
  const h = size / 2;
  let body: string;
  if (shape === "circle") {
    body = `<circle cx="${h}" cy="${h}" r="${h}" fill="#fff"/>`;
  } else if (shape === "rounded") {
    body = `<rect width="${size}" height="${size}" rx="${size * 0.22}" fill="#fff"/>`;
  } else {
    // Superelipse |x|^n + |y|^n = 1 con n=4 (squircle de launcher).
    const pts: string[] = [];
    for (let i = 0; i < 360; i++) {
      const t = (i * Math.PI) / 180;
      const cos = Math.cos(t), sin = Math.sin(t);
      const x = h + h * Math.sign(cos) * Math.pow(Math.abs(cos), 0.5);
      const y = h + h * Math.sign(sin) * Math.pow(Math.abs(sin), 0.5);
      pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
    }
    body = `<polygon points="${pts.join(" ")}" fill="#fff"/>`;
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${body}</svg>`);
}

/** Simula como se ve un icono recortado por cada mascara y arma una tira. */
async function writeMaskPreview(dir: string, name: string, png: Buffer, size: number): Promise<{ file: string; lost: Record<string, number> }> {
  const shapes = ["circle", "squircle", "rounded"] as const;
  const gap = 24;
  const tiles: sharp.OverlayOptions[] = [];
  const lost: Record<string, number> = {};
  const orangeCount = async (buf: Buffer) => {
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let n = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i + 3] > 128 && isOrange(data[i], data[i + 1], data[i + 2])) n++;
    }
    return n;
  };
  const total = await orangeCount(png);
  for (let k = 0; k < shapes.length; k++) {
    const masked = await sharp(png)
      .ensureAlpha()
      .composite([{ input: maskSvg(shapes[k], size), blend: "dest-in" }])
      .png()
      .toBuffer();
    lost[shapes[k]] = total - (await orangeCount(masked));
    tiles.push({ input: masked, left: gap + k * (size + gap), top: gap });
  }
  const file = path.join(dir, name.replace(".png", "-mascaras.png"));
  await sharp({
    create: { width: gap + shapes.length * (size + gap), height: size + gap * 2, channels: 3, background: "#3a3f4b" },
  }).composite(tiles).png().toFile(file);
  return { file, lost };
}

async function main() {
  const check = process.argv.includes("--check");
  const previewArg = process.argv.find((a) => a.startsWith("--preview="));
  const previewDir = previewArg ? path.resolve(previewArg.slice("--preview=".length)) : null;
  if (previewDir) fs.mkdirSync(previewDir, { recursive: true });

  console.log(`[icons] source=${SOURCE}`);
  const logo = await extractLogo();
  let failed = 0;

  for (const spec of ICONS) {
    const png = await renderIcon(logo, spec);
    fs.writeFileSync(path.join(OUTPUT_DIR, spec.name), png);
    console.log(`[icons] ${spec.name} (${spec.size}x${spec.size}, ${spec.maskable ? "maskable" : "any"})`);

    if (!check) continue;
    const errors = await checkIcon(spec, png);
    if (previewDir) {
      const { file, lost } = await writeMaskPreview(previewDir, spec.name, png, spec.size);
      console.log(`         mascaras → ${file}  px de logo recortados: ${JSON.stringify(lost)}`);
      if (spec.maskable && Object.values(lost).some((n) => n > 0)) {
        errors.push("alguna mascara recorta el logo");
      }
    }
    if (errors.length) { failed++; console.error(`  FAIL  ${spec.name}: ${errors.join("; ")}`); }
    else console.log(`  PASS  ${spec.name}`);
  }

  if (failed) { console.error(`[icons] ${failed} icono(s) con problemas`); process.exit(1); }
  console.log("[done] OK");
}

main().catch((e) => { console.error(e); process.exit(1); });
