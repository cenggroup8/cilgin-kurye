import { readFileSync } from 'node:fs';
import { RoutePlanner } from '../src/traffic/routes/routePlanner.js';

const file = process.argv[2] ?? '../contracts/city_plan.json';
const planner = new RoutePlanner(JSON.parse(readFileSync(file, 'utf8')));
console.log(JSON.stringify(planner.travelTimes(), null, 2));
