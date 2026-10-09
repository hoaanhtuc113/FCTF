from flask import request


def paginate_list(query, default=50, maximum=100):
    values = {}
    for key, fallback in (("page", 1), ("per_page", default)):
        raw = request.args.get(key, str(fallback))
        if not raw.isdecimal() or not 0 < int(raw) <= 2147483647:
            raise ValueError("%s must be a positive integer" % key)
        values[key] = int(raw)
    page, size = values["page"], min(values["per_page"], maximum)
    total = query.order_by(None).count()
    pages = (total + size - 1) // size
    items = query.offset((page - 1) * size).limit(size).all()
    return items, {"pagination": {
        "page": page, "per_page": size, "total": total, "pages": pages,
        "next": page + 1 if page < pages else None,
        "prev": page - 1 if page > 1 else None,
    }}
