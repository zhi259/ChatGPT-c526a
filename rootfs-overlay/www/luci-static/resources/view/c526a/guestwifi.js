'use strict';
'require view';
'require uci';
'require ui';

function inputField(id, label, value, type, placeholder) {
	return E('div', { 'class': 'cbi-value' }, [
		E('label', { 'class': 'cbi-value-title', 'for': id }, label),
		E('div', { 'class': 'cbi-value-field' }, [
			E('input', {
				'id': id,
				'name': id,
				'type': type || 'text',
				'class': 'cbi-input-text',
				'value': value || '',
				'placeholder': placeholder || '',
				'autocomplete': type === 'password' ? 'new-password' : 'off'
			})
		])
	]);
}

function checkField(id, label, checked) {
	return E('div', { 'class': 'cbi-value' }, [
		E('label', { 'class': 'cbi-value-title', 'for': id }, label),
		E('div', { 'class': 'cbi-value-field' }, [
			E('input', { 'id': id, 'type': 'checkbox', 'checked': !!checked }),
			' ', label
		])
	]);
}

function hasSection(config, name) {
	return uci.sections(config).some(function(section) {
		return section['.name'] === name;
	});
}

function ensureSection(config, type, name) {
	if (!hasSection(config, name))
		uci.add(config, type, name);
}

function findSection(config, type, option, value) {
	var sections = uci.sections(config, type) || [];
	for (var i = 0; i < sections.length; i++) {
		if (sections[i][option] === value)
			return sections[i]['.name'];
	}
	return null;
}

function checked(id) {
	var el = document.getElementById(id);
	return !!(el && el.checked);
}

function value(id) {
	var el = document.getElementById(id);
	return el ? String(el.value || '').trim() : '';
}

function validSSID(ssid) {
	return ssid.length > 0 && ssid.length <= 32 && !/[\u0000-\u001f\u007f]/.test(ssid);
}

function validIPv4(host) {
	var p = host.split('.');
	if (p.length !== 4)
		return false;
	for (var i = 0; i < 4; i++) {
		if (!/^\d{1,3}$/.test(p[i]) || Number(p[i]) > 255 || String(Number(p[i])) !== p[i])
			return false;
	}
	return Number(p[0]) > 0 && Number(p[0]) < 224 && Number(p[3]) > 0 && Number(p[3]) < 255;
}

function same24(a, b) {
	var x = a.split('.'), y = b.split('.');
	return x.length === 4 && y.length === 4 && Number(x[0]) === Number(y[0]) && Number(x[1]) === Number(y[1]) && Number(x[2]) === Number(y[2]);
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('network'), uci.load('wireless'), uci.load('dhcp'), uci.load('firewall')
		]);
	},

	render: function() {
		var names = [ 'guest_radio0', 'guest_radio1', 'guest_radio2' ];
		var present = names.map(function(name) { return !!uci.get('wireless', name, 'ssid'); });
		var active = names.some(function(name) {
			return !!uci.get('wireless', name, 'ssid') && uci.get('wireless', name, 'disabled') !== '1';
		});
		var keyPresent = names.some(function(name) { return !!uci.get('wireless', name, 'key'); });
		var lanIP = uci.get('network', 'lan', 'ipaddr') || '192.168.5.1';
		var guestIP = uci.get('network', 'guest', 'ipaddr') || '192.168.6.1';
		var guestSSID = names.map(function(name) { return uci.get('wireless', name, 'ssid'); }).filter(Boolean)[0] || 'C526A-Guest';
		var radioDefaults = [ 'radio0', 'radio1', 'radio2' ].map(function(radio, i) {
			return present[i] ? uci.get('wireless', names[i], 'disabled') !== '1' : uci.get('wireless', radio, 'disabled') !== '1';
		});

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('访客 Wi-Fi')),
			E('p', {}, _('创建一个独立的访客无线网络。访客可以访问互联网，但不能访问家庭 LAN 网段；默认也会阻止访客设备之间互相访问。')),
			E('div', { 'class': 'alert-message warning' }, [
				E('p', {}, _('访客网络默认使用 192.168.6.1/24，DHCP 地址池为 192.168.6.100–192.168.6.249。请确认它与主 LAN 和上级网络网段不冲突。访客 Wi-Fi 密码至少 8 位。'))
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('基本设置')),
				checkField('c526a_guest_enabled', _('启用访客 Wi-Fi'), active),
				inputField('c526a_guest_ssid', _('访客 Wi-Fi 名称'), guestSSID, 'text', _('例如 C526A-Guest；最多 32 个字符')),
				inputField('c526a_guest_key', _('访客 Wi-Fi 密码'), '', 'password', keyPresent ? _('留空则保留现有密码；填写后将修改密码') : _('首次启用请设置 8–63 位可打印 ASCII 密码')),
				inputField('c526a_guest_ip', _('访客网络网关地址'), guestIP, 'text', '192.168.6.1'),
				E('p', { 'class': 'cbi-section-descr' }, _('子网掩码固定为 255.255.255.0。访客网络使用独立防火墙区域，只允许 DNS、DHCP 和访问 WAN。'))
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('广播频段')),
				checkField('c526a_guest_radio0', _('在 2.4 GHz（MT7615E）广播访客 Wi-Fi'), radioDefaults[0]),
				checkField('c526a_guest_radio1', _('在 5 GHz 无线模块 1（QCA4019）广播访客 Wi-Fi'), radioDefaults[1]),
				checkField('c526a_guest_radio2', _('在 5 GHz 无线模块 2（QCA4019）广播访客 Wi-Fi'), radioDefaults[2]),
				E('p', { 'class': 'cbi-section-descr' }, _('建议优先选择已正常工作的无线模块。关闭主无线电时，其访客网络也无法广播。'))
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('网络隔离说明')),
				E('ul', {}, [
					E('li', {}, _('访客地址段：网关地址所在的 /24 子网；默认 192.168.6.0/24。')),
					E('li', {}, _('访客不能访问主 LAN，也不能访问路由器管理页面；仅允许使用路由器提供的 DNS/DHCP 服务。')),
					E('li', {}, _('访客设备之间启用无线客户端隔离。')),
					E('li', {}, _('访客到互联网的访问仍受 WAN 连接和 WAN 防火墙/NAT 配置影响。'))
				])
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('应用设置')),
				E('button', {
					'class': 'cbi-button cbi-button-action important',
					'click': ui.createHandlerFn(this, 'applyGuest')
				}, _('保存并应用访客网络设置'))
			])
		]);
	},

	applyGuest: function() {
		var enable = checked('c526a_guest_enabled');
		var ssid = value('c526a_guest_ssid');
		var key = value('c526a_guest_key');
		var guestIP = value('c526a_guest_ip');
		var lanIP = uci.get('network', 'lan', 'ipaddr') || '192.168.5.1';
		var radios = [
			{ id: 'guest_radio0', radio: 'radio0', checkbox: 'c526a_guest_radio0' },
			{ id: 'guest_radio1', radio: 'radio1', checkbox: 'c526a_guest_radio1' },
			{ id: 'guest_radio2', radio: 'radio2', checkbox: 'c526a_guest_radio2' }
		];
		var existingKey = null;
		radios.some(function(item) {
			existingKey = uci.get('wireless', item.id, 'key');
			return !!existingKey;
		});

		if (enable && !validSSID(ssid))
			return this.showError(_('访客 Wi-Fi 名称不能为空、最多 32 个字符，且不能包含控制字符。'));
		if (!validIPv4(guestIP))
			return this.showError(_('访客网关地址不是有效的 IPv4 主机地址。'));
		if (enable && same24(guestIP, lanIP))
			return this.showError(_('访客网络与主 LAN 处于同一 /24 网段，无法隔离。请将访客网关设为另一个网段，例如 192.168.6.1。'));
		var guestLastOctet = Number(guestIP.split('.')[3]);
		if (guestLastOctet >= 100 && guestLastOctet <= 249)
			return this.showError(_('访客网关的最后一段不能位于 100–249，因为它与默认 DHCP 地址池重叠；建议使用 1–99 或 250–254。'));
		var usableBand = radios.some(function(item) {
			return checked(item.checkbox) && uci.get('wireless', item.radio, 'disabled') !== '1';
		});
		if (enable && !usableBand)
			return this.showError(_('启用访客 Wi-Fi 时，至少选择一个已启用的无线频段。'));

		if (!enable && !hasSection('network', 'guest') && radios.every(function(item) { return !hasSection('wireless', item.id); })) {
			ui.addNotification(null, E('p', {}, _('访客 Wi-Fi 尚未配置，无需关闭。')));
			return Promise.resolve();
		}
		if (enable && !key && !existingKey)
			return this.showError(_('首次启用访客 Wi-Fi 时必须设置密码。'));
		if (key && !/^[\x20-\x7e]{8,63}$/.test(key))
			return this.showError(_('访客 Wi-Fi 密码必须为 8–63 位可打印 ASCII 字符。'));

		if (!window.confirm(enable ? _('即将启用独立访客网络。访客可访问互联网，但不能访问主 LAN；确认继续？') : _('即将关闭访客 Wi-Fi 广播。已配置的访客网络与防火墙规则会保留，确认继续？')))
			return Promise.resolve();

		var bridge = findSection('network', 'device', 'name', 'br-guest') || 'c526a_guest_dev';
		ensureSection('network', 'device', bridge);
		uci.set('network', bridge, 'type', 'bridge');
		uci.set('network', bridge, 'name', 'br-guest');
		uci.set('network', bridge, 'bridge_empty', '1');
		ensureSection('network', 'interface', 'guest');
		uci.set('network', 'guest', 'proto', enable ? 'static' : 'none');
		uci.set('network', 'guest', 'device', 'br-guest');
		uci.set('network', 'guest', 'ipaddr', guestIP || '192.168.6.1');
		uci.set('network', 'guest', 'netmask', '255.255.255.0');

		ensureSection('dhcp', 'dhcp', 'guest');
		uci.set('dhcp', 'guest', 'interface', 'guest');
		uci.set('dhcp', 'guest', 'start', '100');
		uci.set('dhcp', 'guest', 'limit', '150');
		uci.set('dhcp', 'guest', 'leasetime', '12h');
		uci.set('dhcp', 'guest', 'ignore', enable ? '0' : '1');

		var zone = findSection('firewall', 'zone', 'name', 'guest');
		if (!zone) {
			ensureSection('firewall', 'zone', 'c526a_guest');
			zone = 'c526a_guest';
		}
		uci.set('firewall', zone, 'name', 'guest');
		uci.set('firewall', zone, 'network', [ 'guest' ]);
		uci.set('firewall', zone, 'input', 'REJECT');
		uci.set('firewall', zone, 'output', 'ACCEPT');
		uci.set('firewall', zone, 'forward', 'REJECT');

		var guestForwardings = (uci.sections('firewall', 'forwarding') || []).filter(function(section) {
			return section.src === 'guest';
		});
		if (guestForwardings.length) {
			/* Enforce the isolation policy even if an earlier config had guest -> lan. */
			guestForwardings.forEach(function(section) {
				uci.set('firewall', section['.name'], 'dest', 'wan');
			});
		}
		else {
			ensureSection('firewall', 'forwarding', 'c526a_guest_wan');
			uci.set('firewall', 'c526a_guest_wan', 'src', 'guest');
			uci.set('firewall', 'c526a_guest_wan', 'dest', 'wan');
		}

		var dnsRule = findSection('firewall', 'rule', 'name', 'Allow-DNS-Guest');
		if (!dnsRule) {
			ensureSection('firewall', 'rule', 'c526a_guest_dns');
			dnsRule = 'c526a_guest_dns';
		}
		uci.set('firewall', dnsRule, 'name', 'Allow-DNS-Guest');
		uci.set('firewall', dnsRule, 'src', 'guest');
		uci.set('firewall', dnsRule, 'proto', 'tcp udp');
		uci.set('firewall', dnsRule, 'dest_port', '53');
		uci.set('firewall', dnsRule, 'family', 'ipv4');
		uci.set('firewall', dnsRule, 'target', 'ACCEPT');

		var dhcpRule = findSection('firewall', 'rule', 'name', 'Allow-DHCP-Guest');
		if (!dhcpRule) {
			ensureSection('firewall', 'rule', 'c526a_guest_dhcp');
			dhcpRule = 'c526a_guest_dhcp';
		}
		uci.set('firewall', dhcpRule, 'name', 'Allow-DHCP-Guest');
		uci.set('firewall', dhcpRule, 'src', 'guest');
		uci.set('firewall', dhcpRule, 'proto', 'udp');
		uci.set('firewall', dhcpRule, 'dest_port', '67');
		uci.set('firewall', dhcpRule, 'family', 'ipv4');
		uci.set('firewall', dhcpRule, 'target', 'ACCEPT');

		radios.forEach(function(item) {
			if (!enable && !hasSection('wireless', item.id))
				return;
			ensureSection('wireless', 'wifi-iface', item.id);
			var radioOn = uci.get('wireless', item.radio, 'disabled') !== '1';
			var bandOn = checked(item.checkbox) && radioOn;
			uci.set('wireless', item.id, 'device', item.radio);
			uci.set('wireless', item.id, 'mode', 'ap');
			uci.set('wireless', item.id, 'network', 'guest');
			uci.set('wireless', item.id, 'ssid', ssid || 'C526A-Guest');
			uci.set('wireless', item.id, 'encryption', 'psk2');
			uci.set('wireless', item.id, 'isolate', '1');
			uci.set('wireless', item.id, 'disabled', enable && bandOn ? '0' : '1');
			if (key)
				uci.set('wireless', item.id, 'key', key);
			else if (existingKey)
				uci.set('wireless', item.id, 'key', existingKey);
		});

		return uci.save().then(function() {
			return ui.changes.apply();
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, _('访客网络配置未能应用，请检查网络与防火墙日志。')), 'error');
			throw err;
		});
	},

	showError: function(message) {
		ui.addNotification(null, E('p', {}, message), 'error');
		return Promise.resolve();
	}
});
