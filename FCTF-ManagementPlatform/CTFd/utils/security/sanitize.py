import nh3

# Copied from lxml:
# https://github.com/lxml/lxml/blob/e986a9cb5d54827c59aefa8803bc90954d67221e/src/lxml/html/defs.py#L38
# fmt: off
SAFE_ATTRS = {
    'abbr', 'accept', 'accept-charset', 'accesskey', 'action', 'align',
    'alt', 'axis', 'border', 'cellpadding', 'cellspacing', 'char', 'charoff',
    'charset', 'checked', 'cite', 'class', 'clear', 'cols', 'colspan',
    'color', 'compact', 'coords', 'datetime', 'dir', 'disabled', 'enctype',
    'for', 'frame', 'headers', 'height', 'href', 'hreflang', 'hspace', 'id',
    'ismap', 'label', 'lang', 'longdesc', 'maxlength', 'media', 'method',
    'multiple', 'name', 'nohref', 'noshade', 'nowrap', 'prompt', 'readonly',
    'rev', 'rows', 'rowspan', 'rules', 'scope', 'selected', 'shape',
    'size', 'span', 'src', 'start', 'summary', 'tabindex', 'target', 'title',
    'type', 'usemap', 'valign', 'value', 'vspace', 'width',
    # Styling
    'class', 'style',
}
# fmt: on

ALLOWED_TAGS = {
    # Standard text / inline
    "a", "abbr", "acronym", "b", "blockquote", "br", "cite", "code",
    "del", "em", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img",
    "ins", "kbd", "li", "mark", "ol", "p", "pre", "q", "rp", "rt",
    "ruby", "s", "samp", "small", "span", "strong", "strike", "sub",
    "sup", "table", "tbody", "td", "th", "thead", "tr", "tt", "ul", "var",
    "div", "section", "article", "header", "footer", "nav", "aside",
    "main", "figure", "figcaption", "details", "summary", "time",
    # Page structure
    "title",
    # Meta
    "meta",
    # Form
    "form", "button", "input", "select", "option", "textarea", "label",
    # Media
    "audio", "video", "source", "iframe",
    # Annoyance (kept for compatibility)
    "blink", "marquee",
}

# Build per-tag attribute allowlist (nh3 does not support a global wildcard)
_BASE = SAFE_ATTRS
ALLOWED_ATTRIBUTES = {tag: _BASE for tag in ALLOWED_TAGS}

# Extra tag-specific attrs
ALLOWED_ATTRIBUTES["meta"]     = _BASE | {"name", "content", "property"}
ALLOWED_ATTRIBUTES["audio"]    = _BASE | {"autoplay", "controls", "crossorigin", "loop", "muted", "preload"}
ALLOWED_ATTRIBUTES["video"]    = _BASE | {"autoplay", "buffered", "controls", "crossorigin", "loop",
                                           "muted", "playsinline", "poster", "preload"}
ALLOWED_ATTRIBUTES["source"]   = _BASE | {"src", "type"}
ALLOWED_ATTRIBUTES["iframe"]   = _BASE | {"width", "height", "src", "frameborder", "allow", "allowfullscreen"}
ALLOWED_ATTRIBUTES["input"]    = _BASE | {"placeholder"}
ALLOWED_ATTRIBUTES["select"]   = _BASE | {"placeholder"}
ALLOWED_ATTRIBUTES["textarea"] = _BASE | {"placeholder"}
ALLOWED_ATTRIBUTES["form"]     = _BASE | {"method", "action"}
ALLOWED_ATTRIBUTES["button"]   = _BASE | {"name", "type", "value", "disabled"}
ALLOWED_ATTRIBUTES["label"]    = _BASE | {"for"}


def sanitize_html(html):
    return nh3.clean(
        html,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        link_rel="noopener noreferrer nofollow",
        url_schemes={"http", "https", "mailto", "ftp"},
    )
