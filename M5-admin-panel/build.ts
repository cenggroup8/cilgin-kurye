import { copyFile } from 'node:fs/promises';
import { build } from 'esbuild';

await build({ entryPoints: ['src/main.ts'], bundle: true, format: 'esm', outdir: 'dist' });
await copyFile('index.html', 'dist/index.html');
