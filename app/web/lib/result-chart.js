import { el } from './render.js';

let library;

function loadLibrary() {
  library ||= new Promise((resolve, reject) => {
    const script = el('script', { src: '/vendor/echarts.min.js' });
    script.onload = () => globalThis.echarts ? resolve(globalThis.echarts) : reject();
    script.onerror = reject;
    document.head.append(script);
  });
  return library;
}

export function createResultChart(container) {
  let chart;
  let entries = [];
  let onSelect;
  let revision = 0;

  async function draw() {
    if (!entries.length || !container.clientWidth) return;
    const current = revision;
    try {
      const echarts = await loadLibrary();
      if (current !== revision || !container.clientWidth) return;
      if (!chart) {
        chart = echarts.init(container);
        chart.on('click', ({ dataIndex }) => {
          const entry = entries[dataIndex];
          if (entry) onSelect?.(entry);
        });
      }
      chart.resize();
      chart.setOption({
        animation: false,
        grid: { left: 106, right: 40, top: 6, bottom: 32 },
        xAxis: { type: 'value', minInterval: 1, axisLabel: { color: '#595959' }, splitLine: { lineStyle: { color: '#f0f0f0' } } },
        yAxis: { type: 'category', inverse: true, data: entries.map(({ label }) => label),
          axisLabel: { color: '#262626', width: 90, overflow: 'truncate' }, axisLine: { show: false }, axisTick: { show: false } },
        series: [{ type: 'bar', barMaxWidth: 22, label: { show: true, position: 'right', color: '#262626' },
          data: entries.map(({ value, color }) => ({ value, itemStyle: { color: color || '#1677ff', borderRadius: [0, 4, 4, 0] } })) }],
      });
    } catch {
      container.classList.add('chart-unavailable');
    }
  }

  const observer = new ResizeObserver(() => { void draw(); });
  observer.observe(container);
  return (nextEntries, select) => {
    entries = nextEntries;
    onSelect = select;
    revision++;
    container.style.height = `${Math.max(136, entries.length * 29 + 38)}px`;
    container.setAttribute('aria-label', entries.map(({ label, value }) => `${label} ${value} 条`).join('，'));
    if (!entries.length) chart?.clear();
    void draw();
  };
}
