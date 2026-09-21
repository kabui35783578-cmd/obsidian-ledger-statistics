/** requestUrl cannot abort its native transport. Keep the slot until it settles. */
export class RequestGate {
  busy = false;

  async run<T>(operation: () => Promise<T>, signal?: AbortSignal, timeoutMs = 60_000): Promise<T> {
    if (signal?.aborted) throw new Error("请求已取消");
    if (this.busy) throw new Error("上次请求的连接尚未结束，请稍后重试");
    this.busy = true;
    const pending = Promise.resolve().then(() => {
      if (signal?.aborted) throw new Error("请求已取消");
      return operation();
    }).finally(() => { this.busy = false; });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    const deadline = new Promise<never>((_, reject) => {
      cancel = () => reject(new Error("请求已取消"));
      signal?.addEventListener("abort", cancel, { once: true });
      timer = setTimeout(() => reject(new Error("请求超过等待时限，已停止等待；连接结束前不会重复请求")), timeoutMs);
    });
    try {
      return await Promise.race([pending, deadline]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (cancel) signal?.removeEventListener("abort", cancel);
    }
  }
}

// Retain locks across plugin hot reloads while native requests are still pending.
const host = globalThis as typeof globalThis & { __ledgerRequestGates?: Record<string, RequestGate> };
export function sharedRequestGate(key: string): RequestGate {
  const gates = host.__ledgerRequestGates ??= {};
  return gates[key] ??= new RequestGate();
}
