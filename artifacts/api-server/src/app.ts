import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { createProxyMiddleware } from "http-proxy-middleware";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());

const PYTHON_BACKEND = process.env.PYTHON_BACKEND_URL || "http://python-backend:8000";

const PYTHON_PREFIXES = [
  "/api/participants",
  "/api/sessions",
  "/api/alerts",
  "/api/compliance",
  "/api/ai",
  "/api/reports",
  "/api/plans",
  "/api/budget",
  "/api/admin",
  "/api/incidents",
  "/api/invitations",
  "/api/assignments",
];

// Proxy must be registered BEFORE body-parsing middleware so that
// express.json() does not consume the request body before it can be streamed.
app.use(
  createProxyMiddleware({
    target: PYTHON_BACKEND,
    changeOrigin: true,
    pathFilter: (path: string) =>
      PYTHON_PREFIXES.some(
        (prefix) =>
          path === prefix ||
          path.startsWith(prefix + "/") ||
          path.startsWith(prefix + "?"),
      ),
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
