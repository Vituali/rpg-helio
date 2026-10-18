/** Id curto e único o suficiente para uso local (na Fase 2, o servidor gera). */
export function uid(prefix = "id"): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
