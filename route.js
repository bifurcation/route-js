// Reverse-engineered API from flightconnections.com
//
// Look up index for an airport:
// http://www.flightconnections.com/autocompl_airport.php?term=EZE
// [{ "value": "Buenos Aires (EZE)", "id": 2561 }]
//
// Look up routes from one airport:
// http://www.flightconnections.com/ro2561.json?v=705&f=no0
//
// Look up direct routes from one airport to another:
// http://www.flightconnections.com/ro173_2561.json?v=705&f=no0
//
// Look up two-hop routes from one airport to another:
// http://www.flightconnections.com/ro4807_35_2_0_0.json?v=705&f=no0
//
// Look up three-hop routes from one airport to another:
// http://www.flightconnections.com/ro4807_35_3_0_0.json?v=705&f=no0

const fs = require('fs');
const axios = require('axios');

// Some utility functions for statistics
let sum = (x, y) => (x + y);
let min = (x, y) => ((x < y)? x : y);
let max = (x, y) => ((x > y)? x : y);

let idCache = {};

async function airportID(code) {
  if (code in idCache) {
    return idCache[code];
  }

  const url = "http://www.flightconnections.com/autocompl_airport.php?term=" + code;
  const response = await axios.get(url);
  const id = response.data[0].id
  idCache[code] = id;
  return id;
}

async function tryOne(src, dst) {
  const url = "http://www.flightconnections.com/ro" + src + "_" + dst + ".json?v=705&f=no0";
  const response = await axios.get(url);
  
  if (response.data.data.length === 0) {
    return null;
  }

  return {
    hops: 1,
    dist: response.data.data[0].dist,
    dur: response.data.data[0].dur,
  };
}

async function tryN(src, dst, n) {
  const url = "http://www.flightconnections.com/ro" + src + "_" + dst + "_" + n + "_0_0.json?v=705&f=no0";
  const response = await axios.get(url);

  if (response.data.routedata.length === 0) {
    return null;
  }

  const route = response.data.routedata[0]

  return {
    hops: n,
    dist: route.map(hop => hop[2]).reduce((x,y) => x+y),
    dur: route.map(hop => hop[3]).reduce((x,y) => x+y),
  };
}

let distCache = {};
let zeroDist = {hops: 0, dist: 0, dur: 0};
let infDist = {hops: Infinity, dist: Infinity, dur: Infinity};

async function pairDistance(src, dst) {
  console.error(`${src} -> ${dst}`);

  if (src === dst) {
    return zeroDist;
  }

  const keys = [src, dst].sort();
  const key = `${keys[0]} -- ${keys[1]}`;
  if (key in distCache) {
    return distCache[key];
  }

  let srcID = await airportID(src);
  let dstID = await airportID(dst);

  let dist = await tryOne(srcID, dstID);
  dist = dist || await tryN(srcID, dstID, 2);
  dist = dist || await tryN(srcID, dstID, 3);

  if (!dist) {
    return infDist;
  }

  distCache[key] = dist;
  return dist;
}

const cities = {
  "WAS": ["IAD", "DCA", "BWI"],
  "LON": ["LHR", "LGW", "LCY"],
  "NYC": ["LGA", "JFK", "EWR"],
};

async function asyncMap(array, func) {
  return Promise.all(array.map(func));
}

async function distance(src, dst) {
  if (src === dst) {
    return zeroDist;
  }
  
  let srcs = cities[src] || [src];
  let dsts = cities[dst] || [dst];

  let pairs = srcs.map(x => dsts.map(y => [x, y]))
                  .reduce((a, b) => a.concat(b));
  let distances = await asyncMap(pairs, p => pairDistance(p[0], p[1]));

  let minHops = distances.map(x => x.hops).reduce(min);
  let minDist = distances.map(x => x.dist).reduce(min);
  let minDur = distances.map(x => x.dur).reduce(min);

  return {
    hops: minHops,
    dist: minDist,
    dur: minDur,
  };
}

// The below code will build up a table of cost metrics in this map,
// indexed first by destination, then by source.  In other words:
//
//   distMap[dst][i] = distance(homeAirports[i], dst)
//
// Each entry is an object in the form output by distance():
//
//   {
//     code: /* Airport code for src */
//     hops: /* number of flight hops */
//     dist: /* total flight distance, in kilimeters */
//     dur:  /* total flight duration, in minutes */
//   }
//
// This should make it easy to compute a variety of cost metrics.
async function main() {
  // Read and validate config
  if (process.argv.length != 3) {
    throw "Usage: node route.js config.json";
  }
  
  const configFile = process.argv[2];
  const config = JSON.parse(fs.readFileSync(configFile, "utf8"));

  if (!(config.src instanceof Array) || !(config.dst instanceof Array)) {
    throw "Error: Malformed config file";
  }

  config.bcThreshold = config.bcThreshold || 0;

  // Compute distance metrics
  let distMap = {};
  config.dst.map(dst => { distMap[dst] = []; });

  for (const src of config.src) {
    for (const dst of config.dst) {
      const d = await distance(src, dst);
      d.code = src;
      distMap[dst].push(d);
    }
  }

  // Perform analysis here...
  for (dst in distMap) {
    let data = distMap[dst];

    let minhops = data.map(x => x.hops).reduce(min);
    let maxhops = data.map(x => x.hops).reduce(max);
    let avghops = data.map(x => x.hops).reduce(sum) / data.length;
    let mindist = data.map(x => x.dist).reduce(min);
    let maxdist = data.map(x => x.dist).reduce(max);
    let avgdist = data.map(x => x.dist).reduce(sum) / data.length;
    let mindur = data.map(x => x.dur).reduce(min);
    let maxdur = data.map(x => x.dur).reduce(max);
    let avgdur = data.map(x => x.dur).reduce(sum) / data.length;

    let bc = data.filter(x => x.dur > config.bcThreshold).length;

    let outhops = `${minhops},${maxhops},${avghops}`;
    let outdist = `${mindist},${maxdist},${avgdist}`;
    let outdur = `${mindur},${maxdur},${avgdur}`;
    console.log(`${dst},${outhops},${outdist},${outdur},${bc}`);
  }

  // ... or just dump JSON for later analysis
  //console.log(JSON.stringify(distMap, null, 2));
}

main();
