import { describe, expect, it } from "vitest";
import {
  TaskListTool,
  TaskStateStore,
  TaskUpdateTool,
} from "../../../src/tools/infrastructure/task-state-tools.js";

describe("task state tools", () => {
  it("creates, updates, filters, and lists session-local task state through one store", async () => {
    const store = new TaskStateStore({ now: () => 1_800_000_000_000 });
    const updateTool = new TaskUpdateTool({ store });
    const listTool = new TaskListTool({ store });

    const created = await updateTool.execute({
      name: "task_update",
      input: {
        title: "Implement shared task state",
        status: "in_progress",
        details: "Core first",
        verbosity: "structured",
      },
    });

    expect(created.isError).toBe(false);
    expect(JSON.parse(created.output)).toMatchObject({
      task: {
        id: "task_1",
        title: "Implement shared task state",
        status: "in_progress",
        details: "Core first",
        dependsOn: [],
        sequence: 1,
      },
      counts: {
        in_progress: 1,
      },
    });
    expect(created.metadata).toMatchObject({
      toolName: "task_update",
      kind: "task_state",
      operation: "update",
      id: "task_1",
      status: "in_progress",
      taskCount: 1,
      sequence: 1,
      verbosity: "structured",
    });

    const blocked = await updateTool.execute({
      name: "task_update",
      input: {
        id: "task_2",
        title: "Wait for review",
        status: "blocked",
        dependsOn: ["task_1", "task_1"],
        verbosity: "structured",
      },
    });

    expect(blocked.isError).toBe(false);
    expect(JSON.parse(blocked.output)).toMatchObject({
      task: {
        id: "task_2",
        status: "blocked",
        dependsOn: ["task_1"],
        sequence: 2,
      },
    });

    const completed = await updateTool.execute({
      name: "task_update",
      input: {
        id: "task_1",
        title: "Implement shared task state",
        status: "completed",
        details: "Done",
        verbosity: "summary",
      },
    });

    expect(completed.output).toBe("task_1 completed; 2 tasks");
    expect(completed.metadata).toMatchObject({
      status: "completed",
      taskCount: 2,
      sequence: 3,
    });

    const blockedList = await listTool.execute({
      name: "task_list",
      input: { status: "blocked", verbosity: "structured" },
    });

    expect(blockedList.isError).toBe(false);
    expect(JSON.parse(blockedList.output)).toMatchObject({
      tasks: [{
        id: "task_2",
        title: "Wait for review",
        status: "blocked",
        dependsOn: ["task_1"],
      }],
      counts: {
        blocked: 1,
        completed: 1,
      },
    });
    expect(blockedList.metadata).toMatchObject({
      toolName: "task_list",
      kind: "task_state",
      operation: "list",
      status: "blocked",
      taskCount: 1,
      totalTaskCount: 2,
    });
  });

  it("validates status, title, ids, dependencies, and list filters", async () => {
    const store = new TaskStateStore();
    const updateTool = new TaskUpdateTool({ store });
    const listTool = new TaskListTool({ store });

    await expect(updateTool.execute({
      name: "task_update",
      input: { title: "", status: "pending" },
    })).resolves.toMatchObject({
      isError: true,
      output: expect.stringContaining("title"),
    });

    await expect(updateTool.execute({
      name: "task_update",
      input: { title: "Bad status", status: "open" },
    })).resolves.toMatchObject({
      isError: true,
      output: expect.stringContaining("status"),
    });

    await expect(updateTool.execute({
      name: "task_update",
      input: {
        id: "task_self",
        title: "Self dependency",
        status: "blocked",
        dependsOn: ["task_self"],
      },
    })).resolves.toMatchObject({
      isError: true,
      output: expect.stringContaining("depend on itself"),
    });

    await expect(listTool.execute({
      name: "task_list",
      input: { status: "open" },
    })).resolves.toMatchObject({
      isError: true,
      output: expect.stringContaining("status"),
    });
  });

  it("treats model-emitted null task filters and dependencies as omitted", async () => {
    const store = new TaskStateStore({ now: () => 1_800_000_000_000 });
    const updateTool = new TaskUpdateTool({ store });
    const listTool = new TaskListTool({ store });

    await expect(updateTool.execute({
      name: "task_update",
      input: {
        title: "Implement bounded task state",
        status: "pending",
        dependsOn: null,
        verbosity: "structured",
      },
    })).resolves.toMatchObject({ isError: false });

    await expect(listTool.execute({
      name: "task_list",
      input: { status: null, verbosity: "summary" },
    })).resolves.toMatchObject({
      isError: false,
      output: "1 tasks; sequence 1",
    });

    await expect(listTool.execute({
      name: "task_list",
      input: { status: "all", verbosity: "summary" },
    })).resolves.toMatchObject({
      isError: false,
      output: "1 tasks; sequence 1",
    });
  });
});
