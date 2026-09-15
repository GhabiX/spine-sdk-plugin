import { existsSync } from "node:fs";
import { basename } from "node:path";

export interface ProcessImage {
  execPath: string;
  execArgv: readonly string[];
  argv: readonly string[];
}

export interface PiInvocation {
  command: string;
  args: string[];
}

/**
 * Reconstruct the running Node/Bun image so a Spawn child can load TypeScript
 * the same way the parent did. Copy execArgv (tsx loaders, strip-types, …);
 * drop only inspector flags so a debug parent does not bind the same port.
 */
export function resolvePiInvocation(
  image: ProcessImage,
  exists: (path: string) => boolean = existsSync,
): PiInvocation {
  const script = image.argv[1];
  if (script !== undefined && !script.startsWith("/$bunfs/root/") && exists(script)) {
    return {
      command: image.execPath,
      args: [...childExecArgv(image.execArgv), script],
    };
  }
  const executable = basename(image.execPath).toLowerCase();
  return /^(node|bun)(\.exe)?$/.test(executable)
    ? { command: "pi", args: [] }
    : { command: image.execPath, args: [] };
}

function childExecArgv(execArgv: readonly string[]): string[] {
  const args: string[] = [];
  for (let i = 0; i < execArgv.length; i += 1) {
    const arg = execArgv[i]!;
    if (!isInspectorFlag(arg)) {
      args.push(arg);
      continue;
    }
    if (inspectorTakesSeparateValue(arg)) {
      const next = execArgv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        i += 1;
      }
    }
  }
  return args;
}

function isInspectorFlag(arg: string): boolean {
  return /^(?:--inspect(?:-brk|-port)?|--debug(?:-brk)?)(?:=.*)?$/.test(arg);
}

function inspectorTakesSeparateValue(arg: string): boolean {
  return arg === "--inspect-port";
}
