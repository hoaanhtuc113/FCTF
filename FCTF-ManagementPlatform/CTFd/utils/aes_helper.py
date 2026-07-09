"""
AES-256-CBC encryption helpers for KYPO team account passwords.
Key is read from env var KYPO_AES_KEY (padded/truncated to 32 bytes).
Stored format: base64(IV[16] || ciphertext).
"""
import base64
import os

from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes


def _get_key() -> bytes:
    raw = os.environ.get("KYPO_AES_KEY", "").encode("utf-8")
    key = bytearray(32)
    key[: min(len(raw), 32)] = raw[: min(len(raw), 32)]
    return bytes(key)


def encrypt_kypo_password(plaintext: str) -> str:
    key = _get_key()
    iv = os.urandom(16)
    data = plaintext.encode("utf-8")
    pad_len = 16 - (len(data) % 16)
    data += bytes([pad_len] * pad_len)
    enc = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend()).encryptor()
    ct = enc.update(data) + enc.finalize()
    return base64.b64encode(iv + ct).decode("utf-8")


def decrypt_kypo_password(ciphertext: str) -> str:
    try:
        key = _get_key()
        raw = base64.b64decode(ciphertext)
        iv, ct = raw[:16], raw[16:]
        dec = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend()).decryptor()
        data = dec.update(ct) + dec.finalize()
        pad_len = data[-1]
        return data[:-pad_len].decode("utf-8")
    except Exception:
        return ciphertext
