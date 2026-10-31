#!/bin/sh
# C526A-only MT7615E sysupgrade pre-upgrade hook.
# stage2 calls this after stopping userspace processes and before switching to ramfs.
# No wifi/ubus calls here: network services may already be gone.
# No register writes, GPIO toggles, or calibration partition access.

platform_pre_upgrade() {
    [ "$(board_name)" = "hiwifi,c526a" ] || return 0

    echo "<6>C526A: stage2 MT7615 pre-upgrade hook started" > /dev/kmsg

    if ! grep -q '^mt7615e[[:space:]]' /proc/modules; then
        echo "<6>C526A: mt7615e already unloaded before sysupgrade" > /dev/kmsg
        return 0
    fi

    if ! /sbin/rmmod mt7615e; then
        echo "<3>C526A: ERROR: could not unload mt7615e before sysupgrade" > /dev/kmsg
        return 1
    fi

    sleep 2

    if grep -q '^mt7615e[[:space:]]' /proc/modules; then
        echo "<3>C526A: ERROR: mt7615e remains loaded after rmmod" > /dev/kmsg
        return 1
    fi

    echo "<6>C526A: mt7615e unloaded successfully before sysupgrade image write" > /dev/kmsg
    return 0
}
