import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root (this file lives in apps/server/src). */
export const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** The single .env used by the server and all scripts. */
export const ENV_PATH = resolve(ROOT_DIR, '.env');
export const ENV_EXAMPLE_PATH = resolve(ROOT_DIR, '.env.example');
