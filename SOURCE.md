# Source notes — C526A ImmortalWrt v11 revision (2026-10-31)

- Device: HiWiFi C526A / IPQ4019 / `ipq40xx/generic`.
- Base: ImmortalWrt `v25.12.2`; Linux 6.12.
- Board support reference: `coolsnowwolf/lede` commit `2f74b3efffd5b1929d5a31d76e763b927aebf759`.
- QCA4019 BDF: `board-hiwifi_c526a.qca4019`; required length 24,300 bytes and Git blob SHA-1 `ce91af5b144d1238ca4eb35dcfdf34c537f9cc7a`.
- Factory MAC key: `Vfac_mac`; key name has no trailing whitespace. MAC handling is retained from the previous tested kit.
- LAN defaults: `192.168.5.1/24`; first-boot migration only changes an unset or old-default `192.168.1.1` address. User-customized addresses are preserved.
- Guest SSID default: `HiWiFi-X`, only used when no previous guest SSID exists.
- Liquid Formula UI snapshot: page files and RPC/ACL/menu files were taken from the user's uploaded export of the running router. Four UI views are overlaid at image-rootfs staging time. RPC backend mode is explicitly set to 0755. Product/protocol/API identifiers remain in English where appropriate.
- Liquid Formula build package: `crackerfly/SingBox-Formula` main feed, cloned at build time. The workflow records the resolved commit in `source-info.txt`; the snapshot overlay pins the UI and rpcd backend files supplied by the user.
- Argon theme: `jerrykuku/luci-theme-argon` tag `v3.1.0`.
- PassWall feeds: `Openwrt-Passwall/openwrt-passwall` and `Openwrt-Passwall/openwrt-passwall-packages` main branches; Xray-core recipe pinned to v26.7.28 for the Go 1.26.x toolchain.
- APK repository configuration: intentionally unchanged in this revision at the user's request.
- MT7615E reboot/sysupgrade handling: the earlier C526A v11 `STOP=60` / `START=99` init service is restored for ordinary reboot; an additional `platform_pre_upgrade` hook is included for Web/CLI sysupgrade, with stage2 abort-on-failure guard. These are workarounds, not a hardware reset or a confirmed root-cause fix.
- MT7615E driver/firmware packages and the C526A DTS Factory EEPROM reference remain, as they are required device support rather than reboot workarounds.
- No Factory/ART/EEPROM calibration writes, no TX-power override, no unbounded PCI rescan, and no automatic looped module reload.

This is a source/build kit, not a precompiled firmware image. A successful GitHub Actions run is required to produce firmware. A successful build does not by itself verify behavior on physical hardware.
