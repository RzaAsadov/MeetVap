const { spawnSync } = require('child_process');
const path = require('path');
const dotenv = require('dotenv');

for (const envPath of [
  path.resolve(__dirname, '../../.env'),
  path.resolve(process.cwd(), '../.env'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '../.env'),
]) {
  dotenv.config({ path: envPath });
}

const prismaBin = require.resolve('prisma/build/index.js');
const result = spawnSync(process.execPath, [prismaBin, ...process.argv.slice(2)], {
  env: process.env,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
