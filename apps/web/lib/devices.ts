/** How many devices an account stays signed in on at once: a sign-in on
 * one more ends the oldest. The database decides (apps/api migration 060,
 * DEVICES — a test keeps the two equal); the sign-in page says it. */
export const DEVICES_AT_A_TIME = 2;
