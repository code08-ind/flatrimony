/**
 * Splits a translated sentence with simple tags into parts, e.g.
 * "Agree to our <terms>Terms</terms> and <privacy>Privacy Policy</privacy>." →
 * [{text:'Agree to our '},{tag:'terms',text:'Terms'},{text:' and '},{tag:'privacy',text:'Privacy Policy'},{text:'.'}]
 * Unknown or unbalanced tags are left as plain text. No nesting.
 */
export type RichPart = { text: string; tag?: string };

export function parseRich(input: string, allowed: readonly string[]): RichPart[] {
  const parts: RichPart[] = [];
  let rest = input;
  while (rest.length > 0) {
    const open = /<([a-z]+)>/.exec(rest);
    if (!open || !allowed.includes(open[1]!)) {
      parts.push({ text: rest });
      break;
    }
    const tag = open[1]!;
    const close = `</${tag}>`;
    const end = rest.indexOf(close, open.index + open[0].length);
    if (end === -1) {
      parts.push({ text: rest });
      break;
    }
    if (open.index > 0) parts.push({ text: rest.slice(0, open.index) });
    parts.push({ tag, text: rest.slice(open.index + open[0].length, end) });
    rest = rest.slice(end + close.length);
  }
  return parts.filter((p) => p.text.length > 0);
}
