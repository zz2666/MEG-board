export function windowlessSetTimeout(callback: () => void, ms: number) {
  return setTimeout(callback, ms);
}
