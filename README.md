# 📊 TypeScript Prometheus Metrics Library

A lightweight, zero-dependency TypeScript library for creating and exposing Prometheus metrics.

Supports:
- ✅ Counter
- ✅ Gauge
- ✅ Histogram
- ✅ Summary
- ✅ Untyped

Exports metrics in standard Prometheus exposition format.

---

## 🚀 Installation

```bash
npm install @sourceregistry/node-prometheus
```

No external dependencies — pure TypeScript.

---

## 🧩 Usage Examples

### Counter

```ts
import { Counter } from './metrics';

let requestCount = 0;

const counter = new Counter({
  name: 'http_requests_total',
  description: 'Total number of HTTP requests',
  reader: () => [requestCount]
});

// Later...
requestCount++;
```

### Gauge

```ts
import { Gauge } from './metrics';

const gauge = new Gauge({
  name: 'current_temperature_celsius',
  description: 'Current temperature in Celsius',
  reader: () => [getTemperature()] // e.g., 23.5
});
```

### Histogram

```ts
import { Histogram } from './metrics';

const histogram = new Histogram({
  name: 'response_time_seconds',
  description: 'HTTP response time in seconds',
  buckets: [0.1, 0.5, 1, 2.5, 5]
});

histogram.observe(0.73); // Automatically updates buckets, sum, count
```

### Summary

```ts
import { Summary } from './metrics';

const summary = new Summary({
  name: 'request_duration_seconds',
  description: 'Request duration with quantiles',
  quantiles: [0.5, 0.9, 0.99],
  calculate: (value, quantile) => {
    // Simple example: weighted moving average
    const current = summary.getQuantile(quantile) || 0;
    return current * 0.9 + value * 0.1;
  }
});

summary.observe(1.2);
```

### Untyped

```ts
import { Untyped } from './metrics';

const untyped = new Untyped({
  name: 'some_legacy_metric',
  value: 42
});

untyped.set(43);
```

### Combine Multiple Metrics

```ts
import { Metric } from './metrics';

const output = await Metric.concat(counter, gauge, histogram, summary, untyped);
console.log(output);
```

---

## 📏 Prometheus Exposition Format

All `.stringify()` methods return strings compatible with Prometheus text format:

```
# HELP http_requests_total Total number of HTTP requests
# TYPE http_requests_total counter
http_requests_total 1234 1712345678901

# HELP response_time_seconds HTTP response time in seconds
# TYPE response_time_seconds histogram
response_time_seconds_bucket{le="0.1"} 5
response_time_seconds_bucket{le="0.5"} 23
response_time_seconds_bucket{le="1"} 45
response_time_seconds_bucket{le="2.5"} 89
response_time_seconds_bucket{le="+Inf"} 100
response_time_seconds_sum 120.5
response_time_seconds_count 100
```

---

## 🛠️ Features

- ✅ **Type-safe** — Full TypeScript support.
- ✅ **Async/Sync Readers** — Gauge/Counter support both.
- ✅ **Label Support** — Per-metric and per-sample labels.
- ✅ **Timestamps** — Optional sample timestamps.
- ✅ **Validation** — Input sanitization and error handling.
- ✅ **Extensible** — Easy to extend or override behavior.

---

## 🧪 Testing

No tests included — consider adding Jest/Mocha tests for:

- Metric serialization
- Label formatting
- Bucket/quantile calculations
- Error cases

---

## 👾 Examples

Look at the examples folder in this repository.

## 📜 License

Apache 2.0

---

## 🤝 Contributing

PRs welcome! Please ensure:

- Code matches existing style
- JSDoc is complete
- No external dependencies added

---
> **Note**: This library generates exposition format only. You must expose it via HTTP (e.g., Express, Koa, Fastify) for Prometheus to scrape.
