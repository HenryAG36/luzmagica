export interface HttpResult<T = unknown> {
    ok: boolean;
    status: number;
    data?: T;
    error?: string;
    retryAfterSeconds?: number;
    deferSeconds?: number;
}

export interface FetchLike {
    (input: string, init?: RequestInit): Promise<Response>;
}

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_RETRIES = 2;
const MAX_RETRY_AFTER_MS = 10000;

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseRetryAfter(header: string | null, nowMs: number = Date.now()): number | null {
    if (!header) return null;
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds;
    const date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.max(0, Math.ceil((date - nowMs) / 1000));
    return null;
}

export async function fetchJson<T = unknown>(
    url: string,
    init: RequestInit = {},
    options: { timeoutMs?: number; fetchImpl?: FetchLike; deadlineMs?: number } = {}
): Promise<HttpResult<T>> {
    const fetchImpl = options.fetchImpl || fetch;
    const baseTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const remainingDeadline = (): number | null =>
        options.deadlineMs === undefined ? null : options.deadlineMs - Date.now();

    if (remainingDeadline() !== null && (remainingDeadline() as number) <= 0) {
        return { ok: false, status: 0, error: "refresh deadline exceeded" };
    }

    let lastError = "unknown error";

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const remaining = remainingDeadline();
        if (remaining !== null && remaining <= 0) {
            return { ok: false, status: 0, error: "refresh deadline exceeded" };
        }
        const attemptTimeout = remaining !== null ? Math.min(baseTimeoutMs, remaining) : baseTimeoutMs;

        const sleepIfWithinDeadline = async (waitMs: number): Promise<boolean> => {
            const left = remainingDeadline();
            if (left !== null && waitMs > left) return false;
            await sleep(waitMs);
            return true;
        };

        try {
            const res = await fetchImpl(url, {
                ...init,
                signal: AbortSignal.timeout(attemptTimeout),
            });

            if (res.status === 429) {
                const retryAfterSeconds = parseRetryAfter(res.headers.get("retry-after"));
                const waitMs = (retryAfterSeconds ?? 2) * 1000;
                if (waitMs > MAX_RETRY_AFTER_MS) {
                    return {
                        ok: false,
                        status: 429,
                        error: "rate limited",
                        retryAfterSeconds: retryAfterSeconds ?? undefined,
                        deferSeconds: Math.ceil(waitMs / 1000),
                    };
                }
                if (attempt < MAX_RETRIES) {
                    if (!(await sleepIfWithinDeadline(waitMs))) {
                        return {
                            ok: false,
                            status: 429,
                            error: "refresh deadline exceeded",
                            retryAfterSeconds: retryAfterSeconds ?? undefined,
                            deferSeconds: Math.ceil(waitMs / 1000),
                        };
                    }
                    continue;
                }
                return { ok: false, status: 429, error: "rate limited", retryAfterSeconds: retryAfterSeconds ?? undefined };
            }

            if (res.status >= 500 && attempt < MAX_RETRIES) {
                if (!(await sleepIfWithinDeadline(500 * (attempt + 1)))) {
                    return { ok: false, status: res.status, error: "refresh deadline exceeded" };
                }
                continue;
            }

            if (!res.ok) {
                return { ok: false, status: res.status, error: `http ${res.status}` };
            }

            const data = (await res.json()) as T;
            return { ok: true, status: res.status, data };
        } catch (err) {
            lastError = err instanceof Error ? err.message : "network error";
            if (attempt < MAX_RETRIES) {
                if (!(await sleepIfWithinDeadline(500 * (attempt + 1)))) {
                    return { ok: false, status: 0, error: "refresh deadline exceeded" };
                }
                continue;
            }
            return { ok: false, status: 0, error: lastError };
        }
    }

    return { ok: false, status: 0, error: lastError };
}
