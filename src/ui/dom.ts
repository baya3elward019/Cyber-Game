type Attrs = Record<string, string | number | boolean | ((e: any) => void) | undefined>;
type Child = Node | string | null | undefined | false;

/** Tiny DOM builder. Strings are inserted as text (never as HTML). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** Renders text where `code spans` become <code>. Safe: no HTML injection. */
export function richText(text: string): HTMLElement {
  const span = document.createElement('span');
  text.split(/(`[^`]+`)/).forEach((part) => {
    if (part.startsWith('`') && part.endsWith('`')) span.append(h('code', {}, part.slice(1, -1)));
    else span.append(part);
  });
  return span;
}

export const fmtTime = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const SHIELD_SVG = `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 5 55 13.5 52.5 41 32 59 11.5 41 9 13.5Z" fill="#0f1d2a" stroke="#4fa3d9" stroke-width="3.5"/><circle cx="32" cy="27" r="6" fill="none" stroke="#4fa3d9" stroke-width="3.5"/><path d="M32 33v12" stroke="#4fa3d9" stroke-width="3.5"/></svg>`;
