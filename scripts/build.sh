#!/usr/bin/env bash
set -Eeuo pipefail

KIT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE="${GITHUB_WORKSPACE:-$(cd "$KIT_DIR/.." && pwd)}"
SOURCE_DIR="${SOURCE_DIR:-$WORKSPACE/immortalwrt}"

if [[ ! -d "$SOURCE_DIR/.git" ]]; then
	git clone --depth 1 --branch v25.12.2 https://github.com/immortalwrt/immortalwrt.git "$SOURCE_DIR"
fi

cd "$SOURCE_DIR"
./scripts/feeds update -a
./scripts/feeds install -a
bash "$KIT_DIR/scripts/apply-c526a.sh" "$SOURCE_DIR"
cp "$KIT_DIR/.config" .config
make defconfig
make download -j8
# v25.12.2 targets Linux 6.12 for ipq40xx; all images are built from the target config.
make -j2 V=s

IMAGE_DIR="bin/targets/ipq40xx/generic"
FACTORY="$(find "$IMAGE_DIR" -maxdepth 1 -type f -name '*hiwifi_c526a*factory.ubi' -print -quit)"
[[ -n "$FACTORY" ]] || { echo "ERROR: factory.ubi for hiwifi_c526a was not generated" >&2; exit 1; }
printf 'Factory image: %s\n' "$FACTORY"
