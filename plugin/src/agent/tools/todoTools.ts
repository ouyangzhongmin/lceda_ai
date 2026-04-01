import type { AgentTool } from "./toolRegistry";

export interface TodoListInput {
  action?: "create" | "update";
  tasks: Array<string | { text: string; status?: "pending" | "running" | "done" | "failed" | "skipped" }>;
}

export interface TodoListOutput {
  tasks: Array<{ id: number; text: string; status: "pending" | "running" | "done" | "failed" | "skipped" }>;
}

export function createTodoTools(): AgentTool[] {
  return [
    {
      name: "todo_list",
      description: "创建或更新轻量级执行任务列表",
      execute: async (input: TodoListInput): Promise<TodoListOutput> => {
        const tasks = (input.tasks || []).map((item, index) => {
          if (typeof item === "string") {
            return { id: index + 1, text: item, status: "pending" as const };
          }
          return {
            id: index + 1,
            text: item.text,
            status: (item.status ?? "pending") as TodoListOutput["tasks"][number]["status"],
          };
        });
        return { tasks };
      },
    },
  ];
}
