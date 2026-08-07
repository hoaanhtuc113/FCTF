#!/usr/bin/env bash
#
# Restricts the Redis NodePort (30320) to an administrative range, on the node
# it is run on. Run it on every node - a NodePort binds the port on all of them,
# and a rule on one node does nothing for the others.
#
# This is the layer that matters. The NetworkPolicy in
# redis-nodeport-admin-policy.yaml is enforced by the CNI after the packet has
# already arrived; this stops it arriving.
#
#   sudo ./redis-nodeport-firewall.sh 10.8.0.0/24
#   sudo ./redis-nodeport-firewall.sh 10.8.0.0/24 203.0.113.7/32
#
# Re-running replaces the previous rules for this port rather than stacking new
# ones, so it is safe to run again after the admin range changes.
set -euo pipefail

PORT=30320

if [[ $# -eq 0 ]]; then
  cat >&2 <<'USAGE'
Usage: redis-nodeport-firewall.sh <cidr> [cidr...]

Refusing to run with no argument. There is no sensible default here: allowing
everything is what the rule exists to prevent, and denying everything would cut
off the access the NodePort was kept for.
USAGE
  exit 2
fi

if ! command -v ufw >/dev/null 2>&1; then
  echo "ufw not installed - apply the equivalent rules in whatever filters this node" >&2
  echo "  allow tcp/${PORT} from: $*" >&2
  echo "  deny  tcp/${PORT} from everything else" >&2
  exit 1
fi

echo "==> Clearing existing ufw rules for ${PORT}"
# Delete by rule rather than by number: numbers shift as rules are removed.
while sudo ufw status numbered | grep -q "${PORT}"; do
  rule_num="$(sudo ufw status numbered | grep -m1 "${PORT}" | sed -E 's/^\[[[:space:]]*([0-9]+)\].*/\1/')"
  [[ -n "${rule_num}" ]] || break
  sudo ufw --force delete "${rule_num}"
done

for cidr in "$@"; do
  echo "==> Allowing ${cidr} to tcp/${PORT}"
  sudo ufw allow from "${cidr}" to any port "${PORT}" proto tcp
done

# Must come after the allows: ufw evaluates rules in order and stops at the
# first match, so a deny placed first would shadow them.
echo "==> Denying tcp/${PORT} from everything else"
sudo ufw deny "${PORT}/tcp"

sudo ufw reload || true

echo
echo "==> Rules now in place for ${PORT}:"
sudo ufw status numbered | grep "${PORT}" || echo "  (none - check that ufw is enabled: sudo ufw status)"

cat <<'NEXT'

Two things this does not cover:
  - Other nodes. Run this there too.
  - ufw being inactive. `sudo ufw status` reporting "inactive" means none of the
    above is being enforced.
NEXT
