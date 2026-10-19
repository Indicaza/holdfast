// Empty Lua tables arrive as {} (the SavedVariables parser cannot tell an empty
// array from an empty object), so an empty object is an empty list.

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// The value as a list, or null when it is not one.
export function list(value) {
  if (Array.isArray(value)) return value;
  return isObject(value) && Object.keys(value).length === 0 ? [] : null;
}

// The value as a list, or [] when it is not one.
export function array(value) {
  return list(value) || [];
}

// Whether the value is a list or absent.
export function listOrMissing(value) {
  return value === undefined || value === null || list(value) !== null;
}
