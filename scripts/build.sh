#!/usr/bin/env bash
set -Eeuo pipefail

KIT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE="${GITHUB_WORKSPACE:-$(cd "$KIT_DIR/.." && pwd)}"
SOURCE_DIR="${SOURCE_DIR:-$WORKSPACE/immortalwrt}"

if [[ ! -d "$SOURCE_DIR/.git" ]]; then
	git clone --depth 1 --branch v25.12.2 https://github.com/immortalwrt/immortalwrt.git "$SOURCE_DIR"
fi

cd "$SOURCE_DIR"

# Add feeds required by this .config BEFORE running feeds update/install.
# PassWall's upstream README recommends placing its feeds before stock feeds
# so the current PassWall packages win over older duplicates.
LIQUID_SRC="$WORKSPACE/SingBox-Formula"
if [[ ! -d "$LIQUID_SRC/.git" ]]; then
    git clone --depth 1 https://github.com/crackerfly/SingBox-Formula.git "$LIQUID_SRC"
else
    git -C "$LIQUID_SRC" fetch --depth 1 origin main
    git -C "$LIQUID_SRC" checkout -q FETCH_HEAD
fi
[[ -d "$LIQUID_SRC/openwrt-feed/liquid-formula" ]] || {
    echo "ERROR: Liquid Formula OpenWrt feed is missing" >&2
    exit 1
}
[[ -d "$LIQUID_SRC/openwrt-feed/luci-app-liquid-formula" ]] || {
    echo "ERROR: Liquid Formula LuCI feed is missing" >&2
    exit 1
}

# Argon 3.1.0 is a standalone package repository, so wrap it as a one-package
# feed instead of pointing feeds.conf.default directly at a package root.
ARGON_SRC="$WORKSPACE/luci-theme-argon-src"
ARGON_FEED="$WORKSPACE/argon-feed"
if [[ ! -d "$ARGON_SRC/.git" ]]; then
    git clone --depth 1 --branch v3.1.0 https://github.com/jerrykuku/luci-theme-argon.git "$ARGON_SRC"
else
    git -C "$ARGON_SRC" fetch --depth 1 origin tag v3.1.0
    git -C "$ARGON_SRC" checkout -q v3.1.0
fi
rm -rf "$ARGON_FEED"
mkdir -p "$ARGON_FEED/luci-theme-argon"
git -C "$ARGON_SRC" archive --format=tar v3.1.0 | tar -xf - -C "$ARGON_FEED/luci-theme-argon"

python3 - "$WORKSPACE/SingBox-Formula/openwrt-feed" "$ARGON_FEED" <<'PYFEEDS'
from pathlib import Path
import sys
feed_file = Path("feeds.conf.default")
liquid_source = Path(sys.argv[1]).resolve()
argon_source = Path(sys.argv[2]).resolve()
if not feed_file.exists():
    raise SystemExit("ERROR: feeds.conf.default not found")
existing = feed_file.read_text().splitlines()
required = [
    "src-git passwall_packages https://github.com/Openwrt-Passwall/openwrt-passwall-packages.git;main",
    "src-git passwall_luci https://github.com/Openwrt-Passwall/openwrt-passwall.git;main",
    f"src-link argon {argon_source}",
    f"src-link liquid_formula {liquid_source}",
]
# Feed order matters for duplicate package names; these entries go first.
missing = [line for line in required if line not in existing]
if missing:
    feed_file.write_text("\n".join(missing + existing).rstrip() + "\n")
print("Configured PassWall, Argon 3.1.0 and Liquid Formula feeds")
PYFEEDS

./scripts/feeds update -a
./scripts/feeds install -a

# ImmortalWrt 25.12.2's packages feed builds Go 1.26.8. Xray-core >= 26.9.8
# requires Go 1.27, so pin PassWall's xray-core recipe to v26.7.28 (go 1.26)
# rather than mutating go.mod or trying to let GOTOOLCHAIN download a toolchain.
XRAY_MAKEFILE="$SOURCE_DIR/feeds/passwall_packages/xray-core/Makefile"
python3 - "$XRAY_MAKEFILE" <<'PYXRAY'
from pathlib import Path
import re, sys
p = Path(sys.argv[1])
if not p.is_file():
    raise SystemExit(f"ERROR: PassWall xray-core Makefile not found: {p}")
s = p.read_text()
if not re.search(r"(?m)^\s*PKG_NAME\s*:=\s*xray-core\s*$", s, re.IGNORECASE):
    raise SystemExit("ERROR: unexpected xray-core Makefile; refusing to patch unknown package")
if "github.com/XTLS/Xray-core" not in s and "github.com/xtls/Xray-core" not in s and "codeload.github.com/XTLS/Xray-core" not in s:
    raise SystemExit("ERROR: xray-core source URL was not recognized; refusing to patch")
for key, value in (
    ("PKG_VERSION", "26.7.28"),
    ("PKG_HASH", "a9afe86349c7bd3e6cae60125e62a5ada09d102e1a2760623e77c24a84dbfb46"),
):
    pattern = rf"(?m)^\s*{key}\s*:=.*$"
    matches = list(re.finditer(pattern, s))
    if len(matches) != 1:
        raise SystemExit(f"ERROR: expected one {key} line in {p}, found {len(matches)}")
    s = re.sub(pattern, f"{key}:={value}", s, count=1, flags=re.M)
p.write_text(s)
print("Pinned PassWall xray-core to v26.7.28 (go.mod: go 1.26) for the Go 1.26.8 toolchain")
PYXRAY

# Fail early if any requested application feed was not installed.
for pkgdir in \
    feeds/passwall_luci/luci-app-passwall \
    feeds/argon/luci-theme-argon \
    feeds/liquid_formula/liquid-formula \
    feeds/liquid_formula/luci-app-liquid-formula; do
    [[ -d "$pkgdir" ]] || {
        echo "ERROR: required feed package was not installed: $pkgdir" >&2
        exit 1
    }
done

bash "$KIT_DIR/scripts/apply-c526a.sh" "$SOURCE_DIR"
cp "$KIT_DIR/.config" .config
make defconfig
for symbol in \
    CONFIG_PACKAGE_luci-app-passwall \
    CONFIG_PACKAGE_liquid-formula \
    CONFIG_PACKAGE_luci-app-liquid-formula \
    CONFIG_PACKAGE_luci-theme-argon; do
    if ! grep -qx "${symbol}=y" .config; then
        echo "ERROR: make defconfig did not retain ${symbol}=y; check its feed/package dependencies" >&2
        exit 1
    fi
done
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
