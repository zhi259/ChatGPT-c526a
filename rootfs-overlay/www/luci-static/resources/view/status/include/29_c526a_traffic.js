'use strict';
'require baseclass';
'require dom';
'require poll';
'require rpc';

var callTrafficData = rpc.declare({
	object: 'luci.c526a_traffic',
	method: 'getData'
});

function formatRate(value) {
	if (!isFinite(value) || value < 0)
		value = 0;
	if (value < 1024)
		return Math.round(value) + ' B/s';
	if (value < 1024 * 1024)
		return (value / 1024).toFixed(1) + ' KiB/s';
	if (value < 1024 * 1024 * 1024)
		return (value / (1024 * 1024)).toFixed(2) + ' MiB/s';
	return (value / (1024 * 1024 * 1024)).toFixed(2) + ' GiB/s';
}

return baseclass.extend({
	title: _('实时网络速率（WAN）'),
	rootNode: null,
	pollFn: null,
	lastSample: null,
	downRate: 0,
	upRate: 0,
	loaded: false,

	load: function() {
		if (this.loaded)
			return Promise.resolve(null);

		this.loaded = true;
		return L.resolveDefault(callTrafficData(), null);
	},

	render: function(data) {
		if (!this.rootNode) {
			this.rootNode = E('div', { 'class': 'cbi-section-node' });
			this.updateView(data);
			this.startPoll();
		}
		return this.rootNode;
	},

	startPoll: function() {
		if (this.pollFn)
			poll.remove(this.pollFn);

		this.pollFn = L.bind(function() {
			return L.resolveDefault(callTrafficData(), null)
				.then(L.bind(this.updateView, this));
		}, this);

		poll.add(this.pollFn, 2);
	},

	updateView: function(data) {
		var now = Date.now();
		if (data && data.available && data.device &&
		    isFinite(Number(data.rx_bytes)) && isFinite(Number(data.tx_bytes))) {
			var current = {
				device: String(data.device),
				rx: Number(data.rx_bytes),
				tx: Number(data.tx_bytes),
				time: now
			};

			if (this.lastSample && this.lastSample.device === current.device) {
				var elapsed = (current.time - this.lastSample.time) / 1000;
				if (elapsed > 0 && elapsed < 30) {
					var rxDelta = current.rx - this.lastSample.rx;
					var txDelta = current.tx - this.lastSample.tx;
					this.downRate = rxDelta >= 0 ? rxDelta / elapsed : 0;
					this.upRate = txDelta >= 0 ? txDelta / elapsed : 0;
				}
				else {
					this.downRate = 0;
					this.upRate = 0;
				}
			}
			else {
				this.downRate = 0;
				this.upRate = 0;
			}

			this.lastSample = current;
		}
		else {
			this.lastSample = null;
			this.downRate = 0;
			this.upRate = 0;
		}

		var rows = [];
		rows.push(E('div', {
			'style': 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px'
		}, [
			E('div', { 'style': 'padding:12px;border-radius:6px;background:rgba(80,160,220,.10);min-width:0' }, [
				E('div', { 'style': 'opacity:.8;margin-bottom:4px' }, _('下载速度')),
				E('div', { 'style': 'font-size:1.5em;font-weight:600;overflow-wrap:anywhere' }, formatRate(this.downRate))
			]),
			E('div', { 'style': 'padding:12px;border-radius:6px;background:rgba(80,190,130,.10);min-width:0' }, [
				E('div', { 'style': 'opacity:.8;margin-bottom:4px' }, _('上传速度')),
				E('div', { 'style': 'font-size:1.5em;font-weight:600;overflow-wrap:anywhere' }, formatRate(this.upRate))
			])
		]));

		var note = (this.lastSample)
			? _('统计接口：%s · 每 2 秒刷新').format(this.lastSample.device)
			: _('暂时无法读取 WAN 统计数据；请检查 WAN 接口状态。');
		rows.push(E('div', { 'style': 'text-align:right;margin-top:8px;font-size:90%;opacity:.65' }, note));
		dom.content(this.rootNode, rows);
	}
});
