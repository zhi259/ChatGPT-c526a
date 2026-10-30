# Source notes — C526A v11 Wireless Validation

- ImmortalWrt base: tag `v25.12.2` (Linux 6.12 target for ipq40xx).
- C526A port reference: `coolsnowwolf/lede` commit `2f74b3efffd5b1929d5a31d76e763b927aebf759`.
- QCA4019 BDF: `board-hiwifi_c526a.qca4019`; checked against Git blob SHA-1 `ce91af5b144d1238ca4eb35dcfdf34c537f9cc7a` and length 24,300 bytes.
- Liquid Formula: `crackerfly/SingBox-Formula` `main` feed; source commit is resolved by the CI clone at build time.
- Wireless temperature: retained in the existing top temperature summary via `/sbin/tempinfo`; v11 removes v10's duplicate overview widget and its dedicated rpcd helper.
- Argon theme: `jerrykuku/luci-theme-argon` tag `v3.1.0`.
- PassWall feeds: `Openwrt-Passwall/openwrt-passwall` and `Openwrt-Passwall/openwrt-passwall-packages` `main`; Xray-core recipe is pinned to `v26.7.28` for the Go 1.26.x toolchain shipped with this base.

Upstream repos that use mutable `main` branches may advance. The workflow records the checked-out commits where supported. This kit has not been fully cross-compiled locally; a successful GitHub Actions run is required to produce verified firmware images.
- MT7615 DTS: candidate Linux 6.12 `&pcie0 { pcie@0 { wifi@0,0 } }` endpoint layout; must be validated on the actual C526A before considering EEPROM/power issue fixed.
- MT7615 reboot recovery: v10 was tested once on the C526A; persistent overlay log confirmed `mt7615e` unloaded during shutdown, rebound on boot, firmware initialized, and 2.4 GHz returned on channel 1. This is one successful test, not a guarantee across repeated cycles. No calibration writes or TX-power overrides are used.
