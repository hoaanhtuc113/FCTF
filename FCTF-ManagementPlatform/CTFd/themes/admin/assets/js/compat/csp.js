export function nonceHeaders(csrfNonce, doc = document) {
  const nonce = doc.querySelector("script[nonce]")?.nonce;
  if (!nonce || !csrfNonce) return {};
  return { "CSP-Nonce": nonce, "CSRF-Token": csrfNonce };
}

export function installJQueryNonce($, csrfNonce, doc = document, location = window.location) {
  $.ajaxPrefilter((options, _originalOptions, xhr) => {
    if (new URL(options.url, location.href).origin !== location.origin) return;
    const headers = nonceHeaders(csrfNonce, doc);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    if (options.dataTypes?.includes("script")) {
      options.converters = {
        ...options.converters,
        "text script": text => {
          $.globalEval(text, { nonce: nonceHeaders(csrfNonce, doc)["CSP-Nonce"] });
          return text;
        },
      };
    }
  });
}
