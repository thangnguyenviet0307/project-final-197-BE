#!/usr/bin/env sh
set -eu
echo "BUILD START"
pnpm install --frozen-lockfile
pnpm build
echo "BUILD END"
