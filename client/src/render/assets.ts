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

export interface AssetManifests {
  tokens: AssetEntry[];
  maps: AssetEntry[];
}

/**
 * O `ConvertTo-Json` do PowerShell 5.1 serializa um array de 1 item como
 * objeto (sem colchetes). Normalizamos para sempre devolver array.
 */
function toArray(d: unknown): AssetEntry[] {
  if (Array.isArray(d)) return d as AssetEntry[];
  if (d && typeof d === "object" && "src" in (d as Record<string, unknown>)) {
    return [d as AssetEntry];
  }
  return [];
}

async function fetchManifest(url: string): Promise<AssetEntry[]> {
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    return toArray(await res.json());
  } catch {
    // Sem manifesto (arte ainda não gerada) → segue com a lista vazia.
    return [];
  }
}

let cache: AssetManifests | null = null;

export async function loadAssets(): Promise<AssetManifests> {
  if (cache) return cache;
  const [tokens, maps] = await Promise.all([
    fetchManifest("/tokens/manifest.json"),
    fetchManifest("/maps/manifest.json"),
  ]);
  cache = { tokens, maps };
  return cache;
}
