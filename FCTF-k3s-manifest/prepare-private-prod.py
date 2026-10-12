"""Render deployment templates offline into an ignored, private directory.

Only a restricted password alphabet is accepted because the same values appear
in YAML, SQL, URLs, Redis ACLs and JSON. No Kubernetes commands are executed.
"""

import argparse
import json
import os
import re
import shutil
from pathlib import Path

MARKER = re.compile(r"__FCTF_SECRET_([A-Z0-9_]+)__")
ALPHABET = re.compile(r"[A-Za-z0-9_-]{16,128}\Z")
SCRIPT_DIR = Path(__file__).resolve().parent


def templates(include_legacy=False):
    source = SCRIPT_DIR / "prod"
    result = {}
    for path in sorted(source.rglob("*")):
        if path.is_symlink():
            raise ValueError("Symlinks are not allowed in production templates.")
        if not path.is_file():
            continue
        relative = path.relative_to(source)
        if relative.parts[0] == "ctfd" and not include_legacy:
            continue
        if path.suffix in (".yaml", ".yml", ".sql"):
            result[relative] = path.read_text(encoding="utf-8")
    return result


def render(values, source):
    required = {m for text in source.values() for m in MARKER.findall(text)}
    missing = sorted(name for name in required if not values.get(name))
    if missing:
        raise ValueError("Missing secret variables: " + ", ".join(missing))
    for name in sorted(required):
        value = values[name]
        if not isinstance(value, str) or not ALPHABET.fullmatch(value):
            raise ValueError(name + ": use 16-128 characters from A-Z, a-z, 0-9, _ and -.")
        if "__FCTF_SECRET_" in value:
            raise ValueError(name + ": unresolved placeholder supplied as a value.")
    if "HARBOR_ENCRYPTION_KEY" in required and len(values["HARBOR_ENCRYPTION_KEY"]) != 16:
        raise ValueError("HARBOR_ENCRYPTION_KEY must contain exactly 16 characters.")
    return {path: MARKER.sub(lambda m: values[m[1]], text) for path, text in source.items()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--values", type=Path, default=SCRIPT_DIR / "secrets.local.json")
    parser.add_argument("--output", type=Path, default=SCRIPT_DIR.parent / ".private-prod")
    parser.add_argument("--example", action="store_true", help="Print variable names with empty values only")
    parser.add_argument("--include-legacy-ctfd", action="store_true")
    args = parser.parse_args()
    source = templates(args.include_legacy_ctfd)
    names = sorted({name for text in source.values() for name in MARKER.findall(text)})
    if args.example:
        print(json.dumps(dict.fromkeys(names, ""), indent=2))
        return
    output = args.output.resolve()
    repo = SCRIPT_DIR.parent.resolve()
    # Limit output to ignored directories, and never overwrite an existing tree.
    if output.parent != repo or not (output.name == ".private-prod" or output.name.startswith(".private-prod-")):
        raise ValueError("Output must be an ignored .private-prod or .private-prod-* directory at the repo root.")
    if output.exists():
        raise ValueError("Output already exists; use a new .private-prod-* directory.")
    values_path = args.values.resolve()
    if values_path != SCRIPT_DIR / "secrets.local.json" and repo in values_path.parents:
        raise ValueError("Inside this repo, use only the ignored FCTF-k3s-manifest/secrets.local.json.")
    values = json.loads(values_path.read_text(encoding="utf-8"))
    if not isinstance(values, dict):
        raise ValueError("Secret values must be a JSON object.")
    rendered = render(values, source)
    old_umask = os.umask(0o077)
    try:
        output.mkdir(mode=0o700)
        for path in sorted((SCRIPT_DIR / "prod").rglob("*")):
            if not path.is_file():
                continue
            relative = path.relative_to(SCRIPT_DIR / "prod")
            if relative.parts[0] == "ctfd" and not args.include_legacy_ctfd:
                continue
            target = output / relative
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            if relative in rendered:
                target.write_text(rendered[relative], encoding="utf-8", newline="\n")
            else:
                shutil.copyfile(path, target)
            target.chmod(0o600)
        bootstrap = {
            "RABBIT_DEPLOY_PRODUCER_BOOTSTRAP_PASSWORD": values["DEPLOYMENT_CENTER_RABBIT_PASSWORD"],
            "RABBIT_DEPLOY_CONSUMER_BOOTSTRAP_PASSWORD": values["DEPLOYMENT_CONSUMER_RABBIT_PASSWORD"],
            "RABBIT_ADMIN_BOOTSTRAP_PASSWORD": values["RABBIT_ADMIN_PASSWORD"],
        }
        (output / "bootstrap.env").write_text("\n".join(f"export {key}='{value}'" for key, value in bootstrap.items()) + "\n", encoding="utf-8")
    finally:
        os.umask(old_umask)
    print("Private production configuration prepared. No cluster changes were made.")
    print("On Linux, files are restricted to their owner. On Windows, also restrict NTFS ACLs.")
    print(f"Set FCTF_PROD_DIR to {output} before running deployment scripts.")


if __name__ == "__main__":
    try:
        main()
    except json.JSONDecodeError:
        raise SystemExit("Invalid JSON in values file. Source content is not printed.")
    except ValueError as error:
        # Validation messages contain variable names only, never values.
        raise SystemExit(str(error))
    except OSError:
        raise SystemExit("Cannot read/write private configuration. Check input path, output path and permissions.")
