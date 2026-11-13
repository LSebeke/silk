/**
 * The Appearance page's portrait (v1.1 §G.4): a Garn-managed `<figure data-garn-portrait>`
 * at the top of the page HTML showing the real sheet image. The Info Block's text is the
 * page without it. Pure string work on HTML Garn wrote, or Foundry's ProseMirror re-saved
 * (it keeps `data-*` attributes, may add `=""`, other attributes and whitespace).
 */

const FIGURE = /<figure\b[^>]*\bdata-garn-portrait\b[^>]*>[\s\S]*?<\/figure>\s*/gi;
const FIRST = new RegExp(FIGURE.source, 'i');
const AT_TOP = /^\s*<figure\b[^>]*\bdata-garn-portrait\b[^>]*>\s*<img\b[^>]*\bsrc="([^"]*)"/i;

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unescape = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** The page text without the portrait figure. */
export const withoutPortrait = (html: string): string => html.replace(FIGURE, '');

/** The page HTML: the portrait of `img` (none if empty), then the text. */
export function withPortrait(html: string, img: string): string {
  const text = withoutPortrait(html);
  return img ? `<figure data-garn-portrait=""><img src="${escape(img)}"></figure>${text}` : text;
}

/** The page HTML to write so it shows `img` on top, or undefined if it already does. */
export function portraitUpdate(html: string, img: string): string | undefined {
  const text = withoutPortrait(html);
  const top = AT_TOP.exec(html);
  // Exactly one figure, on top, showing `img`; or none without an image.
  const ok = img
    ? !!top && unescape(top[1] ?? '') === img && html.replace(FIRST, '') === text
    : text === html;
  return ok ? undefined : withPortrait(html, img);
}
