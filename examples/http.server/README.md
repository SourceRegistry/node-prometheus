## 🌐 Example: HTTP Server for Prometheus Scraping

You can expose your metrics over HTTP so Prometheus can scrape them. Here’s a minimal example using Node.js `http`:

### ▶️ Run It

```bash
npm run examples::http.server
```

Then visit [http://localhost:8080](http://localhost:8080) to see raw metrics.

### 🧭 Prometheus Config Snippet

To scrape this in Prometheus, add to `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'node-metrics'
    static_configs:
      - targets: ['localhost:8080']
```

---

## 📊 Sample Output

```
# HELP random_gauge Random gauge value updated on each scrape
# TYPE random_gauge gauge
random_gauge 42.17 1712345678901

# HELP random_histogram Histogram of random values
# TYPE random_histogram histogram
random_histogram_bucket{le="0.1"} 3
random_histogram_bucket{le="0.2"} 7
random_histogram_bucket{le="0.5"} 15
random_histogram_bucket{le="1"} 20
random_histogram_bucket{le="+Inf"} 20
random_histogram_sum 12.34
random_histogram_count 20

# HELP http_requests_total Total HTTP requests handled
# TYPE http_requests_total counter
http_requests_total{method="GET",endpoint="/metrics"} 5 1712345678901

# HELP uptime_seconds Server uptime in seconds
uptime_seconds 124.3 1712345678901
```
