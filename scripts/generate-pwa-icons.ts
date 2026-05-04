/**
 * Generador de iconos PWA a partir del logo TKL.
 *
 * Lee public/branding/logo-source.jpeg, recorta solo el circulo naranja
 * (eliminando el texto "Farmacias" del cuarto inferior) y genera 3 PNGs
 * cuadrados en public/:
 *   - icon-192.png         (192x192)
 *   - icon-512.png         (512x512)
 *   - apple-touch-icon.png (180x180)
 *
 * Estrategia de recorte:
 *  1. Tomar el 75% superior de la imagen (zona del circulo).
 *  2. Re-recortar a un cuadrado centrado horizontalmente en esa zona.
 *  3. Resize al tamaño final con fondo blanco asegurado.
 *
 * Uso:
 *   npm run generate:icons
 *   (o: npx tsx scripts/generate-pwa-icons.ts)
 *
 * Idempotente: corre N veces sin efectos secundarios mas alla de re-escribir
 * los PNG de salida.
 */
import sharp from "sharp";
import path from "path";

const SOURCE     = path.resolve(process.cwd(), "public/branding/logo-source.jpeg");
const OUTPUT_DIR = path.resolve(process.cwd(), "public");

const SIZES: Array<{ name: string; size: number }> = [
  { name: "icon-192.png",         size: 192 },
  { name: "icon-512.png",         size: 512 },
  { name: "apple-touch-icon.png", size: 180 },
];

async function main() {
  console.log(`[icons] source=${SOURCE}`);
  const meta = await sharp(SOURCE).metadata();
  if (!meta.width || !meta.height) {
    throw new Error("No se pudo leer dimensiones de la imagen fuente");
  }
  console.log(`[icons] source dimensions: ${meta.width}x${meta.height}`);

  // Recortar 75% superior de la imagen (zona del circulo, sin "Farmacias")
  const cropHeight = Math.round(meta.height * 0.75);
  // Convertir el rectangulo W × cropHeight en cuadrado centrado horizontalmente.
  // Usamos cropHeight como lado: si W > cropHeight, recortamos a los costados;
  // si W <= cropHeight, usamos W (caso raro para imagenes anchas, no esperado).
  const cropSide = Math.min(meta.width, cropHeight);
  const cropLeft = Math.round((meta.width  - cropSide) / 2);
  const cropTop  = Math.round((cropHeight  - cropSide) / 2);
  console.log(`[icons] crop region: left=${cropLeft} top=${cropTop} side=${cropSide}`);

  for (const { name, size } of SIZES) {
    const outputPath = path.join(OUTPUT_DIR, name);
    await sharp(SOURCE)
      .extract({ left: cropLeft, top: cropTop, width: cropSide, height: cropSide })
      .resize(size, size, { fit: "cover", background: { r: 255, g: 255, b: 255 } })
      .flatten({ background: "#ffffff" })  // asegurar fondo blanco si hay alpha
      .png({ compressionLevel: 9 })
      .toFile(outputPath);
    console.log(`[icons] generated ${name} (${size}x${size}) → ${outputPath}`);
  }

  console.log("[done] OK");
}

main().catch((e) => { console.error(e); process.exit(1); });
