import hashlib

from passlib.hash import bcrypt_sha256

from CTFd.utils import string_types


def hash_password(plaintext):
    # use rounds=10 to match .NET configuration (faster)
    return bcrypt_sha256.using(rounds=10).hash(str(plaintext))


def verify_password(plaintext, ciphertext):
    return bcrypt_sha256.verify(plaintext, ciphertext)


def sha256(p):
    if isinstance(p, string_types):
        p = p.encode("utf-8")
    return hashlib.sha256(p).hexdigest()
