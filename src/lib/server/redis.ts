import Redis, { type RedisOptions } from 'ioredis';

let client: Redis | null | undefined;
let hasLoggedError = false;

function logRedisError(error: unknown): void {
        if (hasLoggedError) return;
        hasLoggedError = true;
        console.error('Redis connection error:', error);
}

function buildOptions(): RedisOptions | string | null {
        const url = process.env.REDIS_URL || process.env.REDIS_CONNECTION_STRING;
        if (url) {
                return url;
        }

        const host = process.env.REDIS_HOST;
        if (!host) {
                return null;
        }

        const port = process.env.REDIS_PORT ? Number.parseInt(process.env.REDIS_PORT, 10) : 6379;
        const tlsEnabled = (process.env.REDIS_TLS || '').toLowerCase() === 'true';

        const options: RedisOptions = {
                host,
                port,
                password: process.env.REDIS_PASSWORD,
                username: process.env.REDIS_USERNAME,
	};

	if (tlsEnabled) {
		options.tls = {};
	}

	return options;
}

export function getRedisClient(): Redis | null {
	if (client !== undefined) {
		return client;
	}

	const options = buildOptions();
	if (!options) {
		client = null;
		return client;
	}

	try {
		client =
			typeof options === 'string' ? new Redis(options, { lazyConnect: true }) : new Redis(options);
		client.on('error', logRedisError);
		return client;
	} catch (error) {
		logRedisError(error);
		client = null;
		return client;
	}
}

export function isRedisEnabled(): boolean {
	return getRedisClient() !== null;
}
