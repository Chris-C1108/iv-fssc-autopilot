export async function mapConcurrent<T, R>(
    items: T[],
    concurrency: number,
    asyncFn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let currentIndex = 0;

    const worker = async () => {
        while (currentIndex < items.length) {
            const idx = currentIndex++;
            try {
                results[idx] = await asyncFn(items[idx], idx);
            } catch (err) {
                console.error(`Error in mapConcurrent at index ${idx}:`, err);
                results[idx] = null as any;
            }
        }
    };

    const workers = [];
    const actualConcurrency = Math.min(concurrency, items.length);
    for (let i = 0; i < actualConcurrency; i++) {
        workers.push(worker());
    }
    await Promise.all(workers);
    return results;
}
