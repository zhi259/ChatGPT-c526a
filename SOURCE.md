# Source notes — C526A v9 Final

- ImmortalWrt base: tag `v25.12.2` (Linux 6.12 target for ipq40xx).
- C526A port reference: `coolsnowwolf/lede` commit `2f74b3efffd5b1929d5a31d76e763b927aebf759`.
- QCA4019 BDF: `board-hiwifi_c526a.qca4019`; checked against Git blob SHA-1 `ce91af5b144d1238ca4eb35dcfdf34c537f9cc7a` and length 24,300 bytes.
- Liquid Formula: `crackerfly/SingBox-Formula` `main` feed; source commit is resolved by the CI clone at build time.
- Temperature UI: `ramanarupa/luci-app-temp` `main`; exact commit is recorded in `source-info.txt` by CI.
- Argon theme: `jerrykuku/luci-theme-argon` tag `v3.1.0`.
- PassWall feeds: `Openwrt-Passwall/openwrt-passwall` and `Openwrt-Passwall/openwrt-passwall-packages` `main`; Xray-core recipe is pinned to `v26.7.28` for the Go 1.26.x toolchain shipped with this base.

Upstream repos that use mutable `main` branches may advance. The workflow records the checked-out commits where supported. This kit has not been fully cross-compiled locally; a successful GitHub Actions run is required to produce verified firmware images.
