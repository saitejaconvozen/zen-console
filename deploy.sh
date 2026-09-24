#!/usr/bin/env bash
# Finish deploying the static console to GitHub Pages.
# Prereq: `gh auth login` has been run once (GitHub.com, HTTPS, login via browser).
set -euo pipefail
USER=saitejaconvozen
REPO=zen-console
cd "$(dirname "$0")"

# Create the repo (if it doesn't exist yet) and push main.
if ! gh repo view "$USER/$REPO" >/dev/null 2>&1; then
  gh repo create "$USER/$REPO" --public --source=. --remote=origin --push
else
  git push -u origin main
fi

# Turn on GitHub Pages from the main branch root.
gh api -X POST "repos/$USER/$REPO/pages" \
  -f 'source[branch]=main' -f 'source[path]=/' 2>/dev/null || \
gh api -X PUT "repos/$USER/$REPO/pages" \
  -f 'source[branch]=main' -f 'source[path]=/' 2>/dev/null || true

echo
echo "Deployed. Your always-on link (live within a minute or two):"
echo "  https://$USER.github.io/$REPO/"
