import { existsSync } from "node:fs";

import { resolvePiInvocation } from "../dist/pi/invocation.js";

process.stdout.write(
  JSON.stringify(
    resolvePiInvocation(
      {
        execPath: process.execPath,
        execArgv: process.execArgv,
        argv: process.argv,
      },
      existsSync,
    ),
  ),
);
