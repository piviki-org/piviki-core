#!/usr/bin/env bash
# The host-runtime fingerprint (AD-21): sha256 of `git ls-tree -r` over deploy/ (mode, type, blob
# id and path of each file), leaving out the files a host never reads. CI stamps it on each image
# as the fi.piviki.host-runtime label; deploy.sh computes it from the checkout and compares.
# Both pipe the listing in, so there is one definition:
#   git ls-tree -r <commit> -- deploy/ | deploy/fingerprint.sh
# Left out: docs, the local stack, tests, and checks.sh (the runner runs it, from the tag's own
# commit). Any other file, including a new one, counts.
set -euo pipefail
grep -vE $'\t''deploy/(README\.md|compose\.local\.yml|local-env/.*|test/.*|checks\.sh)$' |
  sha256sum | cut -d' ' -f1
