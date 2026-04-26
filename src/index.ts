/**
 * Supported Prometheus metric types.
 */
export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary' | 'untyped';

/**
 * Represents a value that may be synchronous or asynchronous.
 */
export type MaybePromise<T> = Promise<T> | T;

const METRIC_NAME_PATTERN = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const LABEL_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

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

export type SummaryQuantile = {
    quantile: number;
    error?: number;
};

type NormalizedSummaryQuantile = {
    quantile: number;
    error: number;
};

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
        if (!this.name) {
            throw new Error('Metric name is required.');
        }
        this.description = description;
        this.labels = labels ? Metric.normalizeLabels(labels) : undefined;
    }

    /**
     * Converts a label object to a Prometheus label string (e.g., `{foo="bar"}`).
     *
     * @param labels - The label key-value pairs.
     * @returns The formatted label string.
     */
    static labelString(labels?: Record<string, string | number>): string {
        if (!labels || Object.keys(labels).length === 0) return '';
        const normalized = Metric.normalizeLabels(labels);
        return `{${Object.entries(normalized)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, value]) => `${key}="${Metric.escapeLabelValue(value)}"`)
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
        const cleaned = input
            ?.replaceAll('-', '')
            .replaceAll('/', '_')
            .replaceAll(' ', '_')
            .replaceAll('(', '')
            .replaceAll(')', '');

        if (cleaned === undefined) {
            return undefined;
        }

        if (cleaned !== '' && !METRIC_NAME_PATTERN.test(cleaned)) {
            throw new Error(
                `Invalid metric name "${input}". Metric names must match ${METRIC_NAME_PATTERN.source}.`
            );
        }

        return cleaned;
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
            ret += `# HELP ${this.name} ${Metric.escapeHelpText(this.description)}\n`;
        }
        ret += `# TYPE ${this.name} ${this.type}\n`;
        return ret;
    }

    protected static normalizeNumber(value: number, context: string): number {
        if (!Number.isFinite(value)) {
            throw new Error(`Invalid ${context}: ${value}`);
        }
        return value;
    }

    protected static normalizeTimestamp(timestamp: number): number {
        if (!Number.isFinite(timestamp)) {
            throw new Error(`Invalid timestamp: ${timestamp}`);
        }
        return timestamp;
    }

    private static escapeHelpText(value: string): string {
        return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n');
    }

    private static escapeLabelValue(value: string): string {
        return value
            .replaceAll('\\', '\\\\')
            .replaceAll('\n', '\\n')
            .replaceAll('"', '\\"');
    }

    protected static normalizeLabels(
        labels: Record<string, string | number>
    ): Record<string, string> {
        const normalized: Record<string, string> = {};

        for (const [key, value] of Object.entries(labels)) {
            if (!LABEL_NAME_PATTERN.test(key)) {
                throw new Error(
                    `Invalid label name "${key}". Label names must match ${LABEL_NAME_PATTERN.source}.`
                );
            }

            normalized[key] = String(value);
        }

        return normalized;
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
                    return [Metric.normalizeNumber(value, `value for metric "${this.name}"`), {}, Date.now()];
                } else if (Array.isArray(value)) {
                    if (value.length === 2) {
                        if (typeof value[1] === 'number') {
                            return [
                                Metric.normalizeNumber(value[0], `value for metric "${this.name}"`),
                                {},
                                Metric.normalizeTimestamp(value[1]),
                            ];
                        } else {
                            return [
                                Metric.normalizeNumber(value[0], `value for metric "${this.name}"`),
                                Metric.normalizeLabels(value[1]),
                                Date.now(),
                            ];
                        }
                    } else {
                        return [
                            Metric.normalizeNumber(value[0], `value for metric "${this.name}"`),
                            Metric.normalizeLabels(value[1]),
                            Metric.normalizeTimestamp(value[2]),
                        ];
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
        const buckets = [...new Set(config.buckets ?? [])]
            .map((bucket) => Metric.normalizeNumber(bucket, `bucket for metric "${this.name}"`))
            .sort((a, b) => a - b);
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

        return `${bucketStrings}\n${this.name}_sum${Metric.labelString(this.labels)} ${this._sum}\n${this.name}_count${Metric.labelString(this.labels)} ${this._count}`;
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
 * Tracks quantiles, sum, and count using a streaming targeted-quantile sketch.
 *
 * @example
 * const summary = new Summary({
 *   name: "request_duration_seconds",
 *   description: "Request duration in seconds",
 *   quantiles: [
 *     { quantile: 0.5, error: 0.05 },
 *     { quantile: 0.9, error: 0.01 },
 *     { quantile: 0.99, error: 0.001 }
 *   ]
 * });
 * summary.observe(0.8);
 */
export class Summary extends Metric<'summary'> {
    private readonly _targets: readonly NormalizedSummaryQuantile[];
    private readonly _compressInterval: number;
    private _samples: Array<{ value: number; g: number; delta: number }> = [];
    private _sum: number = 0;
    private _count: number = 0;

    /**
     * Creates a new Summary.
     *
     * @param config - Configuration object.
     * @param config.name - Metric name.
     * @param config.description - Optional description.
     * @param config.quantiles - Quantiles to estimate, with optional per-quantile error bounds.
     * @param config.error - Default absolute rank error fraction for number-only quantiles.
     * @param config.compressInterval - Optional interval controlling compression frequency.
     */
    constructor(config: {
        name: string;
        description?: string;
        quantiles: readonly (number | SummaryQuantile)[];
        error?: number;
        compressInterval?: number;
        labels?: Record<string, string>;
    }) {
        super('summary', config.name, config.description, config.labels);
        if (!config.quantiles.length) {
            throw new Error('Summary must have at least one quantile');
        }
        this._targets = Summary.normalizeTargets(config.quantiles, config.error);
        this._compressInterval = Summary.normalizeCompressInterval(
            config.compressInterval,
            this._targets
        );
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
        const normalizedValue = Metric.normalizeNumber(
            value,
            `summary value for metric "${this.name}"`
        );
        this._sum += normalizedValue;
        this._count++;
        this.insertSample(normalizedValue);

        if (this._count % this._compressInterval === 0) {
            this.compress();
        }
    }

    /**
     * Serializes quantile, sum, and count lines.
     *
     * @returns The serialized string.
     */
    private summaryString(): string {
        const quantileStrings = this._targets
            .map(
                ({ quantile }) =>
                    `${this.name}${Metric.labelString({ ...this.labels, quantile })} ${this.query(quantile)}`
            )
            .join('\n');

        return `${quantileStrings}\n${this.name}_sum${Metric.labelString(this.labels)} ${this._sum}\n${this.name}_count${Metric.labelString(this.labels)} ${this._count}`;
    }

    /**
     * @inheritdoc
     */
    async stringify(): Promise<string> {
        return `${super.generateHeader()}${this.summaryString()}\n`;
    }

    private static normalizeTargets(
        quantiles: readonly (number | SummaryQuantile)[],
        defaultError: number | undefined
    ): readonly NormalizedSummaryQuantile[] {
        const fallbackError = defaultError ?? 0.01;
        if (!Number.isFinite(fallbackError) || fallbackError <= 0 || fallbackError >= 1) {
            throw new Error(`Invalid summary error: ${fallbackError}`);
        }

        const deduped = new Map<number, number>();

        for (const entry of quantiles) {
            const target =
                typeof entry === 'number'
                    ? { quantile: entry, error: fallbackError }
                    : { quantile: entry.quantile, error: entry.error ?? fallbackError };

            if (!Number.isFinite(target.quantile) || target.quantile <= 0 || target.quantile >= 1) {
                throw new Error(`Invalid quantile: ${target.quantile}`);
            }
            if (!Number.isFinite(target.error) || target.error <= 0 || target.error >= 1) {
                throw new Error(`Invalid quantile error for ${target.quantile}: ${target.error}`);
            }

            const previous = deduped.get(target.quantile);
            deduped.set(
                target.quantile,
                previous === undefined ? target.error : Math.min(previous, target.error)
            );
        }

        return [...deduped.entries()]
            .sort(([left], [right]) => left - right)
            .map(([quantile, error]) => ({ quantile, error }));
    }

    private static normalizeCompressInterval(
        interval: number | undefined,
        targets: readonly NormalizedSummaryQuantile[]
    ): number {
        if (interval !== undefined) {
            if (!Number.isInteger(interval) || interval <= 0) {
                throw new Error(`Invalid compress interval: ${interval}`);
            }
            return interval;
        }

        const minError = Math.min(...targets.map((target) => target.error));
        return Math.max(1, Math.floor(1 / (2 * minError)));
    }

    private insertSample(value: number): void {
        if (this._samples.length === 0) {
            this._samples.push({ value, g: 1, delta: 0 });
            return;
        }

        let insertionIndex = 0;
        let rankBefore = 0;

        while (
            insertionIndex < this._samples.length &&
            this._samples[insertionIndex].value <= value
        ) {
            rankBefore += this._samples[insertionIndex].g;
            insertionIndex++;
        }

        const isBoundary = insertionIndex === 0 || insertionIndex === this._samples.length;
        const delta = isBoundary
            ? 0
            : Math.max(0, Math.floor(this.allowableError(rankBefore, this._count - 1)) - 1);

        this._samples.splice(insertionIndex, 0, { value, g: 1, delta });
    }

    private compress(): void {
        if (this._samples.length < 3) {
            return;
        }

        const ranks = new Array<number>(this._samples.length);
        let rank = 0;
        for (let index = 0; index < this._samples.length; index++) {
            ranks[index] = rank;
            rank += this._samples[index].g;
        }

        for (let index = this._samples.length - 2; index >= 1; index--) {
            const current = this._samples[index];
            const next = this._samples[index + 1];
            const allowed = this.allowableError(ranks[index], this._count);

            if (current.g + next.g + next.delta <= allowed) {
                next.g += current.g;
                this._samples.splice(index, 1);
            }
        }
    }

    private allowableError(rank: number, count: number): number {
        if (count <= 0) {
            return 1;
        }

        let allowed = Number.POSITIVE_INFINITY;

        for (const target of this._targets) {
            const boundary = target.quantile * count;
            const candidate =
                rank <= boundary
                    ? (2 * target.error * (count - rank)) / (1 - target.quantile)
                    : (2 * target.error * rank) / target.quantile;
            allowed = Math.min(allowed, Math.floor(candidate));
        }

        return Math.max(1, allowed);
    }

    private query(quantile: number): number {
        if (this._samples.length === 0) {
            return 0;
        }
        if (this._samples.length === 1) {
            return this._samples[0].value;
        }

        const desiredRank = quantile * this._count;
        const threshold = desiredRank + this.allowableError(desiredRank, this._count) / 2;
        let rank = 0;

        for (let index = 0; index < this._samples.length; index++) {
            const sample = this._samples[index];
            if (rank + sample.g + sample.delta > threshold) {
                return this._samples[Math.max(0, index - 1)].value;
            }
            rank += sample.g;
        }

        return this._samples[this._samples.length - 1].value;
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
            ? [
                Metric.normalizeNumber(config.value[0], `value for metric "${this.name}"`),
                Metric.normalizeTimestamp(config.value[1]),
            ]
            : [Metric.normalizeNumber(config.value ?? 0, `value for metric "${this.name}"`), Date.now()];
    }

    /**
     * Sets the current value and timestamp.
     *
     * @param value - New value or [value, timestamp] tuple.
     */
    set(value: number | [number, number]): void {
        this._value = Array.isArray(value)
            ? [
                Metric.normalizeNumber(value[0], `value for metric "${this.name}"`),
                Metric.normalizeTimestamp(value[1]),
            ]
            : [Metric.normalizeNumber(value, `value for metric "${this.name}"`), Date.now()];
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
