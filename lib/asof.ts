/** "Today" for age calculations: AS_OF_DATE when set, otherwise the current date. */
export function resolveAsOfDate(env: string | undefined, now: Date): string {
  if (env === undefined || env.trim() === "") return now.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(env.trim())) {
    throw new Error(`AS_OF_DATE must look like 2026-09-20, got "${env}"`);
  }
  return env.trim();
}

export const currentAsOfDate = (): string => resolveAsOfDate(process.env.AS_OF_DATE, new Date());
