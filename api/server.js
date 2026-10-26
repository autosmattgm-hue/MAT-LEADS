import http from "node:http";
import { env } from "./config/env.js";
import { handleRequest } from "./nativeApp.js";
import { logger } from "./utils/logger.js";

const server = http.createServer((req, res) => {
  handleRequest(req, res);
});

server.listen(env.port, () => {
  logger.info("server_started", { url: `http://localhost:${env.port}` });
});

process.on("SIGTERM", () => {
  logger.info("server_stopping");
  server.close(() => process.exit(0));
});
