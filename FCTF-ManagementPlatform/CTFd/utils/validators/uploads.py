from pathlib import PurePath

from flask import current_app


# Challenge downloads include executable artifacts and source code. Browser-active
# documents must be packaged in an archive, rather than served as a loose upload.
DEFAULT_UPLOAD_EXTENSIONS = frozenset(
    "txt md csv json yaml yml xml log pdf png jpg jpeg gif webp ico bmp "
    "zip 7z tar gz bz2 xz rar pcap pcapng bin exe elf dll so wasm "
    "py c cpp h java class jar sql db sqlite pem pub key sh ps1 "
    "doc docx xls xlsx ppt pptx mp3 wav ogg mp4 webm woff woff2 ttf css".split()
)


def validate_upload_filename(filename):
    if not isinstance(filename, str) or not filename.strip():
        raise ValueError("A filename is required")
    if any(ord(c) < 32 or ord(c) == 127 for c in filename):
        raise ValueError("Filename cannot contain control characters")
    configured = current_app.config.get("UPLOAD_ALLOWED_EXTENSIONS")
    allowed = DEFAULT_UPLOAD_EXTENSIONS if configured is None else {
        str(ext).lower().lstrip(".") for ext in
        (configured.split(",") if isinstance(configured, str) else configured)
    }
    extension = PurePath(filename.strip()).suffix.lower().lstrip(".")
    if extension not in allowed:
        raise ValueError("File extension is not allowed; package challenge artifacts in a ZIP archive")
