// Keep the same key for double clicks/retries of an unchanged form.
export function awardRequestKey(form, params) {
  const body = JSON.stringify(params);
  let previous = form.data("award-request");
  if (!previous || previous.body !== body) {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    const key = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    previous = { body, key };
    form.data("award-request", previous);
  }
  return previous.key;
}
