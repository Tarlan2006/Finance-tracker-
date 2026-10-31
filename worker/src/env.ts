export interface Env {
  APP_KEY?: string; ADMIN_TOKEN?: string; GOOGLE_SERVICE_ACCOUNT_JSON?: string; SHEET_ID?: string; USE_MOCK?: string; NATIVE_TABLE?: string;
  SHEET_NAME_EXPENSES: string; SHEET_NAME_DICT: string; SHEET_NAME_INCOME: string;
  TZ: string; CURRENCY: string; DUPLICATE_WINDOW_MIN: string;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  COORDINATOR?: { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } };
  ACCOUNTS?: { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } };
}
export const isMock = (env: Env) => env.USE_MOCK === '1' || !env.GOOGLE_SERVICE_ACCOUNT_JSON;
