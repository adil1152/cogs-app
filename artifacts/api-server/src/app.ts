import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import path from "path";
import pinoHttp from "pino-http";
import { fileURLToPath } from "url";
import { logger } from "./lib/logger";
import { authMiddleware } from "./middlewares/authMiddleware";
import router from "./routes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(authMiddleware);


app.use("/api", router);

// Serve static assets for the cogs-tracker frontend
const frontendPath = path.resolve(__dirname, "../../cogs-tracker/dist/public");
app.use(express.static(frontendPath));

// Fallback for React Router (Single Page Application)
app.use((req, res, next) => {
  if (req.method === "GET" && req.accepts("html")) {
    res.sendFile(path.join(frontendPath, "index.html"));
  } else {
    next();
  }
});

export default app;
