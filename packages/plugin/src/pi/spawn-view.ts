import type { SpawnResult, SpawnTask } from "@spinejit/spine-sdk";

import { linesComponent, type SpineTheme } from "./pretty-tree.js";

const ACTIVITY_WORDS = [
  "Germinating",
  "Budding",
  "Sprouting",
  "Rooting",
  "Branching",
  "Unfurling",
  "Blooming",
  "Flourishing",
  "Sketching",
  "Shaping",
  "Layering",
  "Weaving",
  "Composing",
  "Rendering",
  "Unfolding",
  "Evolving",
  "Awakening",
  "Becoming",
  "Emerging",
  "Stirring",
  "Quickening",
  "Kindling",
  "Growing",
  "Greening",
  "Blossoming",
  "Ripening",
  "Renewing",
  "Cultivating",
  "Nurturing",
  "Deepening",
  "Flowing",
  "Gathering",
  "Coalescing",
  "Distilling",
  "Refining",
  "Crystallizing",
  "Illuminating",
  "Glimmering",
  "Resonating",
  "Materializing",
] as const;

export type SpawnTaskStatus = "running" | "completed" | "errored" | "aborted";

export interface SpawnTaskView {
  summary: string;
  activityWord: string;
  status: SpawnTaskStatus;
  diagnostic: string | null;
  memoryBody: string | null;
}

export interface SpawnBatchDetails {
  schema: "spine.spawn.view.v1";
  tasks: SpawnTaskView[];
}

export function createSpawnBatchView(tasks: readonly SpawnTask[]): SpawnBatchDetails {
  const used = new Set<string>();
  return {
    schema: "spine.spawn.view.v1",
    tasks: tasks.map((task, ordinal) => ({
      summary: task.summary.trim(),
      activityWord: assignActivityWord(ordinal, used),
      status: "running",
      diagnostic: null,
      memoryBody: null,
    })),
  };
}

export function applySpawnTerminal(view: SpawnBatchDetails, ordinal: number, terminal: SpawnResult): void {
  const task = view.tasks[ordinal];
  if (task === undefined) return;
  task.status = terminal.outcome;
  task.diagnostic = terminal.diagnostic === undefined || terminal.diagnostic === null ? null : terminal.diagnostic;
  task.memoryBody = terminal.memory_body;
}

export function markSpawnTask(view: SpawnBatchDetails, ordinal: number, status: SpawnTaskStatus, diagnostic: string | null): void {
  const task = view.tasks[ordinal];
  if (task === undefined) return;
  task.status = status;
  task.diagnostic = diagnostic;
}

export function spawnModelText(view: SpawnBatchDetails): string {
  const running = view.tasks.filter((task) => task.status === "running").length;
  const settled = view.tasks.length - running;
  if (running > 0) return `Spine Spawn ${settled}/${view.tasks.length} completed`;
  const failed = view.tasks.filter((task) => task.status === "errored" || task.status === "aborted").length;
  if (failed > 0) return `Spine Spawn ${view.tasks.length - failed}/${view.tasks.length} completed`;
  return `Spine Spawn completed ${view.tasks.length} child tasks`;
}

export function spawnFallbackText(view: SpawnBatchDetails): string {
  return view.tasks.map((task, index) => spawnPlainTaskLine(task, index + 1 === view.tasks.length)).join("\n");
}

export function renderSpawnCall(taskCount: number, theme: SpineTheme) {
  const count = taskCount === 1 ? "1 task" : `${taskCount} tasks`;
  return linesComponent([`${theme.fg("toolTitle", theme.bold("spine_spawn"))}  ${theme.fg("dim", count)}`]);
}

export function renderSpawnResult(view: SpawnBatchDetails, expanded: boolean, theme: SpineTheme) {
  const lines: string[] = [];
  view.tasks.forEach((task, index) => {
    const isLast = index + 1 === view.tasks.length;
    lines.push(themeSpawnTaskLine(task, isLast, theme));
    if (!expanded) return;
    for (const detail of spawnTaskDetails(task)) {
      lines.push(`${theme.fg("dim", isLast ? "      " : "  │   ")}${theme.fg("dim", detail)}`);
    }
  });
  return linesComponent(lines);
}

function spawnPlainTaskLine(task: SpawnTaskView, isLast: boolean): string {
  return `  ${isLast ? "└ " : "├ "}${statusMarker(task.status)} ${task.activityWord} ${task.summary}`;
}

function themeSpawnTaskLine(task: SpawnTaskView, isLast: boolean, theme: SpineTheme): string {
  const branch = theme.fg("dim", isLast ? "  └ " : "  ├ ");
  const marker = themeMarker(statusMarker(task.status), theme);
  const word = theme.fg("success", task.activityWord);
  return `${branch}${marker} ${word} ${task.summary}`;
}

function spawnTaskDetails(task: SpawnTaskView): string[] {
  if (task.status === "running") return [];
  const source = task.status === "completed" ? task.memoryBody : task.diagnostic ?? task.memoryBody;
  if (source === null || source.trim() === "") return [];
  const clipped = clipDetail(source.trim());
  return clipped.split("\n").map((line) => line.trimEnd());
}

function clipDetail(text: string): string {
  const lines = text.split("\n").slice(0, 4);
  const joined = lines.join("\n");
  if (joined.length <= 240) return joined;
  return `${joined.slice(0, 237).trimEnd()}...`;
}

function statusMarker(status: SpawnTaskStatus): string {
  switch (status) {
    case "running":
      return "◐";
    case "completed":
      return "✓";
    case "errored":
      return "×";
    case "aborted":
      return "!";
  }
}

function themeMarker(marker: string, theme: SpineTheme): string {
  switch (marker) {
    case "◐":
    case "◉":
      return theme.fg("success", theme.bold(marker));
    case "✓":
      return theme.fg("success", theme.bold(marker));
    case "×":
      return theme.fg("error", theme.bold(marker));
    case "!":
      return theme.fg("warning", theme.bold(marker));
    default:
      return theme.fg("dim", marker);
  }
}

function assignActivityWord(ordinal: number, used: Set<string>): string {
  const base = ACTIVITY_WORDS[ordinal % ACTIVITY_WORDS.length] ?? "Unfolding";
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let word = `Further ${base}`;
  while (used.has(word)) word = `Further ${word}`;
  used.add(word);
  return word;
}
