/**
 * Rewrites a JSON Schema object into the shape `fm respond --schema` accepts.
 *
 * Apple's decoder requires `title`, `x-order`, and `additionalProperties: false`
 * on every object, including nested ones. `$ref` nodes are left untouched.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function titleFromKey(key: string): string {
  if (key.length === 0) return "Value";
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function normalizeNode(node: Record<string, unknown>, title: string): Record<string, unknown> {
  if (typeof node.$ref === "string") {
    return node;
  }

  if (Array.isArray(node.anyOf)) {
    node.anyOf = node.anyOf.map((item, index) =>
      isRecord(item) ? normalizeNode(item, `${title}${index + 1}`) : item,
    );
  }

  const items = node.items;
  if (isRecord(items)) {
    node.items = normalizeNode(items, `${title}Item`);
  } else if (Array.isArray(items)) {
    node.items = items.map((item, index) =>
      isRecord(item) ? normalizeNode(item, `${title}Item${index + 1}`) : item,
    );
  }

  for (const defsKey of ["$defs", "definitions"] as const) {
    const defs = node[defsKey];
    if (!isRecord(defs)) continue;
    for (const [key, def] of Object.entries(defs)) {
      if (isRecord(def)) defs[key] = normalizeNode(def, key);
    }
  }

  const properties = node.properties;
  const isObject = node.type === "object" || isRecord(properties);
  if (!isObject) return node;

  node.type = "object";
  if (typeof node.title !== "string" || node.title.trim().length === 0) {
    node.title = title;
  }
  node.additionalProperties = false;

  if (!isRecord(properties)) {
    node.properties = {};
    node["x-order"] = [];
    return node;
  }

  const keys = Object.keys(properties);
  if (!Array.isArray(node["x-order"])) {
    node["x-order"] = keys;
  }
  for (const key of keys) {
    const child = properties[key];
    if (isRecord(child)) properties[key] = normalizeNode(child, titleFromKey(key));
  }
  return node;
}

export function normalizeFmSchema(input: unknown, title = "Response"): Record<string, unknown> {
  if (!isRecord(input)) {
    throw new Error("schema must be a JSON object");
  }
  return normalizeNode(structuredClone(input), title);
}
