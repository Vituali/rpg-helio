/**
 * Cache de imagens (tokens, fundos de mapa).
 * Evita recriar `new Image()` a cada frame e permite desenhar assim que carrega.
 */
const cache = new Map<string, HTMLImageElement>();

export function getImage(url: string): HTMLImageElement | null {
  let img = cache.get(url);
  if (!img) {
    img = new Image();
    img.src = url;
    cache.set(url, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}
