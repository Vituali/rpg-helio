/**
 * Schemas de validação compartilhados (Zod).
 *
 * Uma única fonte de verdade para os formulários do HELIO:
 *  - `Entrar.tsx`   — login / criação de conta
 *  - `Mesa.tsx`     — criar missão
 *  - `Admin.tsx`    — trocar senha, delegar admin, configuração viva
 *
 * Usar o mesmo schema no client e (no futuro) no servidor impede
 * drift de regras entre as pontas.
 */
import { z } from "zod";

/** Nome de conta: 2–24 caracteres, sem caracteres de controle. */
export const accountNameSchema = z
  .string()
  .trim()
  .min(2, "O nome precisa de pelo menos 2 caracteres.")
  .max(24, "O nome pode ter no máximo 24 caracteres.")
  .refine(
    (n) => !/[\u0000-\u001f\u007f]/.test(n),
    "O nome não pode ter caracteres de controle.",
  );

/** Senha: 6–200 caracteres. */
export const passwordSchema = z
  .string()
  .min(6, "A senha precisa de pelo menos 6 caracteres.")
  .max(200, "A senha pode ter no máximo 200 caracteres.");

/** Login: nome + senha. */
export const loginSchema = z.object({
  name: accountNameSchema,
  password: passwordSchema,
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Criação de conta: nome + senha + confirmação. */
export const createAccountSchema = z
  .object({
    name: accountNameSchema,
    password: passwordSchema,
    password2: passwordSchema,
  })
  .refine((d) => d.password === d.password2, {
    message: "As duas senhas não são iguais.",
    path: ["password2"],
  });
export type CreateAccountInput = z.infer<typeof createAccountSchema>;

/** Criar missão: nome opcional (padrão "Missão sem nome"). */
export const createCampaignSchema = z.object({
  name: z.string().trim().max(40, "O nome pode ter no máximo 40 caracteres.").optional(),
});
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

/** Selo da missão: alfanumérico com hifens, 3–32 caracteres. */
export const seloSchema = z
  .string()
  .trim()
  .min(3, "O selo precisa de pelo menos 3 caracteres.")
  .max(32, "O selo pode ter no máximo 32 caracteres.")
  .refine(
    (s) => /^[A-Z0-9-]+$/.test(s.toUpperCase()),
    "Use apenas letras, números e hifens (ex.: CORVO-AMBAR-VEU-74).",
  );
export type SeloInput = z.infer<typeof seloSchema>;

/** Trocar senha (admin): senha + confirmação. */
export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    password2: passwordSchema,
  })
  .refine((d) => d.password === d.password2, {
    message: "As duas senhas não são iguais.",
    path: ["password2"],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** Configuração viva do servidor: sala da casa (selo opcional). */
export const adminSettingsSchema = z.object({
  defaultRoom: z
    .string()
    .trim()
    .max(32, "A sala da casa pode ter no máximo 32 caracteres.")
    .optional()
    .transform((s) => (s ? s.toUpperCase() : s)),
  registration: z.boolean().optional(),
});
export type AdminSettingsInput = z.infer<typeof adminSettingsSchema>;
