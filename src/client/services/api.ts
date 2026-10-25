import axios, { AxiosError } from 'axios';

/**
 * Axios instance for the same-origin API.
 * The session lives in an HTTP-only cookie; the CSRF token is read from the `mf_csrf` cookie
 * and echoed in `X-CSRF-Token` on every state-changing request. Nothing is kept in localStorage.
 * Responses are unwrapped: `api.get<T>()` resolves to the `data` field of `{ data, meta? }`.
 */
export const http = axios.create({
  baseURL: '/api',
  withCredentials: true,
  xsrfCookieName: 'mf_csrf',
  xsrfHeaderName: 'X-CSRF-Token',
  withXSRFToken: true,
});

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof AxiosError) {
    const body = err.response?.data as ApiErrorBody | undefined;
    if (body?.error) return new ApiError(err.response!.status, body.error.code, body.error.message, body.error.details);
    if (!err.response) return new ApiError(0, 'NETWORK', 'Network error — check your connection and try again.');
    return new ApiError(err.response.status, 'HTTP_ERROR', err.message);
  }
  return new ApiError(0, 'UNKNOWN', err instanceof Error ? err.message : 'Unexpected error');
}

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: (() => void) | null) => {
  onUnauthorized = fn;
};

http.interceptors.response.use(
  (r) => r,
  (err) => {
    const e = toApiError(err);
    if (e.status === 401 && onUnauthorized) onUnauthorized();
    return Promise.reject(e);
  },
);

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export const api = {
  get: async <T>(url: string, params?: Record<string, unknown>) => (await http.get<{ data: T }>(url, { params })).data.data,
  getPaged: async <T>(url: string, params?: Record<string, unknown>) =>
    (await http.get<{ data: T; meta: PageMeta & Record<string, unknown> }>(url, { params })).data,
  post: async <T>(url: string, body?: unknown) => (await http.post<{ data: T }>(url, body)).data?.data,
  put: async <T>(url: string, body?: unknown) => (await http.put<{ data: T }>(url, body)).data?.data,
  patch: async <T>(url: string, body?: unknown) => (await http.patch<{ data: T }>(url, body)).data?.data,
  delete: async (url: string) => {
    await http.delete(url);
  },
  /** Downloads a file response (CSV/JSON export) and saves it via a temporary link. */
  download: async (url: string, params: Record<string, unknown>, filename: string) => {
    const res = await http.get(url, { params, responseType: 'blob' });
    const href = URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(href);
  },
};
