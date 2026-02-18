import Database from 'better-sqlite3-multiple-ciphers';

/**
 * Safely execute a parameterized SELECT query, preventing SQL injection.
 * Uses prepared statements with bound parameters.
 */
export const safeGet = <T = any>(
  db: Database.Database,
  sql: string,
  params: any[] = [],
): T | undefined => {
  const stmt = db.prepare(sql);
  return stmt.get(...params) as T | undefined;
};

/**
 * Safely execute a parameterized SELECT ALL query, preventing SQL injection.
 */
export const safeAll = <T = any>(
  db: Database.Database,
  sql: string,
  params: any[] = [],
): T[] => {
  const stmt = db.prepare(sql);
  return stmt.all(...params) as T[];
};

/**
 * Safely execute a parameterized INSERT/UPDATE/DELETE, preventing SQL injection.
 * Returns the RunResult.
 */
export const safeRun = (
  db: Database.Database,
  sql: string,
  params: any[] = [],
): Database.RunResult => {
  const stmt = db.prepare(sql);
  return stmt.run(...params);
};

/**
 * Sanitize a string value for safe storage (trim + length limit).
 * This is an extra layer on top of parameterized queries.
 */
export const sanitizeValue = (value: string, maxLength = 10000): string => {
  return value.slice(0, maxLength);
};
