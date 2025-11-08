import express from "express";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const defaultConfigPath = resolve(
  join(__dirname, "..", "configs", "experiment_matrix.json")
);
const webRoot = resolve(join(__dirname, "..", "web"));
const viewsRoot = resolve(join(__dirname, "..", "views"));
const workerPath = resolve(join(__dirname, "experiment_worker.mjs"));

const app = express();
app.set("views", viewsRoot);
app.set("view engine", "pug");
app.use(express.json());

const tasks = new Map();

function serializeTask(task) {
  return {
    id: task.id,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    inputFile: task.inputFile,
    options: task.options,
    summaryRows: task.summaryRows,
    summaryPath: task.summaryPath,
    summaryStreamPath: task.summaryStreamPath,
    error: task.error,
    logs: task.logs,
  };
}

function attachWorkerListeners(task, worker) {
  worker.on("message", (message) => {
    if (!message || typeof message !== "object") {
      return;
    }

    if (message.type === "summaryRow" && message.payload) {
      task.summaryRows.push(message.payload);
      task.updatedAt = new Date().toISOString();
    } else if (message.type === "log" && typeof message.message === "string") {
      task.logs.push({
        at: new Date().toISOString(),
        message: message.message,
      });
      task.updatedAt = new Date().toISOString();
    } else if (message.type === "done") {
      task.status = "completed";
      task.result = message.payload;
      if (message.payload) {
        task.summaryPath = message.payload.summaryPath;
        task.summaryStreamPath = message.payload.summaryStreamPath;
        if (Array.isArray(message.payload.summaryRows)) {
          task.summaryRows = message.payload.summaryRows;
        }
      }
      task.updatedAt = new Date().toISOString();
    } else if (message.type === "error") {
      task.status = "failed";
      task.error = message.error || { message: "unknown error" };
      task.updatedAt = new Date().toISOString();
    }
  });

  worker.on("error", (error) => {
    task.status = "failed";
    task.error = { message: error.message, stack: error.stack };
    task.updatedAt = new Date().toISOString();
  });

  worker.on("exit", (code) => {
    if (code !== 0 && task.status !== "failed" && task.status !== "completed") {
      task.status = "failed";
      task.error = {
        message: `worker exited with code ${code}`,
      };
      task.updatedAt = new Date().toISOString();
    }
    task.worker = undefined;
  });
}

app.get("/config", (req, res) => {
  try {
    const data = JSON.parse(readFileSync(defaultConfigPath, "utf8"));
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/experiments", (req, res) => {
  const list = Array.from(tasks.values()).map(serializeTask);
  res.json(list);
});

app.get("/", (req, res) => {
  res.render("index");
});

app.post("/experiments", (req, res) => {
  const { inputFile, configOverrides = {}, configPath } = req.body || {};
  if (!inputFile || typeof inputFile !== "string") {
    return res.status(400).json({ error: "inputFile is required" });
  }

  const taskId = randomUUID();
  const createdAt = new Date().toISOString();

  const options = {
    inputFile,
    configOverrides,
  };
  if (configPath && typeof configPath === "string") {
    options.configPath = configPath;
  }

  const worker = new Worker(workerPath, {
    workerData: { options },
  });

  const task = {
    id: taskId,
    status: "running",
    createdAt,
    updatedAt: createdAt,
    inputFile,
    options,
    summaryRows: [],
    summaryPath: null,
    summaryStreamPath: null,
    error: null,
    logs: [],
    worker,
  };
  tasks.set(taskId, task);

  attachWorkerListeners(task, worker);

  res.status(202).json({ id: taskId });
});

app.get("/experiments/:id", (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) {
    return res.status(404).json({ error: "experiment not found" });
  }
  res.json(serializeTask(task));
});

app.use(express.static(webRoot));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`实验服务已启动: http://localhost:${port}`);
});
