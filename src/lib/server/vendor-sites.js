import { env } from '$env/dynamic/private';
import { getPool } from './db.js';

const DEFAULT_LIMIT = 200;

export const fetchVendorSites = async () => {
	const pool = await getPool();
	const limit = Number(env.VENDOR_DB_LIMIT ?? DEFAULT_LIMIT);

	const result = await pool.query(
		`
			select
				VENDOR_SITE_ID as id,
				VENDOR_SITE_CODE as name,
				ADDRESS_LINE1 as address,
				CITY as city,
				STATE as state,
				ZIP as zip
			from BMCD_TADP_SUPP_SITES_T
			where INACTIVE_DATE is null
			fetch first $1 rows only
		`,
		[limit]
	);

	return result.rows;
};
