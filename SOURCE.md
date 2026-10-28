# Source notes

- Board support is derived from `coolsnowwolf/lede` commit `2f74b3efffd5b1929d5a31d76e763b927aebf759`.
- Target is `immortalwrt/immortalwrt` tag `v25.12.2`; `target/linux/ipq40xx/Makefile` sets `KERNEL_PATCHVER:=6.12`.
- The 6.12 image recipes are in `target/linux/ipq40xx/image/generic.mk`; `Device/UbiFit` declares `factory.ubi` and `sysupgrade.bin`.
- The C526A device block excludes the ath10k-ct package and selects non-CT ath10k firmware, following the original C526A port's compatibility warning.
