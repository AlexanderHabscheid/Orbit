interface CounterMetric {
  type: "counter";
  values: Map<string, number>;
}

interface GaugeMetric {
  type: "gauge";
  values: Map<string, number>;
}

interface HistogramBucket {
  le: number;
  count: number;
}

interface HistogramSeries {
  buckets: HistogramBucket[];
  sum: number;
  count: number;
}

interface HistogramMetric {
  type: "histogram";
  values: Map<string, HistogramSeries>;
}

type Metric = CounterMetric | GaugeMetric | HistogramMetric;

type Labels = Record<string, string | number | boolean>;

const metrics = new Map<string, Metric>();

const defaultBucketsMs = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

function normalizeLabels(labels?: Labels): [string, string][] {
  if (!labels) return [];
  return Object.entries(labels)
    .map(([k, v]) => [k, String(v)] as [string, string])
    .sort((a, b) => a[0].localeCompare(b[0]));
}

function labelKey(labels?: Labels): string {
  return JSON.stringify(normalizeLabels(labels));
}

function renderLabelBlock(labelsKey: string): string {
  const labels = JSON.parse(labelsKey) as [string, string][];
  if (labels.length === 0) return "";
  const inner = labels.map(([k, v]) => `${k}="${v.replaceAll('"', '\\"')}"`).join(",");
  return `{${inner}}`;
}

function ensureCounter(name: string): CounterMetric {
  const existing = metrics.get(name);
  if (existing && existing.type === "counter") return existing;
  const created: CounterMetric = { type: "counter", values: new Map() };
  metrics.set(name, created);
  return created;
}

function ensureGauge(name: string): GaugeMetric {
  const existing = metrics.get(name);
  if (existing && existing.type === "gauge") return existing;
  const created: GaugeMetric = { type: "gauge", values: new Map() };
  metrics.set(name, created);
  return created;
}

function ensureHistogram(name: string): HistogramMetric {
  const existing = metrics.get(name);
  if (existing && existing.type === "histogram") return existing;
  const created: HistogramMetric = { type: "histogram", values: new Map() };
  metrics.set(name, created);
  return created;
}

export function incCounter(name: string, delta = 1, labels?: Labels): void {
  const metric = ensureCounter(name);
  const key = labelKey(labels);
  metric.values.set(key, (metric.values.get(key) ?? 0) + delta);
}

export function setGauge(name: string, value: number, labels?: Labels): void {
  const metric = ensureGauge(name);
  metric.values.set(labelKey(labels), value);
}

export function observeHistogram(name: string, value: number, labels?: Labels, buckets: number[] = defaultBucketsMs): void {
  const metric = ensureHistogram(name);
  const key = labelKey(labels);
  let series = metric.values.get(key);
  if (!series) {
    series = {
      buckets: buckets.map((le) => ({ le, count: 0 })),
      sum: 0,
      count: 0
    };
    metric.values.set(key, series);
  }
  series.sum += value;
  series.count += 1;
  for (const bucket of series.buckets) {
    if (value <= bucket.le) bucket.count += 1;
  }
}

export function renderPrometheusMetrics(): string {
  const rows: string[] = [];
  for (const [name, metric] of metrics.entries()) {
    rows.push(`# TYPE ${name} ${metric.type}`);
    if (metric.type === "counter" || metric.type === "gauge") {
      for (const [labels, value] of metric.values.entries()) {
        rows.push(`${name}${renderLabelBlock(labels)} ${value}`);
      }
      continue;
    }

    for (const [labels, series] of metric.values.entries()) {
      const parsed = JSON.parse(labels) as [string, string][];
      for (const bucket of series.buckets) {
        const bucketLabels = JSON.stringify([...parsed, ["le", String(bucket.le)]].sort((a, b) => a[0].localeCompare(b[0])));
        rows.push(`${name}_bucket${renderLabelBlock(bucketLabels)} ${bucket.count}`);
      }
      const infLabels = JSON.stringify([...parsed, ["le", "+Inf"]].sort((a, b) => a[0].localeCompare(b[0])));
      rows.push(`${name}_bucket${renderLabelBlock(infLabels)} ${series.count}`);
      rows.push(`${name}_sum${renderLabelBlock(labels)} ${series.sum}`);
      rows.push(`${name}_count${renderLabelBlock(labels)} ${series.count}`);
    }
  }
  return `${rows.join("\n")}\n`;
}
