import crypto from "crypto";

/**
 * Genera una contrasena aleatoria segura de 12 caracteres con al menos
 * uno de cada tipo: mayuscula, minuscula, digito y caracter especial.
 *
 * Usado por flows de creacion y reset de password.
 */
export function generatePassword(): string {
  const upper   = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower   = "abcdefghjkmnpqrstuvwxyz";
  const digits  = "23456789";
  const special = "!@#$";
  const all     = upper + lower + digits + special;

  // Garantizar al menos uno de cada tipo
  const required = [
    upper[crypto.randomInt(upper.length)],
    lower[crypto.randomInt(lower.length)],
    digits[crypto.randomInt(digits.length)],
    special[crypto.randomInt(special.length)],
  ];

  // Completar hasta 12 caracteres
  const rest  = Array.from({ length: 8 }, () => all[crypto.randomInt(all.length)]);
  const chars = [...required, ...rest];

  // Mezclar
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
