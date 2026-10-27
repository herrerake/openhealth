#!/bin/sh
# Puts the generated fixtures into R2 where the demo providers read them.
#   npm run seed:mock               # local (wrangler dev)
#   npm run seed:mock -- --remote   # the deployed bucket
set -e
MODE="${1:---local}"
for key in wodup/training_sessions.json mindbody/client_visits.json; do
  npx wrangler r2 object put "openhealth-raw/mock/$key" --file "fixtures/data/$key" "$MODE"
done
