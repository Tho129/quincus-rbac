/**
 * Normalises the IdP groups an app hands over into a clean, de-duplicated
 * list. Cognito's `idp_groups` claim arrives as a plain string — `"A"` for one
 * group, `"[A, B]"` for several — while other identity sources give arrays or
 * JSON. All of these are accepted; anything else yields no groups.
 */
export function parseGroups(input: unknown): string[] {
  if (input == null) return [];
  if (Array.isArray(input)) return clean(input.map((g) => (typeof g === "string" ? g : "")));
  if (typeof input !== "string") return [];

  const text = input.trim();
  if (!text) return [];
  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) return parseGroups(parsed);
    } catch {
      // Not JSON: Cognito's unquoted "[A, B]" form.
    }
    return clean(text.slice(1, -1).split(","));
  }
  return clean([text]);
}

function clean(parts: string[]): string[] {
  const out = new Set<string>();
  for (const part of parts) {
    const group = part.trim().replace(/^["']|["']$/g, "").trim();
    if (group) out.add(group);
  }
  return [...out];
}
