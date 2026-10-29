#!/usr/bin/env bash
set -Eeuo pipefail

KIT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE="${GITHUB_WORKSPACE:-$(cd "$KIT_DIR/.." && pwd)}"
SOURCE_DIR="${SOURCE_DIR:-$WORKSPACE/immortalwrt}"

: > "$WORKSPACE/source-info.txt"
if [[ ! -d "$SOURCE_DIR/.git" ]]; then
	git clone --depth 1 --branch v25.12.2 https://github.com/immortalwrt/immortalwrt.git "$SOURCE_DIR"
fi

cd "$SOURCE_DIR"
printf 'IMMORTALWRT_TAG=v25.12.2\nIMMORTALWRT_COMMIT=%s\n' "$(git rev-parse HEAD)" >> "$WORKSPACE/source-info.txt"

# Add the OpenWrt 25.x temperature widget as a local source package. The source
# revision is recorded so a successful build is reproducible/auditable.
TEMP_SRC="$WORKSPACE/luci-app-temp-src"
if [[ ! -d "$TEMP_SRC/.git" ]]; then
    git clone --depth 1 https://github.com/ramanarupa/luci-app-temp.git "$TEMP_SRC"
else
    git -C "$TEMP_SRC" fetch --depth 1 origin main
    git -C "$TEMP_SRC" checkout -q FETCH_HEAD
fi
# Stage it outside the OpenWrt source until feeds have been installed; it is
# copied under package/feeds/c526a_local below for reliable package discovery.
TEMP_PACKAGE_SRC="$WORKSPACE/local-package-src/luci-app-temp"
rm -rf "$TEMP_PACKAGE_SRC" "$SOURCE_DIR/package/luci-app-temp"
mkdir -p "$TEMP_PACKAGE_SRC"
git -C "$TEMP_SRC" archive --format=tar HEAD | tar -xf - -C "$TEMP_PACKAGE_SRC"
python3 "$KIT_DIR/scripts/patch-temp-widget.py" "$TEMP_PACKAGE_SRC"
printf 'TEMP_WIDGET_COMMIT=%s\n' "$(git -C "$TEMP_SRC" rev-parse HEAD)" >> "$WORKSPACE/source-info.txt"

# Install the C526A LuCI pages and rpcd helper through OpenWrt's standard
# rootfs overlay. These pages are interpreted JavaScript plus a shell RPC helper;
# they do not need to be a separately indexed package. This intentionally avoids
# the repeated failure where Makefile exists but the custom package is absent
# from tmp/.packageinfo and make defconfig drops its CONFIG_PACKAGE option.
WIZARD_OVERLAY="$KIT_DIR/rootfs-overlay"
for rel in \
    www/luci-static/resources/view/c526a/wizard.js \
    www/luci-static/resources/view/c526a/guestwifi.js \
    www/luci-static/resources/view/status/include/29_c526a_traffic.js \
    usr/libexec/rpcd/luci.c526a_traffic \
    usr/share/rpcd/acl.d/luci-app-c526a-wizard.json \
    usr/share/luci/menu.d/luci-app-c526a-wizard.json; do
    [[ -f "$WIZARD_OVERLAY/$rel" ]] || {
        echo "ERROR: required C526A LuCI overlay file is missing: $WIZARD_OVERLAY/$rel" >&2
        exit 1
    }
done
mkdir -p "$SOURCE_DIR/files"
cp -a "$WIZARD_OVERLAY/." "$SOURCE_DIR/files/"
chmod 0755 "$SOURCE_DIR/files/usr/libexec/rpcd/luci.c526a_traffic"
# Remove stale copies in a reused source tree; the wizard is now an overlay,
# not a package selected through feeds or .config.
rm -rf "$SOURCE_DIR/package/luci-app-c526a-wizard" \
    "$SOURCE_DIR/package/feeds/c526a_local/luci-app-c526a-wizard"

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
printf 'LIQUID_FORMULA_COMMIT=%s\n' "$(git -C "$LIQUID_SRC" rev-parse HEAD)" >> "$WORKSPACE/source-info.txt"

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
printf 'ARGON_COMMIT=%s\n' "$(git -C "$ARGON_SRC" rev-parse v3.1.0)" >> "$WORKSPACE/source-info.txt"

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

# The upstream temperature widget is a real package. Stage it in the standard
# package/feeds scan tree and validate its metadata after defconfig. The C526A
# wizard, guest Wi-Fi UI, WAN-rate widget, menu, ACL and RPC helper are instead
# installed via the rootfs overlay above, so they need no package index entry.
TEMP_PACKAGE_DIR="$SOURCE_DIR/package/feeds/c526a_local/luci-app-temp"
rm -rf "$SOURCE_DIR/package/luci-app-temp" "$TEMP_PACKAGE_DIR"
mkdir -p "$(dirname "$TEMP_PACKAGE_DIR")"
cp -a "$TEMP_PACKAGE_SRC" "$TEMP_PACKAGE_DIR"
[[ -f "$TEMP_PACKAGE_DIR/Makefile" ]] || {
    echo "ERROR: temperature widget Makefile missing from $TEMP_PACKAGE_DIR" >&2
    find "$TEMP_PACKAGE_SRC" -maxdepth 4 -type f -print >&2 || true
    exit 1
}

# Translate the Liquid Formula LuCI views before configuring/building packages.
python3 "$KIT_DIR/scripts/patch-liquid-formula-zh.py" "$SOURCE_DIR/feeds/liquid_formula/luci-app-liquid-formula"

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
if ! grep -q '^Package: luci-app-temp$' tmp/.packageinfo 2>/dev/null; then
    echo "ERROR: OpenWrt did not index local temperature package luci-app-temp after make defconfig" >&2
    echo "Temperature package directory: $TEMP_PACKAGE_DIR" >&2
    find "$SOURCE_DIR/package/feeds/c526a_local" -maxdepth 5 -type f -name Makefile -print >&2 || true
    grep -n -E 'Package: luci-app-temp|luci-app-temp' tmp/.packageinfo tmp/.config-package.in 2>/dev/null | head -n 80 >&2 || true
    exit 1
fi
# These kernel modules must be part of this exact custom kernel build. Never rely on
# installing kmods from a public feed later, because kernel ABI hashes may differ.
for symbol in \
    CONFIG_PACKAGE_luci-app-temp \
    CONFIG_PACKAGE_luci-i18n-base-zh-cn \
    CONFIG_PACKAGE_luci-i18n-passwall-zh-cn \
    CONFIG_PACKAGE_luci-app-firewall \
    CONFIG_PACKAGE_luci-i18n-firewall-zh-cn \
    CONFIG_PACKAGE_luci-app-passwall \
    CONFIG_PACKAGE_luci-app-passwall_Nftables_Transparent_Proxy \
    CONFIG_PACKAGE_luci-app-passwall_INCLUDE_SingBox \
    CONFIG_PACKAGE_luci-app-passwall_INCLUDE_Xray \
    CONFIG_PACKAGE_kmod-nft-socket \
    CONFIG_PACKAGE_kmod-nft-tproxy \
    CONFIG_PACKAGE_kmod-nf-socket \
    CONFIG_PACKAGE_kmod-nf-tproxy \
    CONFIG_PACKAGE_kmod-nft-nat \
    CONFIG_PACKAGE_kmod-tun \
    CONFIG_PACKAGE_kmod-inet-diag \
    CONFIG_PACKAGE_kmod-netlink-diag \
    CONFIG_PACKAGE_liquid-formula \
    CONFIG_PACKAGE_luci-app-liquid-formula \
    CONFIG_PACKAGE_luci-theme-argon; do
    if ! grep -qx "${symbol}=y" .config; then
        echo "ERROR: make defconfig did not retain ${symbol}=y; check package discovery and dependencies" >&2
        if [[ "$symbol" == "CONFIG_PACKAGE_luci-app-temp" ]]; then
            echo "---- temperature package Makefile ----" >&2
            sed -n '1,100p' "$TEMP_PACKAGE_DIR/Makefile" >&2 || true
            echo "---- package metadata matches ----" >&2
            grep -n -E 'Package: luci-app-temp|luci-app-temp' tmp/.packageinfo tmp/.config-package.in 2>/dev/null | head -n 80 >&2 || true
        fi
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

# Verify that the C526A rootfs overlay supplied the overview widget and its RPC backend.
ROOTFS_DIR="${BDF_IN_ROOT%/lib/firmware/ath10k/QCA4019/hw1.0/board-2.bin}"
[[ -f "$ROOTFS_DIR/www/luci-static/resources/view/status/include/29_c526a_traffic.js" ]] || {
    echo "ERROR: overview traffic widget is missing from the image rootfs" >&2
    exit 1
}
[[ -x "$ROOTFS_DIR/usr/libexec/rpcd/luci.c526a_traffic" ]] || {
    echo "ERROR: WAN traffic RPC backend is missing or not executable in the image rootfs" >&2
    exit 1
}
[[ -f "$ROOTFS_DIR/www/luci-static/resources/view/c526a/guestwifi.js" ]] || {
    echo "ERROR: C526A guest Wi-Fi LuCI page is missing from the image rootfs" >&2
    exit 1
}
[[ -f "$ROOTFS_DIR/usr/share/luci/menu.d/luci-app-c526a-wizard.json" ]] || {
    echo "ERROR: C526A LuCI menu definition is missing from the image rootfs" >&2
    exit 1
}

IMAGE_DIR="bin/targets/ipq40xx/generic"
MANIFEST="$(find "$IMAGE_DIR" -maxdepth 1 -type f -name '*.manifest' -print -quit)"
[[ -n "$MANIFEST" ]] || { echo "ERROR: target package manifest was not generated" >&2; exit 1; }
FACTORY="$(find "$IMAGE_DIR" -maxdepth 1 -type f -name '*hiwifi_c526a*factory.ubi' -print -quit)"
SYSUPGRADE="$(find "$IMAGE_DIR" -maxdepth 1 -type f -name '*hiwifi_c526a*sysupgrade.bin' -print -quit)"
[[ -n "$FACTORY" ]] || { echo "ERROR: factory.ubi for hiwifi_c526a was not generated" >&2; exit 1; }
[[ -n "$SYSUPGRADE" ]] || { echo "ERROR: sysupgrade.bin for hiwifi_c526a was not generated" >&2; exit 1; }
for pkg in luci-app-temp liquid-formula luci-app-liquid-formula luci-i18n-base-zh-cn luci-i18n-passwall-zh-cn; do
    grep -qE "^${pkg}[[:space:]]" "$MANIFEST" || {
        echo "ERROR: expected package missing from firmware manifest: ${pkg}" >&2
        exit 1
    }
done
printf 'Factory image: %s\nSysupgrade image: %s\n' "$FACTORY" "$SYSUPGRADE"
