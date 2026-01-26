import { env } from '$env/dynamic/private';

/** @typedef {{ query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>, end: () => Promise<void> }} PgPool */
/** @type {Promise<PgPool> | null} */
let poolPromise = null;
/** @type {import('@google-cloud/cloud-sql-connector').Connector | null} */
let connector = null;

/** @returns {Promise<PgPool>} */
const resolvePool = async () => {
	if (poolPromise) return poolPromise;

	poolPromise =
		/** @type {Promise<PgPool>} */
		((async () => {
		const [{ Pool }, { Connector }] = await Promise.all([
			import('pg'),
			import('@google-cloud/cloud-sql-connector')
		]);

		if (env.VENDOR_DB_CONNECTION_URL) {
			return new Pool({ connectionString: env.VENDOR_DB_CONNECTION_URL });
		}

		if (!env.VENDOR_DB_INSTANCE_CONNECTION_NAME) {
			throw new Error('VENDOR_DB_INSTANCE_CONNECTION_NAME is required when VENDOR_DB_CONNECTION_URL is not set.');
		}

		connector = new Connector();
		const ipType =
			/** @type {import('@google-cloud/cloud-sql-connector').IpAddressTypes} */
			(env.VENDOR_DB_IP_TYPE ?? 'PUBLIC');
		const clientOpts = await connector.getOptions({
			instanceConnectionName: env.VENDOR_DB_INSTANCE_CONNECTION_NAME,
			ipType
		});

		return new Pool({
			...clientOpts,
			user: env.VENDOR_DB_USER,
			password: env.VENDOR_DB_PASS,
			database: env.VENDOR_DB_NAME
		});
		})());

	return /** @type {Promise<PgPool>} */ (poolPromise);
};

/** @returns {Promise<PgPool>} */
export const getPool = async () => resolvePool();

export const closePool = async () => {
	if (!poolPromise) return;
	const pool = await poolPromise;
	await pool.end();
	poolPromise = null;

	if (connector) {
		await connector.close();
		connector = null;
	}
};
