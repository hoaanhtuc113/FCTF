import "whatwg-fetch";
import config from "./config";
import { nonceHeaders } from "./csp";

const fetch = window.fetch;

export default (url, options) => {
  if (options === undefined) {
    options = {
      method: "GET",
      credentials: "same-origin",
      headers: {},
    };
  }
  url = config.urlRoot + url;

  if (options.headers === undefined) {
    options.headers = {};
  }
  options.credentials = "same-origin";
  options.headers["Accept"] = "application/json";
  options.headers["Content-Type"] = "application/json";
  options.headers["CSRF-Token"] = config.csrfNonce;
  if (new URL(url, window.location.href).origin === window.location.origin) {
    Object.assign(options.headers, nonceHeaders(config.csrfNonce));
  }

  return fetch(url, options);
};
