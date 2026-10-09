import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../../FCTF-ManagementPlatform/CTFd/themes/admin/assets/js/compat/csp.js", import.meta.url), "utf8");
const { nonceHeaders, installJQueryNonce } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const doc = { querySelector: () => ({ nonce: "page-nonce" }) };
assert.deepEqual(nonceHeaders("csrf", doc), { "CSP-Nonce": "page-nonce", "CSRF-Token": "csrf" });
assert.deepEqual(nonceHeaders("", doc), {});
assert.deepEqual(nonceHeaders("csrf", { querySelector: () => null }), {});
let prefilter, converter, evaluated;
const jquery = {
  ajaxPrefilter: callback => { prefilter = callback; },
  globalEval: (text, options) => { evaluated = { text, options }; },
};
installJQueryNonce(jquery, "csrf", doc, { href: "https://admin.example/admin/challenges/new", origin: "https://admin.example" });
for (const [url, expected] of [["/api/v1/challenges/types", true], ["https://evil.example/api", false]]) {
  const headers = {};
  const options = { url, dataTypes: ["script"] };
  prefilter(options, {}, { setRequestHeader: (name, value) => { headers[name] = value; } });
  assert.equal("CSP-Nonce" in headers, expected);
  assert.equal("CSRF-Token" in headers, expected);
  assert.equal(Boolean(options.converters?.["text script"]), expected);
  if (expected) converter = options.converters["text script"];
}
assert.equal(converter("window.example = true;"), "window.example = true;");
assert.deepEqual(evaluated, { text: "window.example = true;", options: { nonce: "page-nonce" } });
console.log("PASS: AJAX templates retain the page nonce; cross-origin requests receive no nonce or CSRF secret.");
