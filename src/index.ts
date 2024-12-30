export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary' | 'untyped';

export class Metric<T extends MetricType> {

    private readonly _type: T;
    private readonly _name: string;
    private readonly _description: string;
    private readonly _labels: Record<string, string>;

    get labels(): Record<string, string> {
        return this._labels;
    }

    get name() {
        return this._name;
    }

    get description() {
        return this._description;
    }

    get type(): T {
        return this._type;
    }

    constructor(type: T, name?: string, description?: string, labels?: Record<string, string>) {
        this._type = type;
        this._name = Metric.CleanText(name);
        this._description = description;
        this._labels = labels;
    }

    static LabelString(labels?: Record<string, string>) {
        if (!labels || Object.keys(labels).length === 0) return '';
        return `{${Object.entries(labels).map(([key, value]) => `${key}="${value?.toString()}"`).join(',')}}`;
    }

    static CleanText(input: string) {
        return input.replaceAll("-", "").replaceAll("/", "_").replaceAll(" ", "_").replaceAll("(", "").replaceAll(")", "");
    }

    static Concat(...metrics: Metric<MetricType>[]) {
        return Promise.all(metrics.map((m) => m.stringify())).then((r) => r.join("\n"))
    }

    async stringify() {
        let ret = ''
        if (this.name && this.description) {
            ret += `# HELP ${this.name} ${this.description}\n`;
        }
        if (this.type !== 'untyped') {
            ret += `# TYPE ${this.name} ${this.type}\n`
        }
        return ret;
    }

}

export type MaybePromise<T> = Promise<T> | T

export class Gauge extends Metric<'gauge'> {

    private readonly _reader: () => MaybePromise<[number, Record<string, string>, number][]>;

    get values() {
        return this._reader();
    }

    constructor(config: {
        name: string,
        description?: string,
        labels?: Record<string, string>,
        reader: () => MaybePromise<(number | [number, number] | [number, Record<string, string>, number] | [number, Record<string, string>])[]>
    }) {
        super('gauge', config.name, config.description);
        this._reader = async (): Promise<[number, Record<string, string>, number][]> => {
            const ret = await config.reader();
            const values: [number, Record<string, string>, number][] = []
            for (let value of ret) {
                if (typeof value === "number") {
                    value = [value, {}, Date.now()]
                } else if (Array.isArray(value) && value.length === 2) {
                    if (typeof value[1] === "number") {
                        value = [value[0], {}, value[1]]
                    } else {
                        value = [value[0], value[1], Date.now()];
                    }
                }
                values.push(value as [number, Record<string, string>, number]);
            }
            return values;
        }
    }

    private async valueString() {
        let _values: [number, Record<string, string>, number][];
        const values = this._reader();
        if (values instanceof Promise) {
            _values = await values;
        }
        return _values.map((value) => `${this.name}${Metric.LabelString(Object.assign({}, value[1], super.labels))} ${value[0].toString()} ${value[2].toString()}\n`).join('');
    }

    async stringify() {
        return (
            await super.stringify() +
            await this.valueString() + "\n"
        )
    }

}

export class Histogram extends Metric<'histogram'> {
    private readonly _buckets: number[];
    private _bucketCounts: { [key: number]: number } = {};
    private _sum: number = 0;
    private _count: number = 0;

    constructor(config: {
        name: string,
        description?: string,
        buckets?: number[],
        labels?: Record<string, string>,
    }) {
        super('histogram', config.name, config.description);
        this._buckets = config.buckets ?? []
        this._buckets = this._buckets.sort((a, b) => a - b);
        this._buckets.push(Infinity);  // Always add a bucket for +Inf
        this._buckets.forEach(bucket => this._bucketCounts[bucket] = 0  /*Initialize counts for each bucket*/);
    }

    /**
     * Update the histogram with a new value.
     * This increments the bucket counts, sum, and total count.
     */
    push(value: number) {
        this._sum += value;
        this._count++;
        // Update the bucket counts
        for (const bucket of this._buckets) {
            if (value <= bucket) {
                this._bucketCounts[bucket]++;
            }
        }
    }

    reset(): void {
        this._buckets.forEach(bucket => this._bucketCounts[bucket] = 0  /*Initialize counts for each bucket*/);
    }

    /**
     * Generate the string for the histogram's buckets, sum, and count.
     */
    private bucketString() {
        const bucketStrings = Object.entries(this._bucketCounts)
            .map(([bucket, count]) => `${this.name}_bucket${Metric.LabelString(Object.assign({le: bucket === 'Infinity' ? '+Inf' : bucket}, super.labels))} ${count}`)
            .join('\n');
        const sumString = `${this.name}_sum ${this._sum}`;
        const countString = `${this.name}_count ${this._count}`;
        return `${bucketStrings}\n${sumString}\n${countString}`;
    }

    async stringify() {
        return (
            await super.stringify() +
            this.bucketString() + "\n"
        );
    }
}

export class Summary extends Metric<'summary'> {

    static Calculation = {
        random(value: number, quantile: number): number {
            if (Math.random() <= quantile) {
                return quantile;
            }
        }
    }

    private _quantiles: Map<number, number> = new Map();
    private _sum: number = 0;
    private _count: number = 0;
    private _calculate: any;

    constructor(config: {
        name: string,
        description?: string,
        quantiles: number[],
        calculate: (value: number, quantile: number) => keyof typeof config['quantiles'],
    }) {
        super('summary', config.name, config.description);
        // Initialize quantiles with their initial values
        config.quantiles.forEach(q => this._quantiles.set(q, 0));
        this._calculate = config.calculate;
    }

    /**
     * Update the summary with a new value.
     * This will update the sum, count, and approximate quantiles.
     */
    push(value: number) {
        this._sum += value;
        this._count++;
        this._quantiles.forEach(q => {
            this._quantiles.set(this._calculate(q, value), value)
        })
    }

    /**
     * Generate the string for the summary's quantiles, sum, and count.
     */
    private summaryString() {
        const quantileStrings = [...this._quantiles.entries()].sort(([a], [b]) => a - b)
            .map(([q, value]) => `${this.name}${Metric.LabelString(Object.assign({quantile: q}, super.labels))} ${value}`)
            .join('\n');

        const sumString = `${this.name}_sum ${this._sum}`;
        const countString = `${this.name}_count ${this._count}`;

        return `${quantileStrings}\n${sumString}\n${countString}`;
    }

    async stringify() {
        return (
            await super.stringify() +
            this.summaryString() + "\n"
        );
    }
}

export class Counter extends Metric<'counter'> {

    private readonly _reader: () => MaybePromise<[number, Record<string, string>, number][]>;

    get values() {
        return this._reader();
    }

    constructor(config: {
        name: string,
        description?: string,
        labels?: Record<string, string>,
        reader: () => MaybePromise<(number | [number, number] | [number, Record<string, string>, number] | [number, Record<string, string>])[]>
    }) {
        super('counter', config.name, config.description);
        this._reader = async (): Promise<[number, Record<string, string>, number][]> => {
            const ret = await config.reader();
            const values: [number, Record<string, string>, number][] = []
            for (let value of ret) {
                if (typeof value === "number") {
                    value = [value, {}, Date.now()]
                } else if (Array.isArray(value) && value.length === 2) {
                    if (typeof value[1] === "number") {
                        value = [value[0], {}, value[1]]
                    } else {
                        value = [value[0], value[1], Date.now()];
                    }
                }
                values.push(value as [number, Record<string, string>, number]);
            }
            return values;
        }
    }

    private async counterString() {
        let _values: [number, Record<string, string>, number][];
        const values = this._reader();
        if (values instanceof Promise) {
            _values = await values;
        }
        return _values.map((value) => `${this.name}${Metric.LabelString(Object.assign({}, value[1], super.labels))} ${value[0].toString()} ${value[2].toString()}\n`).join('');
    }

    async stringify() {
        return (
            await super.stringify() +
            await this.counterString() + "\n"
        )
    }
}

export class Untyped extends Metric<'untyped'> {
    private _value: [number, number];

    constructor(config: {
        name: string,
        description?: string,
        labels?: Record<string, string>,
        value?: [number, number] | number
    }) {
        super('untyped', config.name, config.description);
        this._value = Array.isArray(config.value) ? config.value : [0, Date.now()];
    }

    set(value: number | [number, number]) {
        this._value = Array.isArray(value) ? value : [value, Date.now()];
    }

    get() {
        return this._value;
    }


    private async valueString() {
        return `${this.name}${Metric.LabelString(super.labels)} ${this._value[0].toString()} ${this._value[1].toString()}\n`;
    }

    async stringify() {
        return (
            await super.stringify() +
            await this.valueString() + "\n"
        )
    }


}
