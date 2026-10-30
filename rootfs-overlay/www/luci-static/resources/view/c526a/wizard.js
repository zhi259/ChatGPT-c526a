'use strict';
'require view';
'require uci';
'require ui';

function getValue(id) {
	var el = document.getElementById(id);
	return el ? String(el.value || '').trim() : '';
}

function isChecked(id) {
	var el = document.getElementById(id);
	return !!(el && el.checked);
}

function field(id, label, value, type, placeholder) {
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

function section(title, description, children) {
	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, title),
		description ? E('p', { 'class': 'cbi-section-descr' }, description) : null,
		E('div', { 'class': 'cbi-section-node' }, children)
	]);
}

function setVisible(id, visible) {
	var el = document.getElementById(id);
	if (el)
		el.style.display = visible ? '' : 'none';
}

function validIPv4(value) {
	var parts = value.split('.');
	if (parts.length !== 4)
		return false;
	for (var i = 0; i < 4; i++) {
		if (!/^\d{1,3}$/.test(parts[i]) || Number(parts[i]) > 255)
			return false;
	}
	return true;
}

function validLanIPv4(value) {
	if (!validIPv4(value))
		return false;
	var parts = value.split('.').map(Number);
	return parts[0] !== 0 && parts[0] !== 127 && parts[0] < 224 && parts[3] !== 0 && parts[3] !== 255;
}

function noControlChars(value) {
	return !/[\u0000-\u001f\u007f]/.test(value);
}

return view.extend({
	load: function() {
		return Promise.all([ uci.load('network'), uci.load('wireless') ]);
	},

	render: function() {
		var wanProto = uci.get('network', 'wan', 'proto') || 'dhcp';
		if ([ 'dhcp', 'pppoe', 'static' ].indexOf(wanProto) < 0)
			wanProto = 'dhcp';

		var wanSelect = E('select', {
			'id': 'c526a_wan_proto',
			'class': 'cbi-input-select',
			'change': function(ev) {
				var mode = ev.target.value;
				setVisible('c526a_pppoe_fields', mode === 'pppoe');
				setVisible('c526a_static_fields', mode === 'static');
			}
		}, [
			E('option', { 'value': 'dhcp', 'selected': wanProto === 'dhcp' }, _('自动获取 IP（DHCP）')),
			E('option', { 'value': 'pppoe', 'selected': wanProto === 'pppoe' }, _('宽带拨号（PPPoE）')),
			E('option', { 'value': 'static', 'selected': wanProto === 'static' }, _('手动填写静态 IP'))
		]);

		var wanDns = uci.get('network', 'wan', 'dns') || [];
		if (!Array.isArray(wanDns))
			wanDns = [ wanDns ];

		var radios2gOn = uci.get('wireless', 'radio0', 'disabled') !== '1';
		var radio1On = uci.get('wireless', 'radio1', 'disabled') !== '1';
		var radio2On = uci.get('wireless', 'radio2', 'disabled') !== '1';

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('快速网络设置向导')),
			E('p', {}, _('按照步骤设置上网方式、路由器管理地址和无线网络。提交后会保存并应用配置。')),
			E('div', { 'class': 'alert-message warning' }, [
				E('p', {}, _('注意：修改 LAN 地址会使当前管理页面断开，请稍后改用新地址登录。PPPoE 需要宽带运营商提供的账号和密码；无线密码至少 8 位。'))
			]),

			section(_('第 1 步：设置上网方式'), _('WAN 端口和交换机映射保持当前 C526A 固件设置不变。'), [
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title', 'for': 'c526a_wan_proto' }, _('上网方式')),
					E('div', { 'class': 'cbi-value-field' }, [ wanSelect ])
				]),
				E('div', { 'id': 'c526a_pppoe_fields', 'style': wanProto === 'pppoe' ? '' : 'display:none' }, [
					field('c526a_pppoe_user', _('宽带账号'), uci.get('network', 'wan', 'username') || '', 'text', _('输入运营商提供的账号')),
					field('c526a_pppoe_pass', _('宽带密码'), '', 'password', _('输入运营商提供的密码；不会回显旧密码'))
				]),
				E('div', { 'id': 'c526a_static_fields', 'style': wanProto === 'static' ? '' : 'display:none' }, [
					field('c526a_wan_ip', _('WAN IP 地址'), uci.get('network', 'wan', 'ipaddr') || '', 'text', '例如 203.0.113.10'),
					field('c526a_wan_mask', _('子网掩码'), uci.get('network', 'wan', 'netmask') || '255.255.255.0', 'text', '255.255.255.0'),
					field('c526a_wan_gateway', _('默认网关'), uci.get('network', 'wan', 'gateway') || '', 'text', '例如 203.0.113.1'),
					field('c526a_wan_dns', _('DNS 服务器'), wanDns.join(' ') || '1.1.1.1 8.8.8.8', 'text', _('至少填写一个 IPv4 DNS；多个地址以空格或逗号分隔'))
				])
			]),

			section(_('第 2 步：设置路由器管理地址'), _('默认管理地址为 192.168.5.1。请确认它与上级路由器的网段不冲突。'), [
				field('c526a_lan_ip', _('路由器 LAN 地址'), uci.get('network', 'lan', 'ipaddr') || '192.168.5.1', 'text', '192.168.5.1')
			]),

			section(_('第 3 步：设置 Wi-Fi'), _('建议给 2.4 GHz 和 5 GHz 使用不同的名称，方便识别；两个 5 GHz 无线模块可以使用相同名称和密码。此向导不修改信道和发射功率。'), [
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title', 'for': 'c526a_wifi_2g' }, _('2.4 GHz 无线网络')),
					E('div', { 'class': 'cbi-value-field' }, [
						E('input', { 'id': 'c526a_wifi_2g', 'type': 'checkbox', 'checked': radios2gOn }),
						' ', _('启用 2.4 GHz')
					])
				]),
				field('c526a_ssid_2g', _('2.4 GHz Wi-Fi 名称'), uci.get('wireless', 'default_radio0', 'ssid') || 'C526A-2.4G', 'text', _('最多 32 个字符')),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title', 'for': 'c526a_wifi_5g' }, _('5 GHz 无线网络')),
					E('div', { 'class': 'cbi-value-field' }, [
						E('input', { 'id': 'c526a_wifi_5g', 'type': 'checkbox', 'checked': radio1On || radio2On }),
						' ', _('启用两颗 5 GHz 无线模块')
					])
				]),
				field('c526a_ssid_5g', _('5 GHz Wi-Fi 名称'), uci.get('wireless', 'default_radio1', 'ssid') || uci.get('wireless', 'default_radio2', 'ssid') || 'C526A-5G', 'text', _('最多 32 个字符；两个 5 GHz 模块会使用同一名称')),
				field('c526a_wifi_key', _('Wi-Fi 密码（所有启用的频段共用）'), '', 'password', _('至少 8 位 ASCII 字符；设置向导不会读取或显示已有密码'))
			]),

			section(_('第 4 步：应用设置'), _('点击按钮后将修改 network 和 wireless 配置。请先确认上网账号、静态地址和 Wi-Fi 密码填写正确。'), [
				E('button', {
					'class': 'cbi-button cbi-button-action important',
					'click': ui.createHandlerFn(this, 'applyWizard')
				}, _('保存并应用全部设置'))
			])
		]);
	},

	applyWizard: function() {
		var wanMode = getValue('c526a_wan_proto');
		var lanIP = getValue('c526a_lan_ip');
		var enabled2g = isChecked('c526a_wifi_2g');
		var enabled5g = isChecked('c526a_wifi_5g');
		var ssid2g = getValue('c526a_ssid_2g');
		var ssid5g = getValue('c526a_ssid_5g');
		var wifiKey = getValue('c526a_wifi_key');

		if (!validLanIPv4(lanIP))
			return this.showError(_('LAN 地址不是有效的 IPv4 主机地址。'));

		if ([ 'dhcp', 'pppoe', 'static' ].indexOf(wanMode) < 0)
			return this.showError(_('请选择有效的上网方式。'));

		if (wanMode === 'pppoe' && (!getValue('c526a_pppoe_user') || !getValue('c526a_pppoe_pass')))
			return this.showError(_('PPPoE 宽带账号和密码不能为空。'));

		if (wanMode === 'static') {
			var ip = getValue('c526a_wan_ip');
			var mask = getValue('c526a_wan_mask');
			var gateway = getValue('c526a_wan_gateway');
			var dnsText = getValue('c526a_wan_dns');
			if (!validIPv4(ip) || !validIPv4(mask) || !validIPv4(gateway))
				return this.showError(_('静态 WAN IP、子网掩码和网关都必须是有效的 IPv4 地址。'));
			if (!dnsText || dnsText.split(/[\s,]+/).some(function(v) { return !validIPv4(v); }))
				return this.showError(_('请至少填写一个有效的 IPv4 DNS 服务器，多个地址用空格或逗号分隔。'));
		}

		if (enabled2g && (!ssid2g || ssid2g.length > 32 || !noControlChars(ssid2g)))
			return this.showError(_('2.4 GHz Wi-Fi 名称不能为空，最多 32 个字符，且不能包含控制字符。'));
		if (enabled5g && (!ssid5g || ssid5g.length > 32 || !noControlChars(ssid5g)))
			return this.showError(_('5 GHz Wi-Fi 名称不能为空，最多 32 个字符，且不能包含控制字符。'));
		if (!enabled2g && !enabled5g)
			return this.showError(_('至少需要启用一个无线频段。'));
		if (!/^[\x20-\x7e]{8,63}$/.test(wifiKey))
			return this.showError(_('Wi-Fi 密码必须为 8 至 63 位可打印 ASCII 字符。'));

		if (!window.confirm(_('即将保存上网、LAN 和 Wi-Fi 设置。修改 LAN 地址后，当前页面会断开；请改用新的管理地址登录。确定继续吗？')))
			return Promise.resolve();

		uci.set('network', 'lan', 'ipaddr', lanIP);
		uci.set('network', 'lan', 'netmask', '255.255.255.0');

		uci.set('network', 'wan', 'proto', wanMode);
		if (wanMode === 'dhcp') {
			uci.set('network', 'wan', 'peerdns', '1');
			[ 'ipaddr', 'netmask', 'gateway', 'dns', 'username', 'password' ].forEach(function(option) {
				uci.unset('network', 'wan', option);
			});
		}
		else if (wanMode === 'pppoe') {
			uci.set('network', 'wan', 'peerdns', '1');
			uci.set('network', 'wan', 'username', getValue('c526a_pppoe_user'));
			uci.set('network', 'wan', 'password', getValue('c526a_pppoe_pass'));
			[ 'ipaddr', 'netmask', 'gateway', 'dns' ].forEach(function(option) {
				uci.unset('network', 'wan', option);
			});
		}
		else {
			uci.set('network', 'wan', 'ipaddr', getValue('c526a_wan_ip'));
			uci.set('network', 'wan', 'netmask', getValue('c526a_wan_mask'));
			uci.set('network', 'wan', 'gateway', getValue('c526a_wan_gateway'));
			var dnsServers = getValue('c526a_wan_dns').split(/[\s,]+/).filter(Boolean);
			if (dnsServers.length)
				uci.set('network', 'wan', 'dns', dnsServers);
			else
				uci.unset('network', 'wan', 'dns');
			uci.set('network', 'wan', 'peerdns', '0');
		}

		uci.set('wireless', 'radio0', 'disabled', enabled2g ? '0' : '1');
		uci.set('wireless', 'radio1', 'disabled', enabled5g ? '0' : '1');
		uci.set('wireless', 'radio2', 'disabled', enabled5g ? '0' : '1');

		if (enabled2g) {
			uci.set('wireless', 'default_radio0', 'ssid', ssid2g);
			uci.set('wireless', 'default_radio0', 'encryption', 'psk2');
			uci.set('wireless', 'default_radio0', 'key', wifiKey);
		}
		if (enabled5g) {
			[ 'default_radio1', 'default_radio2' ].forEach(function(section) {
				uci.set('wireless', section, 'ssid', ssid5g);
				uci.set('wireless', section, 'encryption', 'psk2');
				uci.set('wireless', section, 'key', wifiKey);
			});
		}

		return uci.save().then(function() {
			return ui.changes.apply();
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, _('配置未能成功应用，请查看系统日志并确认 WAN 和无线配置。')));
			throw err;
		});
	},

	showError: function(message) {
		ui.addNotification(null, E('p', {}, message), 'error');
		return Promise.resolve();
	}
});
