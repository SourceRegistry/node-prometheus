# 📊 @sourceregistry/node-prometheus

> **A lightweight, zero-dependency TypeScript library for creating and exposing Prometheus & OpenMetrics-compatible metrics.**

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![npm version](https://img.shields.io/npm/v/@sourceregistry/node-prometheus.svg)](https://www.npmjs.com/package/@sourceregistry/node-prometheus)

Supports:
- ✅ Counter
- ✅ Gauge
- ✅ Histogram
- ✅ Summary
- ✅ Untyped

Exports metrics in **Prometheus exposition format** and **OpenMetrics v1.0.0** — ready for modern observability stacks.

---

## 🚀 Installation

```bash
npm install @sourceregistry/node-prometheus
```

> ✅ Zero external dependencies — pure TypeScript.

---

## 🧩 Usage Examples

### Counter

```ts
import { Counter } from '@sourceregistry/node-prometheus';

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
import { Gauge } from '@sourceregistry/node-prometheus';

const gauge = new Gauge({
  name: 'current_temperature_celsius',
  description: 'Current temperature in Celsius',
  reader: () => [getTemperature()] // e.g., returns 23.5
});
```

### Histogram

```ts
import { Histogram } from '@sourceregistry/node-prometheus';

const histogram = new Histogram({
  name: 'response_time_seconds',
  description: 'HTTP response time in seconds',
  buckets: [0.1, 0.5, 1, 2.5, 5]
});

histogram.observe(0.73); // Updates buckets, sum, and count
```

### Summary

```ts
import { Summary } from '@sourceregistry/node-prometheus';

const summary = new Summary({
  name: 'request_duration_seconds',
  description: 'Request duration with quantiles',
  quantiles: [0.5, 0.9, 0.99],
  calculate: (value, quantile) => {
    // Example: simple moving average
    const current = /* your state */ 0;
    return current * 0.9 + value * 0.1;
  }
});

summary.observe(1.2);
```

### Untyped

```ts
import { Untyped } from '@sourceregistry/node-prometheus';

const untyped = new Untyped({
  name: 'some_legacy_metric',
  value: 42
});

untyped.set(43);
```

### Combine Multiple Metrics (with Format Support)

Use `Metric.concat()` to serialize multiple metrics into a single string. You can specify `'prometheus'` (default) or `'openmetrics'` format.

```ts
import { Metric, Counter, Gauge } from '@sourceregistry/node-prometheus';

let requestCount = 0;

const counter = new Counter({
  name: 'http_requests_total',
  description: 'Total HTTP requests',
  reader: () => [requestCount]
});

const gauge = new Gauge({
  name: 'cpu_usage_percent',
  description: 'Current CPU usage',
  reader: () => [Math.random() * 100]
});

// Serialize in Prometheus format (default)
const promOutput = await Metric.concat('prometheus', counter, gauge);
console.log(promOutput);
// # HELP http_requests_total ...
// # TYPE http_requests_total counter
// http_requests_total 0 1712345678901
// ...

// Serialize in OpenMetrics format
const omOutput = await Metric.concat('openmetrics', counter, gauge);
console.log(omOutput);
// # HELP http_requests_total ...
// # TYPE http_requests_total counter
// http_requests_total 0 1712345678901
// ...
// # EOF
```

> ✅ In OpenMetrics mode, `# EOF` is automatically appended, and trailing whitespace is trimmed.

---

## 🌐 HTTP Server Example (Auto-negotiates Prometheus/OpenMetrics)

This example uses `Metric.concat(format, ...)` to serve the correct format based on the client’s `Accept` header.

```ts
// examples/server.ts
import { createServer } from 'http';
import { Counter, Gauge, Histogram, Metric, Untyped } from '@sourceregistry/node-prometheus';

const gauge = new Gauge({
  name: 'random_gauge',
  description: 'Random gauge value updated on each scrape',
  reader: () => [Math.random() * 100],
});

const histogram = new Histogram({
  name: 'random_histogram',
  description: 'Histogram of random values',
  buckets: [0.1, 0.2, 0.5, 1.0],
});

let hits = 0;

const counter = new Counter({
  name: 'http_requests_total',
  description: 'Total HTTP requests handled',
  reader: () => [[hits, { method: 'GET', endpoint: '/metrics' }]],
});

const untyped = new Untyped({
  name: 'uptime_seconds',
  description: 'Server uptime in seconds',
  value: [0, Date.now()],
});

// Simulate background metric updates
setInterval(() => {
  histogram.observe(Math.random());
  const uptime = (Date.now() - untyped.get()[1]) / 1000;
  untyped.set(uptime);
}, 2000);

// HTTP Server with OpenMetrics negotiation
createServer(async (req, res) => {
  console.log(`Scraped at ${new Date().toISOString()}`);
  hits++;

  const acceptHeader = req.headers['accept'] || '';
  const format = acceptHeader.includes('application/openmetrics-text') ? 'openmetrics' : 'prometheus';

  res.writeHead(200, {
    'Content-Type': format === 'openmetrics'
      ? 'application/openmetrics-text; version=1.0.0; charset=utf-8'
      : 'text/plain; version=0.0.4; charset=utf-8',
  });

  const output = await Metric.concat(format, gauge, histogram, counter, untyped);
  res.end(output);
}).listen(8080, '0.0.0.0', () => {
  console.log('✅ Metrics server: http://localhost:8080');
});
```

Run it:

```bash
npm run example::http.server
```

Then test:

```bash
curl -H "Accept: application/openmetrics-text" http://localhost:8080
curl http://localhost:8080  # defaults to Prometheus format
```

---

## 📏 Prometheus Exposition Format

Compatible with classic Prometheus scrapers:

```
# HELP http_requests_total Total number of HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",endpoint="/metrics"} 5 1712345678901

# HELP response_time_seconds HTTP response time in seconds
# TYPE response_time_seconds histogram
response_time_seconds_bucket{le="0.1"} 3
response_time_seconds_bucket{le="0.5"} 15
response_time_seconds_bucket{le="1"} 20
response_time_seconds_bucket{le="+Inf"} 20
response_time_seconds_sum 12.34
response_time_seconds_count 20
```

---

## 📐 OpenMetrics Format (Modern Standard)

When client sends `Accept: application/openmetrics-text`, server responds with:

```
# HELP random_gauge Random gauge value updated on each scrape
# TYPE random_gauge gauge
random_gauge 42.17 1712345678901

# HELP random_histogram Histogram of random values
# TYPE random_histogram histogram
random_histogram_bucket{le="0.1"} 3 1712345678901
random_histogram_bucket{le="0.2"} 7 1712345678901
random_histogram_bucket{le="0.5"} 15 1712345678901
random_histogram_bucket{le="1.0"} 20 1712345678901
random_histogram_bucket{le="+Inf"} 20 1712345678901
random_histogram_sum 12.34 1712345678901
random_histogram_count 20 1712345678901

# HELP http_requests_total Total HTTP requests handled
# TYPE http_requests_total counter
http_requests_total{method="GET",endpoint="/metrics"} 5 1712345678901

# HELP uptime_seconds Server uptime in seconds
# TYPE uptime_seconds untyped
uptime_seconds 124.3 1712345678901

# EOF
```

> ✅ Required: `+Inf` bucket, `# EOF`, correct `Content-Type`.

---

## 🛠️ Features

- ✅ **Type-safe** — Full TypeScript support with JSDoc.
- ✅ **Async/Sync Readers** — Gauge/Counter support both.
- ✅ **Label Support** — Per-metric and per-sample labels.
- ✅ **Timestamps** — Optional sample timestamps.
- ✅ **Validation** — Input sanitization and error handling.
- ✅ **Extensible** — Easy to extend or override behavior.
- ✅ **OpenMetrics Ready** — Auto-negotiation support in HTTP example.
- ✅ **Zero Dependencies** — Pure TypeScript, no bloat.

---

## 🧪 Testing

Comes with **Vitest-compatible tests** covering all metric types, serialization, edge cases, and error handling.

Run tests:

```bash
npm test          # Watch mode
npm run test:ui   # GUI
npm run test:coverage  # Coverage report
```

---

## 👾 Examples

See the [`examples/`](./examples) folder in this repository for:

- Basic metric usage
- HTTP server with Prometheus/OpenMetrics support
- Histogram/Summary simulations

---

## 📜 License

**Apache License 2.0** — See [LICENSE](./LICENSE) for details.

---

## 🤝 Contributing

PRs welcome! Please ensure:

- ✅ Code matches existing style and JSDoc standards
- ✅ Tests are added for new features
- ✅ No external dependencies added
- ✅ `npm run build` and `npm test` pass

---

> 💡 **Note**: This library generates exposition format only. You must expose it via HTTP (e.g., Express, Fastify, or plain `http`) for Prometheus to scrape. See the HTTP example above to get started quickly.
