try:
    from pybluemonday import UGCPolicy
except ImportError:
    # Fallback for environments without Go toolchain (dev on Windows)
    import bleach

    class UGCPolicy:
        def __init__(self):
            self._tags = set()
            self._attrs = {}

        def AllowElements(self, *tags): self._tags.update(tags)
        def AllowAttrs(self, *attrs):
            self._pending_attrs = attrs
            return self
        def OnElements(self, *tags):
            for t in tags:
                self._attrs.setdefault(t, set()).update(self._pending_attrs)
        def Globally(self):
            self._attrs['*'] = self._attrs.get('*', set()) | set(self._pending_attrs)
        def AllowStyling(self): pass
        def AllowStandardAttributes(self): pass
        def AllowStandardURLs(self): pass
        def AllowDataAttributes(self): pass
        def AllowDataURIImages(self): pass
        def AllowRelativeURLs(self, v): pass
        def AllowComments(self): pass
        def RequireNoFollowOnFullyQualifiedLinks(self, v): pass
        def RequireNoFollowOnLinks(self, v): pass
        def RequireNoReferrerOnFullyQualifiedLinks(self, v): pass
        def RequireNoReferrerOnLinks(self, v): pass

        def sanitize(self, html):
            global_attrs = list(self._attrs.get('*', []))
            attrs = {t: list(a) + global_attrs for t, a in self._attrs.items() if t != '*'}
            return bleach.clean(html or '', tags=list(self._tags), attributes=attrs, strip=True)

# Copied from lxml:
# https://github.com/lxml/lxml/blob/e986a9cb5d54827c59aefa8803bc90954d67221e/src/lxml/html/defs.py#L38
# fmt: off
SAFE_ATTRS = (
    'abbr', 'accept', 'accept-charset', 'accesskey', 'action', 'align',
    'alt', 'axis', 'border', 'cellpadding', 'cellspacing', 'char', 'charoff',
    'charset', 'checked', 'cite', 'class', 'clear', 'cols', 'colspan',
    'color', 'compact', 'coords', 'datetime', 'dir', 'disabled', 'enctype',
    'for', 'frame', 'headers', 'height', 'href', 'hreflang', 'hspace', 'id',
    'ismap', 'label', 'lang', 'longdesc', 'maxlength', 'media', 'method',
    'multiple', 'name', 'nohref', 'noshade', 'nowrap', 'prompt', 'readonly',
    'rel', 'rev', 'rows', 'rowspan', 'rules', 'scope', 'selected', 'shape',
    'size', 'span', 'src', 'start', 'summary', 'tabindex', 'target', 'title',
    'type', 'usemap', 'valign', 'value', 'vspace', 'width'
)
# fmt: on

PAGE_STRUCTURE_TAGS = {
    "title": [],
}

META_TAGS = {
    "meta": ["name", "content", "property"],
}

FORM_TAGS = {
    "form": ["method", "action"],
    "button": ["name", "type", "value", "disabled"],
    "input": ["name", "type", "value", "placeholder"],
    "select": ["name", "value", "placeholder"],
    "option": ["value"],
    "textarea": ["name", "value", "placeholder"],
    "label": ["for"],
}

ANNOYING_TAGS = {
    "blink": [],
    "marquee": [],
}


MEDIA_TAGS = {
    "audio": ["autoplay", "controls", "crossorigin", "loop", "muted", "preload", "src"],
    "video": [
        "autoplay",
        "buffered",
        "controls",
        "crossorigin",
        "loop",
        "muted",
        "playsinline",
        "poster",
        "preload",
        "src",
    ],
    "source": ["src", "type"],
    "iframe": ["width", "height", "src", "frameborder", "allow", "allowfullscreen"],
}

SANITIZER = UGCPolicy()

for TAGS in (PAGE_STRUCTURE_TAGS, META_TAGS, FORM_TAGS, ANNOYING_TAGS, MEDIA_TAGS):
    for element in TAGS:
        SANITIZER.AllowElements(element)
        SANITIZER.AllowAttrs(*TAGS[element]).OnElements(element)

# Allow safe attrs copied from lxml
SANITIZER.AllowAttrs(*SAFE_ATTRS).Globally()

# Allow styling globally
SANITIZER.AllowAttrs("class", "style").Globally()

# Allow styling via bluemonday
SANITIZER.AllowStyling()

# Allow safe convenience functions from bluemonday
SANITIZER.AllowStandardAttributes()
SANITIZER.AllowStandardURLs()

# Allow data atributes
SANITIZER.AllowDataAttributes()

# Allow data URI images
SANITIZER.AllowDataURIImages()

# Link security
SANITIZER.AllowRelativeURLs(True)
SANITIZER.RequireNoFollowOnFullyQualifiedLinks(True)
SANITIZER.RequireNoFollowOnLinks(True)
SANITIZER.RequireNoReferrerOnFullyQualifiedLinks(True)
SANITIZER.RequireNoReferrerOnLinks(True)

# Allow Comments
SANITIZER.AllowComments()


def sanitize_html(html):
    return SANITIZER.sanitize(html)
