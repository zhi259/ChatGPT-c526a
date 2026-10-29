# Source notes

- Board support is derived from `coolsnowwolf/lede` commit `2f74b3efffd5b1929d5a31d76e763b927aebf759`.
- Target is `immortalwrt/immortalwrt` tag `v25.12.2`; `target/linux/ipq40xx/Makefile` sets `KERNEL_PATCHVER:=6.12`.
- The 6.12 image recipes are in `target/linux/ipq40xx/image/generic.mk`; `Device/UbiFit` declares `factory.ubi` and `sysupgrade.bin`.
- The C526A device block excludes the ath10k-ct package and selects non-CT ath10k firmware, following the original C526A port's compatibility warning.

- Ethernet fix: Linux 6.12 DSA uses `switch@c000000` and IPQESS `ethernet@c080000` nodes, enabled through `&switch` and `&gmac`; DSA ports 2–5 are explicitly enabled. Network defaults use `lan2 lan3 lan4` and `wan`, not the old `switch0`/`swconfig` stanza.
- MAC setup ignores an invalid/empty `Vfac_mac` value so it does not emit malformed `macaddr ':'`. The wireless MAC and ath10k MAC patch scripts likewise avoid applying an invalid address. If factory MAC extraction remains empty on the device, the `bdinfo` layout/key must be inspected before fixing wireless MAC derivation.
- Runtime log follow-up: if the existing build shows only legacy `eth0`/`eth1`, no MDIO/PHY/IPQESS logs, and no `swconfig` utility, treat that as a failed migration from legacy swconfig networking to Linux 6.12 DSA. The corrected board defaults use DSA interface names (`lan2 lan3 lan4`, `wan`) and require a fresh network configuration after flashing.

- BDF recovery fix (v4): `ipq-wifi`'s custom `install-overlay` searches for `board-hiwifi_c526a.*` inside `PKG_BUILD_DIR`. The previous script downloaded the file into the package `files/` directory but did not stage it, so the package was listed as installed while `board-2.bin` was absent. v4 copies the BDF during `Build/Prepare` and verifies the final rootfs file's 24,300-byte length and Git blob SHA-1.
