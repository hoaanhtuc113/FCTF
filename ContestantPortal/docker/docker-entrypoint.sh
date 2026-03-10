#!/bin/sh
# Write env.js to /tmp (readOnlyRootFilesystem=true, /tmp is emptyDir)
envsubst < /usr/share/nginx/html/env.template.js > /tmp/env.js
exec "$@"