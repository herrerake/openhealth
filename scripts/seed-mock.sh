#!/bin/sh
# Puts the generated fixtures into the local R2 bucket where the mock providers read them.
set -e
for key in wodup/training_sessions.json mindbody/client_visits.json; do
  npx wrangler r2 object put "openhealth-raw/mock/$key" --file "fixtures/data/$key" --local
done
