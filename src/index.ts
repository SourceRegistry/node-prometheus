/**
 * Supported Prometheus metric types.
 */
export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary' | 'untyped';

/**
 * Represents a value that may be synchronous or asynchronous.
 */
export type MaybePromise<T> = Promise<T> | T;

/**
 * Input formats accepted by value reader functions.
 */
type ValueReaderResult =
    | number
    | [number, number] // [value, timestamp]
    | [number, Record<string, string>] // [value, labels]
    | [number, Record<string, string>, number]; // [value, labels, timestamp]

/**
 * Internal normalized representation of a metric value with labels and timestamp.
 */
type NormalizedValue = [value: number, labels: Record<string, string>, timestamp: number];

/**
 * Base class for all Prometheus metrics.
 * Handles common functionality like HELP/TYPE comments and label formatting.
 *
 * @template T - The metric type (e.g., 'gauge', 'counter').
 */
export abstract class Metric<T extends MetricType> {
    /**
     * The sanitized metric name.
     */
    public readonly name: string;

    /**
     * Optional metric description (used in # HELP).
     */
    public readonly description?: string;

    /**
     * Default labels applied to all samples of this metric.
     */
    public readonly labels?: Record<string, string>;

    /**
     * Creates a new Metric instance.
     *
     * @param type - The Prometheus metric type.
     * @param name - The raw metric name (will be cleaned).
     * @param description - Optional description for # HELP.
     * @param labels - Optional default labels.
     */
    protected constructor(
        public readonly type: T,
        name?: string,
        description?: string,
        labels?: Record<string, string>
    ) {
        this.name = Metric.cleanText(name) || '';
        this.description = description;
        this.labels = labels;
    }

    /**
     * Converts a label object to a Prometheus label string (e.g., `{foo="bar"}`).
     *
     * @param labels - The label key-value pairs.
     * @returns The formatted label string.
     */
    static labelString(labels?: Record<string, string | number>): string {
        if (!labels || Object.keys(labels).length === 0) return '';
        return `{${Object.entries(labels)
            .map(([key, value]) => `${key}="${String(value)}"`)
            .join(',')}}`;
    }

    /**
     * Sanitizes a metric name by removing or replacing invalid characters.
     *
     * Prometheus metric names must match [a-zA-Z_:][a-zA-Z0-9_:]*
     * This removes hyphens, parens; replaces slashes and spaces with underscores.
     *
     * @param input - The raw metric name.
     * @returns The cleaned metric name.
     */
    static cleanText(input?: string): string | undefined {
        return input
            ?.replaceAll('-', '')
            .replaceAll('/', '_')
            .replaceAll(' ', '_')
            .replaceAll('(', '')
            .replaceAll(')', '');
    }

    /**
     * Concatenates multiple metrics into a single exposition string.
     *
     * @param format - used to set the metric type
     * @param metrics - The metrics to serialize.
     * @returns A Promise resolving to the combined string.
     */
    static async concat(
        format: 'prometheus' | 'openmetrics' = 'prometheus',
        ...metrics: Metric<MetricType>[]
    ): Promise<string> {
        const results = await Promise.all(metrics.map((m) => m.stringify()));
        let output = results.join('\n');

        if (format === 'openmetrics') {
            output = output.trimEnd() + '\n# EOF'; // Ensure no trailing newline before # EOF
        }

        return output;
    }


    /**
     * Generates the common header lines (# HELP, # TYPE) for this metric.
     * Called by subclasses before serializing their specific values.
     *
     * @returns The header string.
     */
    protected generateHeader(): string {
        let ret = '';
        if (this.name && this.description) {
            ret += `# HELP ${this.name} ${this.description}\n`;
        }
        if (this.type !== 'untyped') {
            ret += `# TYPE ${this.name} ${this.type}\n`;
        }
        return ret;
    }

    /**
     * Serializes the metric to Prometheus exposition format.
     *
     * @returns A Promise resolving to the serialized string.
     */
    abstract stringify(): Promise<string>;
}

/**
 * Base class for metrics that read values asynchronously (Counter, Gauge).
 *
 * @template T - The metric type ('counter' or 'gauge').
 */
abstract class ValueMetric<T extends 'counter' | 'gauge'> extends Metric<T> {
    private readonly _reader: () => Promise<NormalizedValue[]>;

    /**
     * Creates a new ValueMetric.
     *
     * @param type - The metric type.
     * @param config - Configuration object.
     * @param config.name - Metric name.
     * @param config.description - Optional description.
     * @param config.labels - Optional default labels.
     * @param config.reader - Async or sync function returning values.
     */
    protected constructor(
        type: T,
        config: {
            name: string;
            description?: string;
            labels?: Record<string, string>;
            reader: () => MaybePromise<ValueReaderResult[]>;
        }
    ) {
        super(type, config.name, config.description, config.labels);
        this._reader = async (): Promise<NormalizedValue[]> => {
            const results = await config.reader();
            return results.map((value): NormalizedValue => {
                if (typeof value === 'number') {
                    return [value, {}, Date.now()];
                } else if (Array.isArray(value)) {
                    if (value.length === 2) {
                        if (typeof value[1] === 'number') {
                            return [value[0], {}, value[1]];
                        } else {
                            return [value[0], value[1], Date.now()];
                        }
                    } else {
                        return value as NormalizedValue; // length 3
                    }
                }
                throw new Error(`Unexpected value format: ${JSON.stringify(value)}`);
            });
        };
    }

    /**
     * Serializes the current values with labels and timestamps.
     *
     * @returns Promise resolving to value lines.
     */
    protected async valueString(): Promise<string> {
        const values = await this._reader();
        return values
            .map(
                ([val, valLabels, ts]) =>
                    `${this.name}${Metric.labelString({ ...this.labels, ...valLabels })} ${val} ${ts}\n`
            )
            .join('');
    }

    /**
     * @inheritdoc
     */
    async stringify(): Promise<string> {
        return `${super.generateHeader()}${await this.valueString()}\n`;
    }
}

/**
 * A Prometheus Gauge metric.
 * Represents a single numerical value that can arbitrarily go up and down.
 *
 * @example
 * const gauge = new Gauge({
 *   name: "temperature_celsius",
 *   description: "Current temperature in Celsius",
 *   reader: () => [23.5]
 * });
 */
export class Gauge extends ValueMetric<'gauge'> {
    /**
     * Creates a new Gauge.
     *
     * @param config - Configuration object.
     */
    constructor(config: {
        name: string;
        description?: string;
        labels?: Record<string, string>;
        reader: () => MaybePromise<ValueReaderResult[]>;
    }) {
        super('gauge', config);
    }
}

/**
 * A Prometheus Counter metric.
 * Represents a cumulative metric that only increases.
 *
 * @example
 * const counter = new Counter({
 *   name: "http_requests_total",
 *   description: "Total HTTP requests",
 *   reader: () => [1234]
 * });
 */
export class Counter extends ValueMetric<'counter'> {
    /**
     * Creates a new Counter.
     *
     * @param config - Configuration object.
     */
    constructor(config: {
        name: string;
        description?: string;
        labels?: Record<string, string>;
        reader: () => MaybePromise<ValueReaderResult[]>;
    }) {
        super('counter', config);
    }

    /**
     * Increments the counter by a given value (convenience alias).
     * Note: Since Counter uses a reader, this is just documentation — actual increment
     * must be handled in the reader function or external state.
     *
     * @param delta - Amount to increment by (default: 1).
     */
    inc(delta: number = 1): void {
        console.warn(
            `Counter.inc() called, but Counter uses reader function. Increment must be handled externally. Delta: ${delta}`
        );
    }
}

/**
 * A Prometheus Histogram metric.
 * Counts observations in configurable buckets and provides sum + count.
 *
 * @example
 * const hist = new Histogram({
 *   name: "response_time_seconds",
 *   description: "Response time in seconds",
 *   buckets: [0.1, 0.5, 1, 2, 5]
 * });
 * hist.observe(0.75);
 */
export class Histogram extends Metric<'histogram'> {
    private readonly _buckets: readonly number[];
    private _bucketCounts: Record<number, number> = {};
    private _sum: number = 0;
    private _count: number = 0;

    /**
     * Creates a new Histogram.
     *
     * @param config - Configuration object.
     * @param config.name - Metric name.
     * @param config.description - Optional description.
     * @param config.buckets - Optional bucket thresholds (default: []). +Inf always added.
     * @param config.labels - Optional default labels.
     */
    constructor(config: {
        name: string;
        description?: string;
        buckets?: number[];
        labels?: Record<string, string>;
    }) {
        super('histogram', config.name, config.description, config.labels);
        const buckets = (config.buckets ?? []).sort((a, b) => a - b);
        this._buckets = [...buckets, Infinity]; // Always include +Inf
        this.reset(); // Initialize counts
    }

    /**
     * Resets all bucket counts, sum, and total count to zero.
     */
    reset(): void {
        this._buckets.forEach((bucket) => (this._bucketCounts[bucket] = 0));
        this._sum = 0;
        this._count = 0;
    }

    /**
     * Observes a value, updating buckets, sum, and count.
     *
     * @param value - The observed value.
     */
    observe(value: number): void {
        if (typeof value !== 'number' || isNaN(value)) {
            throw new Error(`Invalid histogram value: ${value}`);
        }
        this.push(value);
    }

    /**
     * Alias for observe().
     *
     * @param value - The observed value.
     */
    push(value: number): void {
        this._sum += value;
        this._count++;
        for (const bucket of this._buckets) {
            if (value <= bucket) {
                this._bucketCounts[bucket]++;
            }
        }
    }

    /**
     * Serializes bucket, sum, and count lines.
     *
     * @returns The serialized string.
     */
    private bucketString(): string {
        const bucketStrings = this._buckets
            .map((bucket) => {
                const le = bucket === Infinity ? '+Inf' : bucket;
                return `${this.name}_bucket${Metric.labelString({ ...this.labels, le })} ${
                    this._bucketCounts[bucket]
                }`;
            })
            .join('\n');

        return `${bucketStrings}\n${this.name}_sum ${this._sum}\n${this.name}_count ${this._count}`;
    }

    /**
     * @inheritdoc
     */
    async stringify(): Promise<string> {
        return `${super.generateHeader()}${this.bucketString()}\n`;
    }
}

/**
 * A Prometheus Summary metric.
 * Tracks φ-quantiles, sum, and count. Quantiles are calculated via user-provided function.
 *
 * @example
 * const summary = new Summary({
 *   name: "request_duration_seconds",
 *   description: "Request duration in seconds",
 *   quantiles: [0.5, 0.9, 0.99],
 *   calculate: (value, quantile) => value * quantile // dummy algorithm
 * });
 * summary.observe(0.8);
 */
export class Summary extends Metric<'summary'> {
    private _quantiles: Map<number, number>; // quantile => estimated value
    private _sum: number = 0;
    private _count: number = 0;
    private readonly _calculate: (value: number, quantile: number) => number;

    /**
     * Creates a new Summary.
     *
     * @param config - Configuration object.
     * @param config.name - Metric name.
     * @param config.description - Optional description.
     * @param config.quantiles - Array of φ-quantiles (0 < φ < 1).
     * @param config.calculate - Function to calculate quantile estimate given value and φ.
     */
    constructor(config: {
        name: string;
        description?: string;
        quantiles: readonly number[];
        calculate: (value: number, quantile: number) => number;
    }) {
        super('summary', config.name, config.description);
        if (!config.quantiles.length) {
            throw new Error('Summary must have at least one quantile');
        }
        // Initialize quantiles with 0
        this._quantiles = new Map(config.quantiles.map((q) => [q, 0]));
        this._calculate = config.calculate;
    }

    /**
     * Observes a value, updating quantiles, sum, and count.
     *
     * @param value - The observed value.
     */
    observe(value: number): void {
        if (typeof value !== 'number' || isNaN(value)) {
            throw new Error(`Invalid summary value: ${value}`);
        }
        this.push(value);
    }

    /**
     * Alias for observe().
     *
     * @param value - The observed value.
     */
    push(value: number): void {
        this._sum += value;
        this._count++;

        // Update each quantile estimate using the provided algorithm
        this._quantiles.forEach((_, quantile) => {
            const newValue = this._calculate(value, quantile);
            this._quantiles.set(quantile, newValue);
        });
    }

    /**
     * Serializes quantile, sum, and count lines.
     *
     * @returns The serialized string.
     */
    private summaryString(): string {
        const quantileStrings = [...this._quantiles.entries()]
            .sort(([a], [b]) => a - b)
            .map(
                ([q, value]) =>
                    `${this.name}${Metric.labelString({ ...this.labels, quantile: q })} ${value}`
            )
            .join('\n');

        return `${quantileStrings}\n${this.name}_sum ${this._sum}\n${this.name}_count ${this._count}`;
    }

    /**
     * @inheritdoc
     */
    async stringify(): Promise<string> {
        return `${super.generateHeader()}${this.summaryString()}\n`;
    }
}

/**
 * A Prometheus Untyped metric.
 * Used when metric type is unknown. Behaves like a Gauge.
 *
 * @example
 * const metric = new Untyped({
 *   name: "some_unknown_metric",
 *   value: 42
 * });
 * metric.set(43);
 */
export class Untyped extends Metric<'untyped'> {
    private _value: [number, number]; // [value, timestamp]

    /**
     * Creates a new Untyped metric.
     *
     * @param config - Configuration object.
     * @param config.name - Metric name.
     * @param config.description - Optional description.
     * @param config.labels - Optional default labels.
     * @param config.value - Initial value or [value, timestamp] tuple.
     */
    constructor(config: {
        name: string;
        description?: string;
        labels?: Record<string, string>;
        value?: number | [number, number];
    }) {
        super('untyped', config.name, config.description, config.labels);
        this._value = Array.isArray(config.value)
            ? config.value
            : [config.value ?? 0, Date.now()];
    }

    /**
     * Sets the current value and timestamp.
     *
     * @param value - New value or [value, timestamp] tuple.
     */
    set(value: number | [number, number]): void {
        this._value = Array.isArray(value) ? value : [value, Date.now()];
    }

    /**
     * Gets the current value and timestamp.
     *
     * @returns [value, timestamp] tuple.
     */
    get(): [number, number] {
        return this._value;
    }

    /**
     * Serializes the current value.
     *
     * @returns The serialized string.
     */
    private valueString(): string {
        return `${this.name}${Metric.labelString(this.labels)} ${this._value[0]} ${
            this._value[1]
        }\n`;
    }

    /**
     * @inheritdoc
     */
    async stringify(): Promise<string> {
        return `${super.generateHeader()}${this.valueString()}\n`;
    }
}
