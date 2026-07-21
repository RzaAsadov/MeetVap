import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

const envPaths = [
  path.resolve(__dirname, '../../.env'),
  path.resolve(process.cwd(), '../.env'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '../.env'),
];

for (const envPath of envPaths) {
  dotenv.config({ path: envPath, quiet: true });
}

const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(1).optional(),
);
const optionalUrl = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().url().optional(),
);

function firstNonEmpty(...values: Array<string | undefined>) {
  return values.find((value) => value !== undefined && value.trim() !== '');
}

const rawEnv = {
  ...process.env,
  APNS_BUNDLE_ID: firstNonEmpty(process.env.APNS_BUNDLE_ID, process.env.IOS_BUNDLE_ID),
  APPLE_BUNDLE_ID: firstNonEmpty(process.env.APPLE_BUNDLE_ID, process.env.IOS_BUNDLE_ID, process.env.APNS_BUNDLE_ID),
  LIVEKIT_API_KEY: firstNonEmpty(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API, process.env.LIVEKIT_KEY),
  LIVEKIT_API_SECRET: firstNonEmpty(process.env.LIVEKIT_API_SECRET, process.env.LIVEKIT_SECRET),
  LIVEKIT_SERVERS_CONFIG_PATH: firstNonEmpty(process.env.LIVEKIT_SERVERS_CONFIG_PATH),
  LIVEKIT_URL: firstNonEmpty(process.env.LIVEKIT_URL, process.env.LIVEKIT_WS_URL, process.env.LIVEKIT_HOST),
};

const envSchema = z.object({
  CLIENT_ORIGIN: z.string().default('*'),
  CATALOG_URL: optionalUrl,
  DATABASE_URL: z.string().min(1),
  APNS_BUNDLE_ID: optionalString,
  APNS_KEY_ID: optionalString,
  APNS_KEY_PATH: optionalString,
  APNS_PRODUCTION: z.coerce.boolean().default(true),
  APNS_TEAM_ID: optionalString,
  APPLE_BUNDLE_ID: optionalString,
  APPLE_SHARED_SECRET: optionalString,
  FIREBASE_SERVICE_ACCOUNT_PATH: optionalString,
  GOOGLE_PACKAGE_NAME: optionalString,
  GOOGLE_SERVICE_ACCOUNT_JSON: optionalString,
  GOOGLE_SERVICE_ACCOUNT_PATH: optionalString,
  JWT_SECRET: z.string().min(24, 'JWT_SECRET must be at least 24 characters'),
  LIVEKIT_API_KEY: optionalString,
  LIVEKIT_API_SECRET: optionalString,
  LIVEKIT_SERVERS_CONFIG_PATH: optionalString,
  LIVEKIT_URL: optionalUrl,
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  PUBLIC_API_URL: optionalUrl,
  REDIS_URL: optionalUrl,
  SCREENSHOT_SUBSCRIPTION_BYPASS: z.coerce.boolean().default(false),
  SERVER_EVENTS_GROUP_ID: optionalString,
  SERVER_EVENTS_INTERNAL_SECRET: optionalString,
  SERVER_EVENTS_LIVEKIT_ID: optionalString,
  SERVER_EVENTS_SUPPORT_ID: optionalString,
  SUBSCRIPTION_BYPASS_USERNAMES: z.string().default(''),
  UPLOAD_DIR: z.string().min(1).default(path.resolve(process.cwd(), '../uploads')),
});

export const config = envSchema.parse(rawEnv);
