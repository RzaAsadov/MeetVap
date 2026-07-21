import path from 'node:path';
import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';

const envPaths = [
  path.resolve(__dirname, '../.env'),
  path.resolve(process.cwd(), '../.env'),
  path.resolve(process.cwd(), '.env'),
];

for (const envPath of envPaths) {
  dotenv.config({ path: envPath, quiet: true });
}

process.env.DATABASE_URL ??= 'postgresql://messenger:messenger@localhost:5432/messenger?schema=public';

export default defineConfig({
  schema: './prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL,
  },
  migrations: {
    path: './prisma/migrations',
  },
});
