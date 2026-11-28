// A small program that prints bench lines, for the command adapter test.
const secs = Number(process.env.BENCH_SECONDS ?? 1);
console.log("hello, this line is a log");
console.log("@metric temp_c 21.5 C");
console.log('@event hit zone=4 strong=true');
console.log(`@metric speed ${Number(process.env.BENCH_SPEED ?? 0)}`);
console.log('@check "quiet table, no false event" ok');
console.log('{"kind":"check","name":"json check","ok":false,"detail":"2/3"}');
console.log("@metric broken notanumber");
process.stdin.on("data", (d) => console.log(`@event got ${String(d).trim()}`));
setTimeout(() => process.exit(process.env.BENCH_FAIL ? 3 : 0), secs * 500);
