'use strict';
'require baseclass';
'require dom';
'require poll';
'require rpc';

var callTemperatureData = rpc.declare({
	object: 'luci.c526a_temp',
	method: 'getData'
});

return baseclass.extend({
	title: _('无线温度'),
	rootNode: null,
	pollFn: null,

	load: function() {
		return L.resolveDefault(callTemperatureData(), { available: false, sensors: [] });
	},

	render: function(data) {
		this.rootNode = E('div', { 'class': 'cbi-section-node' });
		this.updateView(data);
		this.pollFn = L.bind(function() {
			return L.resolveDefault(callTemperatureData(), null).then(L.bind(function(next) {
				if (next)
					this.updateView(next);
			}, this));
		}, this);
		poll.add(this.pollFn, 10);
		return this.rootNode;
	},

	updateView: function(data) {
		var rows = [];
		if (data && data.available && Array.isArray(data.sensors) && data.sensors.length) {
			rows.push(E('div', {
				'style': 'display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px'
			}, data.sensors.map(function(sensor) {
				return E('div', {
					'style': 'padding:12px;border-radius:6px;background:var(--background-color-high);min-width:0'
				}, [
					E('div', { 'style': 'opacity:.8;margin-bottom:4px' }, sensor.name || _('无线模块')),
					E('div', { 'style': 'font-size:1.5em;font-weight:600;overflow-wrap:anywhere' },
						String(sensor.temp_c) + ' °C')
				]);
			})));
		}
		else {
			rows.push(E('p', { 'class': 'alert-message warning' },
				_('未检测到可用的无线温度传感器。请检查 MT7615 驱动和 /sys/class/hwmon。')));
		}
		rows.push(E('div', { 'style': 'text-align:right;margin-top:8px;font-size:90%;opacity:.65' },
			_('每 10 秒刷新；此区域只显示温度，不提供预警阈值。')));
		dom.content(this.rootNode, rows);
	}
});
