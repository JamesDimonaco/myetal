/** JSON for a <script type="application/ld+json"> tag. Escaping "<" stops
 *  user text like "</script>" from closing the tag; JSON.parse undoes it. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
