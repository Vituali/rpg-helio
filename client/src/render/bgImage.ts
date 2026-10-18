/** Cache de imagens de fundo — evita recriar `new Image()` a cada frame. */
const cache = new Map<string, HTMLImageElement>();

export function getBgImage(url: string): HTMLImageElement | null {
  let img = cache.get(url);
  if (!img) {
    img = new Image();
    img.src = url;
    cache.set(url, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}
