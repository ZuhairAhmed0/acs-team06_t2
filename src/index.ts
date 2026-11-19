import "./config/dns.js";
import type { Server } from "node:http";

import { app } from "./app.js";
import { env } from "./config/env.js";
import { closeDatabasePool } from "./db/client.js";

const server = app.listen(env.PORT, () => {
  console.info(`Server listening on port ${env.PORT}`);
});

let isShuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.info(`Received ${signal}; shutting down.`);

  closeServer(server)
    .catch(() => {
      process.exitCode = 1;
    })
    .finally(() => {
      process.exit();
    });
}

async function closeServer(httpServer: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    httpServer.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  await closeDatabasePool();
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
