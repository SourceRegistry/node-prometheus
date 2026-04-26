// metrics.test.ts
import {describe, it, expect, vi} from 'vitest';
import {
    Metric,
    Counter,
    Gauge,
    Histogram,
    Summary,
    Untyped,
} from '../src';

// Mock Date.now for consistent timestamps
const MOCK_NOW = 1712345678901;
vi.useFakeTimers();
vi.setSystemTime(MOCK_NOW);

function extractQuantileValue(output: string, metricName: string, quantile: number): number {
    const match = output.match(
        new RegExp(`${metricName}\\{[^}]*quantile="${quantile}"[^}]*\\} ([^\\s]+)`)
    );

    if (!match) {
        throw new Error(`Quantile ${quantile} not found in output: ${output}`);
    }

    return Number(match[1]);
}

describe('Metric Utilities', () => {
    it('cleanText sanitizes names correctly', () => {
        expect(Metric.cleanText('http-requests/total (prod)')).toBe('httprequests_total_prod');
        expect(Metric.cleanText('my metric')).toBe('my_metric');
        expect(Metric.cleanText('')).toBe('');
        expect(Metric.cleanText(undefined)).toBeUndefined();
    });

    it('labelString formats labels correctly', () => {
        expect(Metric.labelString({})).toBe('');
        expect(Metric.labelString({foo: 'bar'})).toBe('{foo="bar"}');
        expect(Metric.labelString({foo: 'bar', baz: 123})).toBe('{baz="123",foo="bar"}');
        expect(Metric.labelString(undefined)).toBe('');
    });

    it('escapes label values correctly', () => {
        expect(Metric.labelString({foo: 'bar"\\\n'})).toBe('{foo="bar\\"\\\\\\n"}');
    });

    it('rejects invalid metric names', () => {
        expect(() => new Counter({
            name: '123 bad metric',
            reader: () => [1],
        })).toThrow('Invalid metric name');
    });

    it('rejects invalid label names', () => {
        expect(() => Metric.labelString({'bad-label': 'x'})).toThrow('Invalid label name');
    });

    it('concat combines multiple metrics (prometheus output)', async () => {
        const counter = new Counter({
            name: 'test_counter',
            reader: () => [10],
        });

        const gauge = new Gauge({
            name: 'test_gauge',
            reader: () => [3.14],
        });

        const output = await Metric.concat('prometheus',counter, gauge);
        expect(output).toContain('# TYPE test_counter counter');
        expect(output).toContain('test_counter 10');
        expect(output).toContain('# TYPE test_gauge gauge');
        expect(output).toContain('test_gauge 3.14');
    });

    it('concat combines multiple metrics (openmetrics output)', async () => {
        const counter = new Counter({
            name: 'test_counter',
            reader: () => [10],
        });

        const gauge = new Gauge({
            name: 'test_gauge',
            reader: () => [3.14],
        });

        const output = await Metric.concat('openmetrics',counter, gauge);
        expect(output).toContain('# TYPE test_counter counter');
        expect(output).toContain('test_counter 10');
        expect(output).toContain('# TYPE test_gauge gauge');
        expect(output).toContain('test_gauge 3.14');
        expect(output).toContain('# EOF');
    });
});

describe('Counter', () => {
    it('serializes correctly with number value', async () => {
        const counter = new Counter({
            name: 'http_requests_total',
            description: 'Total HTTP requests',
            reader: () => [1234],
        });

        const output = await counter.stringify();
        expect(output).toContain('# HELP http_requests_total Total HTTP requests');
        expect(output).toContain('# TYPE http_requests_total counter');
        expect(output).toContain('http_requests_total 1234 ' + MOCK_NOW);
    });

    it('serializes with labels and timestamp', async () => {
        const counter = new Counter({
            name: 'errors_total',
            labels: {service: 'api'},
            reader: () => [[5, {code: '500'}, 1700000000000]],
        });

        const output = await counter.stringify();
        expect(output).toContain('errors_total{code="500",service="api"} 5 1700000000000');
    });

    it('handles mixed value formats', async () => {
        const counter = new Counter({
            name: 'mixed_values',
            reader: () => [
                10,
                [20, 1600000000000],
                [30, {region: 'us'}],
                [40, {region: 'eu'}, 1500000000000],
            ],
        });

        const output = await counter.stringify();
        expect(output).toContain('mixed_values 10 ' + MOCK_NOW);
        expect(output).toContain('mixed_values 20 1600000000000');
        expect(output).toContain('mixed_values{region="us"} 30 ' + MOCK_NOW);
        expect(output).toContain('mixed_values{region="eu"} 40 1500000000000');
    });

    it('rejects non-finite values', async () => {
        const counter = new Counter({
            name: 'bad_value',
            reader: () => [Infinity],
        });

        await expect(counter.stringify()).rejects.toThrow('Invalid value');
    });

    it('inc() logs warning (no-op)', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
        });
        const counter = new Counter({
            name: 'test',
            reader: () => [0],
        });

        counter.inc(5);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('Counter.inc() called, but Counter uses reader function')
        );

        warnSpy.mockRestore();
    });
});

describe('Gauge', () => {
    it('serializes current value', async () => {
        let value = 23.5;
        const gauge = new Gauge({
            name: 'temperature_celsius',
            description: 'Current temperature',
            reader: () => [value],
        });

        let output = await gauge.stringify();
        expect(output).toContain('temperature_celsius 23.5 ' + MOCK_NOW);

        value = 25.0;
        output = await gauge.stringify();
        expect(output).toContain('temperature_celsius 25 ' + MOCK_NOW);
    });

    it('supports dynamic labels', async () => {
        const gauge = new Gauge({
            name: 'disk_free_bytes',
            labels: {device: '/dev/sda1'},
            reader: () => [
                [1024, {mount: '/home'}],
                [2048, {mount: '/var'}],
            ],
        });

        const output = await gauge.stringify();
        expect(output).toContain('disk_free_bytes{device="/dev/sda1",mount="/home"} 1024');
        expect(output).toContain('disk_free_bytes{device="/dev/sda1",mount="/var"} 2048');
    });
});

describe('Histogram', () => {
    it('initializes buckets including +Inf', () => {
        const hist = new Histogram({
            name: 'response_time',
            buckets: [0.1, 0.5, 1],
        });

        const output = hist.stringify();
        expect(output).resolves.toContain('response_time_bucket{le="0.1"}');
        expect(output).resolves.toContain('response_time_bucket{le="0.5"}');
        expect(output).resolves.toContain('response_time_bucket{le="1"}');
        expect(output).resolves.toContain('response_time_bucket{le="+Inf"}');
    });

    it('observes values and updates buckets', async () => {
        const hist = new Histogram({
            name: 'latency',
            buckets: [10, 50, 100],
            labels: {service: 'api'},
        });

        hist.observe(30);
        hist.observe(80);
        hist.observe(120);

        const output = await hist.stringify();
        expect(output).toContain('latency_bucket{le="10",service="api"} 0');
        expect(output).toContain('latency_bucket{le="50",service="api"} 1'); // 30 <= 50
        expect(output).toContain('latency_bucket{le="100",service="api"} 2'); // 30,80 <= 100
        expect(output).toContain('latency_bucket{le="+Inf",service="api"} 3'); // all
        expect(output).toContain('latency_sum{service="api"} 230'); // 30+80+120
        expect(output).toContain('latency_count{service="api"} 3');
    });

    it('resets all counts', async () => {
        const hist = new Histogram({name: 'test', buckets: [1]});
        hist.observe(0.5);
        hist.reset();

        const output = await hist.stringify();
        expect(output).toContain('test_bucket{le="1"} 0');
        expect(output).toContain('test_bucket{le="+Inf"} 0');
        expect(output).toContain('test_sum 0');
        expect(output).toContain('test_count 0');
    });

    it('throws on invalid value', () => {
        const hist = new Histogram({name: 'test'});
        expect(() => hist.observe(NaN)).toThrow('Invalid histogram value');
        expect(() => hist.observe('string' as any)).toThrow('Invalid histogram value');
    });

    it('rejects invalid bucket definitions', () => {
        expect(() => new Histogram({name: 'test', buckets: [1, Number.POSITIVE_INFINITY]})).toThrow(
            'Invalid bucket'
        );
    });
});

describe('Summary', () => {
    it('initializes quantiles', () => {
        expect(() => new Summary({name: 'test', quantiles: []})).toThrow();
    });

    it('observes values and estimates targeted quantiles', async () => {
        const summary = new Summary({
            name: 'request_duration',
            labels: {service: 'api'},
            quantiles: [
                {quantile: 0.5, error: 0.05},
                {quantile: 0.9, error: 0.02},
            ],
        });

        const values = Array.from({length: 100}, (_, index) => index + 1);
        const insertionOrder = [...values.slice(50), ...values.slice(0, 50)];
        insertionOrder.forEach((value) => summary.observe(value));

        const output = await summary.stringify();
        const median = extractQuantileValue(output, 'request_duration', 0.5);
        const p90 = extractQuantileValue(output, 'request_duration', 0.9);

        expect(median).toBeGreaterThanOrEqual(45);
        expect(median).toBeLessThanOrEqual(55);
        expect(p90).toBeGreaterThanOrEqual(88);
        expect(p90).toBeLessThanOrEqual(92);
        expect(output).toContain('request_duration_sum{service="api"} 5050');
        expect(output).toContain('request_duration_count{service="api"} 100');
    });

    it('supports default errors for numeric quantiles', async () => {
        const summary = new Summary({
            name: 'latency',
            quantiles: [0.5],
            error: 0.1,
        });

        [1, 2, 3, 4, 5].forEach((value) => summary.observe(value));

        const output = await summary.stringify();
        const median = extractQuantileValue(output, 'latency', 0.5);
        expect(median).toBeGreaterThanOrEqual(2);
        expect(median).toBeLessThanOrEqual(4);
    });

    it('throws on invalid value', () => {
        const summary = new Summary({
            name: 'test',
            quantiles: [0.5],
        });
        expect(() => summary.observe(NaN)).toThrow('Invalid summary value');
    });

    it('rejects invalid quantiles', () => {
        expect(() =>
            new Summary({
                name: 'test',
                quantiles: [1.5],
            })
        ).toThrow('Invalid quantile');
    });

    it('rejects invalid quantile errors', () => {
        expect(() =>
            new Summary({
                name: 'test',
                quantiles: [{quantile: 0.5, error: 0}],
            })
        ).toThrow('Invalid quantile error');
    });
});

describe('Untyped', () => {
    it('initializes with default value', async () => {
        const untyped = new Untyped({name: 'unknown'});
        const output = await untyped.stringify();
        expect(output).toContain('# TYPE unknown untyped');
        expect(output).toContain('unknown 0 ' + MOCK_NOW);
    });

    it('sets and gets value', async () => {
        const untyped = new Untyped({name: 'flag'});
        untyped.set(1);
        expect(untyped.get()[0]).toBe(1);

        const output = await untyped.stringify();
        expect(output).toContain('flag 1');
    });

    it('accepts timestamp tuple', async () => {
        const untyped = new Untyped({name: 'legacy', value: [42, 1234567890]});
        const output = await untyped.stringify();
        expect(output).toContain('legacy 42 1234567890');
    });
});
