# Observability-only secrets

Create these Secrets in namespace `app` before applying the corresponding
Deployments.  They are intentionally not represented by a tracked `*.yaml`
manifest: a placeholder would either be a secret in Git or overwrite the live
random value when `apply-fctf.sh` applies this directory.

```bash
kubectl -n app create secret generic challenge-access-token-secret \
  --from-literal=CHALLENGE_ACCESS_TOKEN_KEY="$(openssl rand -base64 48)" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n app create secret generic instance-log-query-secret \
  --from-literal=INSTANCE_LOG_CURSOR_KEY="$(openssl rand -base64 48)" \
  --dry-run=client -o yaml | kubectl apply -f -
```

`challenge-access-token-secret` is mounted only by `challenge-gateway` and
`deployment-listener`.  `instance-log-query-secret` is mounted only by
`deployment-center`.
