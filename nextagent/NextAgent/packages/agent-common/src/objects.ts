export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  for (const item of Object.values(value)) {
    deepFreeze(item);
  }
  return Object.isFrozen(value) ? value : Object.freeze(value);
}
