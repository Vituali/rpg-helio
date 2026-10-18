/**
 * Manifestos de arte gerados por `tools/optimize-assets.ps1`.
 *
 * Os originais ficam em `img/` (fora do git). O script gera miniaturas em
 * `client/public/tokens/` e `client/public/maps/`, mais um `manifest.json`
 * em cada pasta. Aqui só carregamos esses manifestos em memória.
 */

export interface AssetEntry {
  id: string;
  name: string;
  src: string;
}

/** Mapa: além dos campos comuns, guarda o formato real da imagem. */
export interface MapEntry extends AssetEntry {
  /** Largura da imagem otimizada, em pixels. */
  w?: number;
  /** Altura da imagem otimizada, em pixels. */
  h?: number;
}

export interface AssetManifests {
  tokens: AssetEntry[];
  maps: MapEntry[];
}

/**
 * O `ConvertTo-Json` do PowerShell 5.1 serializa um array de 1 item como
 * objeto (sem colchetes). Normalizamos para sempre devolver array.
 */
function toArray<T>(d: unknown): T[] {
  if (Array.isArray(d)) return d as T[];
  if (d && typeof d === "object" && "src" in (d as Record<string, unknown>)) {
    return [d as T];
  }
  return [];
}

async function fetchManifest<T>(url: string): Promise<T[]> {
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    return toArray<T>(await res.json());
  } catch {
    // Sem manifesto (arte ainda não gerada) → segue com a lista vazia.
    return [];
  }
}

let cache: AssetManifests | null = null;

export async function loadAssets(): Promise<AssetManifests> {
  if (cache) return cache;
  const [tokens, maps] = await Promise.all([
    fetchManifest<AssetEntry>("/tokens/manifest.json"),
    fetchManifest<MapEntry>("/maps/manifest.json"),
  ]);
  cache = { tokens, maps };
  return cache;
}
