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

# Fail rather than emit an image where ath10k cannot find QCA4019 board data.
BDF_IN_ROOT="$(find build_dir -type f -path '*/root-ipq40xx/lib/firmware/ath10k/QCA4019/hw1.0/board-2.bin' -print -quit)"
if [[ -z "$BDF_IN_ROOT" || ! -s "$BDF_IN_ROOT" ]]; then
    echo "ERROR: C526A rootfs is missing QCA4019 board-2.bin" >&2
    exit 1
fi
python3 - "$BDF_IN_ROOT" <<'PYBDF'
from pathlib import Path
import hashlib, sys
p = Path(sys.argv[1])
data = p.read_bytes()
blob_sha = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
expected = "ce91af5b144d1238ca4eb35dcfdf34c537f9cc7a"
if len(data) != 24300 or blob_sha != expected:
    raise SystemExit(f"ERROR: wrong C526A board-2.bin: bytes={len(data)} git_blob_sha1={blob_sha}")
print(f"Verified C526A board-2.bin: {len(data)} bytes, git blob SHA-1 {blob_sha}")
PYBDF

IMAGE_DIR="bin/targets/ipq40xx/generic"
FACTORY="$(find "$IMAGE_DIR" -maxdepth 1 -type f -name '*hiwifi_c526a*factory.ubi' -print -quit)"
[[ -n "$FACTORY" ]] || { echo "ERROR: factory.ubi for hiwifi_c526a was not generated" >&2; exit 1; }
printf 'Factory image: %s\n' "$FACTORY"
