export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function rectangle(x1: number, y1: number, x2: number, y2: number): Rect {
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

export function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  );
}

/** A null placement reserves a separate panel outside the document viewport. */
export function placeTranslation(
  region: Rect,
  bounds: Rect,
  width = 320,
  height = 300,
): Rect | null {
  const gap = 16;
  const left = bounds.left + gap;
  const top = bounds.top + gap;
  const right = bounds.left + bounds.width - gap;
  const bottom = bounds.top + bounds.height - gap;
  if (width > right - left || height > bottom - top) return null;
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const candidates = [
    { left: region.left + region.width + gap, top: clamp(region.top, top, bottom - height) },
    { left: region.left - width - gap, top: clamp(region.top, top, bottom - height) },
    { left: clamp(region.left, left, right - width), top: region.top + region.height + gap },
    { left: clamp(region.left, left, right - width), top: region.top - height - gap },
  ];
  return (
    candidates
      .map((point) => ({ ...point, width, height }))
      .find(
        (candidate) =>
          candidate.left >= left &&
          candidate.top >= top &&
          candidate.left + width <= right &&
          candidate.top + height <= bottom &&
          !overlaps(candidate, region),
      ) ?? null
  );
}

/** Use rendered glyph bounds, so a rectangle never sends the rest of a text run. */
export function extractRegionText(layer: HTMLElement, region: Rect): string {
  const fragments: { text: string; top: number; height: number }[] = [];
  const range = layer.ownerDocument.createRange();
  const walker = layer.ownerDocument.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node as Text;
    const parent = text.parentElement;
    if (!parent || !text.data || !overlaps(parent.getBoundingClientRect(), region)) continue;
    let offset = 0;
    let selected = '';
    let first: DOMRect | undefined;
    for (const character of text.data) {
      range.setStart(text, offset);
      offset += character.length;
      range.setEnd(text, offset);
      const box = range.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      if (
        box.width > 0 &&
        box.height > 0 &&
        x >= region.left &&
        x <= region.left + region.width &&
        y >= region.top &&
        y <= region.top + region.height
      ) {
        selected += character;
        first ??= box;
      }
    }
    if (selected && first) fragments.push({ text: selected, top: first.top, height: first.height });
  }
  let result = '';
  let previous: (typeof fragments)[number] | undefined;
  for (const fragment of fragments) {
    if (previous && result && !/\s$/.test(result)) {
      result +=
        Math.abs(fragment.top - previous.top) > Math.min(fragment.height, previous.height) * 0.6
          ? '\n'
          : ' ';
    }
    result += fragment.text;
    previous = fragment;
  }
  return result.trim();
}
