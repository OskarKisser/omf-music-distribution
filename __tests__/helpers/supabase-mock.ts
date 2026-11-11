/**
 * Минимальный мок Supabase query builder для тестов маршрутов.
 * Каждая цепочка `from(table)...` записывается в `calls`; результат отдаёт `resolve(call)`.
 */
export type MockCall = {
  table: string;
  op: "select" | "insert" | "update" | "upsert" | "delete";
  payload?: unknown;
  filters: Array<[string, ...unknown[]]>;
};

export type MockResult = { data: unknown; error: { message: string; code?: string } | null };

export function createSupabaseMock(resolve: (call: MockCall) => MockResult) {
  const calls: MockCall[] = [];

  function from(table: string) {
    const call: MockCall = { table, op: "select", filters: [] };
    calls.push(call);
    const run = () => Promise.resolve(resolve(call));
    const builder: Record<string, unknown> = {};
    const chain =
      (name: string, op?: MockCall["op"]) =>
      (...args: unknown[]) => {
        if (op) {
          // select после insert/update/upsert — это returning, операцию не меняем.
          if (!(op === "select" && call.op !== "select")) {
            call.op = op;
            if (op !== "select" && op !== "delete") call.payload = args[0];
          }
        } else {
          call.filters.push([name, ...args]);
        }
        return builder;
      };
    builder.select = chain("select", "select");
    builder.insert = chain("insert", "insert");
    builder.update = chain("update", "update");
    builder.upsert = chain("upsert", "upsert");
    builder.delete = chain("delete", "delete");
    for (const f of ["eq", "neq", "in", "is", "not", "or", "order", "limit", "gte", "lte", "like", "range"]) builder[f] = chain(f);
    builder.maybeSingle = run;
    builder.single = run;
    builder.then = (onOk: (v: MockResult) => unknown, onErr?: (e: unknown) => unknown) =>
      run().then(onOk, onErr);
    return builder;
  }

  return { client: { from } as unknown, calls };
}

export function filterValue(call: MockCall, name: string, column?: string): unknown {
  const hit = call.filters.find((f) => f[0] === name && (column === undefined || f[1] === column));
  return hit ? (column === undefined ? hit[1] : hit[2]) : undefined;
}
