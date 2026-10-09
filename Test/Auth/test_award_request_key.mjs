import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";

globalThis.window = { crypto: webcrypto };
const source = await readFile(new URL(
  "../../FCTF-ManagementPlatform/CTFd/themes/admin/assets/js/compat/award.js", import.meta.url), "utf8");
const { awardRequestKey } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
function form() {
  const values = new Map();
  return { data(key, value) {
    if (value !== undefined) values.set(key, value);
    return values.get(key);
  } };
}
const current = form();
const params = { user_id: 2, name: "bonus", value: 100 };
const key = awardRequestKey(current, params);
assert.match(key, /^[a-f0-9]{32}$/);
assert.equal(awardRequestKey(current, { ...params }), key, "Double click/retry changed key");
assert.notEqual(awardRequestKey(current, { ...params, value: 200 }), key, "New payload reused key");
assert.notEqual(awardRequestKey(form(), params), key, "New page/event reused key");
console.log("PASS: award retries reuse their key and separate events receive new keys");
