import type { AgentTool } from "./toolRegistry";

export interface TodoListInput {
  action?: "create" | "update";
  tasks: Array<string | { text: string; status?: "pending" | "running" | "done" | "failed" | "skipped" }>;
}

export interface TodoListOutput {
  action: "create" | "update";
  tasks: Array<{ id: number; text: string; status: "pending" | "running" | "done" | "failed" | "skipped" }>;
  changed?: Array<{ id: number; from: TodoListOutput["tasks"][number]["status"] | "missing"; to: TodoListOutput["tasks"][number]["status"] }>;
}

export function createTodoTools(): AgentTool[] {
  // Keep an in-memory todo snapshot within the agent process.
  // This makes UI output stable even when agents send only partial overrides or repeat updates.
  let current: TodoListOutput["tasks"] = [];

  return [
    {
      name: "todo_list",
      description: "创建或更新轻量级执行任务列表",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["create", "update"] },
          tasks: {
            type: "array",
            items: {
              anyOf: [
                { type: "string" },
                {
                  type: "object",
                  properties: {
                    text: { type: "string" },
                    status: { type: "string", enum: ["pending", "running", "done", "failed", "skipped"] },
                  },
                  required: ["text"],
                  additionalProperties: false,
                },
              ],
            },
          },
        },
        required: ["tasks"],
        additionalProperties: false,
      },
      execute: async (input: TodoListInput): Promise<TodoListOutput> => {
        const action = input.action ?? (current.length > 0 ? "update" : "create");
        const incoming = (input.tasks || []).map((item, index) => {
          if (typeof item === "string") {
            return { id: index + 1, text: item, status: "pending" as const };
          }
          return {
            id: index + 1,
            text: item.text,
            status: (item.status ?? "pending") as TodoListOutput["tasks"][number]["status"],
          };
        });

        if (action === "create" || current.length === 0) {
          current = incoming.slice();
          return { action: "create", tasks: current.slice() };
        }

        const prev = current.slice();

        // Monotonic merge: once a task reaches a terminal status, don't allow it to regress.
        const isTerminal = (status: TodoListOutput["tasks"][number]["status"]): boolean =>
          status === "done" || status === "failed" || status === "skipped";
        const isWeaker = (next: TodoListOutput["tasks"][number]["status"]): boolean =>
          next === "pending" || next === "running";

        const merged: TodoListOutput["tasks"] = [];
        const maxLen = Math.max(current.length, incoming.length);
        for (let i = 0; i < maxLen; i += 1) {
          const prev = current[i];
          const next = incoming[i];
          if (!prev && next) {
            merged.push(next);
            continue;
          }
          if (prev && !next) {
            merged.push(prev);
            continue;
          }
          if (!prev || !next) continue;

          const prevStatus = prev.status;
          const nextStatus = next.status;
          const status =
            isTerminal(prevStatus) && isWeaker(nextStatus) ? prevStatus : nextStatus;
          merged.push({
            id: next.id,
            text: next.text,
            status,
          });
        }

        current = merged;
        const changed: TodoListOutput["changed"] = [];
        for (const task of current) {
          const before = prev.find((item) => item.id === task.id);
          if (!before) {
            changed.push({ id: task.id, from: "missing", to: task.status });
            continue;
          }
          if (before.status !== task.status || before.text !== task.text) {
            changed.push({ id: task.id, from: before.status, to: task.status });
          }
        }
        return { action: "update", tasks: current.slice(), changed };
      },
    },
  ];
}
