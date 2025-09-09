import {createServer} from "http";
import {Counter, Gauge, Histogram, Metric, Untyped} from "../../src"; // !! or import from library if using the npm package `import {Counter, Gauge, Histogram, Metric, Untyped} from "@sourceregistry/node-prometheus";`

const gauge = new Gauge({
    name: "test 1",
    description: "test of gauge component",
    reader: () => [Math.random()]
})

const histogram = new Histogram({
    name: "test 2",
    description: "test of histogram component",
    buckets: [.5, .4, .1, .2]
})

let hits = 0;

const counter = new Counter({
    name: "test 4", reader: () => [
        [hits, {method: "GET", action: "Read metrics"}],
    ]
})

const untyped = new Untyped({
    name: "test 5",
})

setInterval(() => {
    histogram.push(Math.random())
    // summary.push(Math.random())
}, 2000)

createServer(async (req, res) => {
    const acceptHeader = req.headers['accept'] || '';
    const isOM = acceptHeader.includes('application/openmetrics-text');

    res.writeHead(200, {
        'Content-Type': isOM
            ? 'application/openmetrics-text; version=1.0.0; charset=utf-8'
            : 'text/plain; version=0.0.4; charset=utf-8',
    });

    const output = await Metric.concat(isOM ? 'openmetrics' : 'prometheus', gauge, histogram, counter, untyped);
    res.end(output);
}).listen(8080, '0.0.0.0', () => {
    console.log('✅ Prometheus metrics server running at http://localhost:8080/metrics');
});
