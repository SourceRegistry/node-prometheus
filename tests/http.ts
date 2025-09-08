import {createServer} from "http";
import {Counter, Gauge, Histogram, Metric, Untyped} from "../src";

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

// const summary = new Summary({
//     name: "test 3",
//     description: "test of summery component",
//     quantiles: [.5, .9, 0.99],
//     calculate: Summary.Calculation.random
// })

let hits = 0;

const counter = new Counter({
    name: "test 4", reader: () => [
        [hits, {method: "GET", action: "Read metrics"}]
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
    console.log("Scraped")
    res.writeHead(200, {"Content-Type": "text/plain"})
    hits++;
    res.write(await Metric.concat(gauge, histogram, counter, untyped));
    res.end();
}).listen(8080, '0.0.0.0',() => console.log("http://0.0.0.0:8080")); //the server object listens on port 8080
