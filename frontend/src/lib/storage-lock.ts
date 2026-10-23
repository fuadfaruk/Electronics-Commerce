const queues = new Map<string, Promise<void>>();

export async function withStorageLock<T>(key: string, operation: (shared: boolean) => T | Promise<T>): Promise<T> {
  const previous = queues.get(key);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  queues.set(key, pending);
  await previous;
  try {
    let entered = false;
    try {
      if (typeof navigator !== "undefined" && navigator.locks?.request) {
        return await navigator.locks.request(`electromart:${key}`, () => {
          entered = true;
          return operation(true);
        });
      }
    } catch (error) {
      // A rejected lock may degrade; a failed operation must never run twice.
      if (entered) throw error;
    }
    return await operation(false);
  } finally {
    release();
    if (queues.get(key) === pending) queues.delete(key);
  }
}
