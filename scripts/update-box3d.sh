#!/usr/bin/env bash
set -euo pipefail

REF="${1:-main}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

git -C "$ROOT/vendor/box3d" fetch origin --tags
if git -C "$ROOT/vendor/box3d" show-ref --verify --quiet "refs/remotes/origin/$REF"; then
	git -C "$ROOT/vendor/box3d" checkout --detach "origin/$REF"
else
	git -C "$ROOT/vendor/box3d" checkout --detach "$REF"
fi

echo "Box3D pinned to:"
git -C "$ROOT/vendor/box3d" log -1 --oneline
