import { parentPort, workerData } from "node:worker_threads";
import { runExperiment } from "../scripts/run_experiment.mjs";

async function main() {
  const options = workerData?.options || {};

  try {
    const result = await runExperiment({
      ...options,
      onSummaryRow: (row) => {
        parentPort?.postMessage({ type: "summaryRow", payload: row });
      },
      onLog: (message) => {
        parentPort?.postMessage({ type: "log", message });
      },
    });

    parentPort?.postMessage({ type: "done", payload: result });
  } catch (error) {
    parentPort?.postMessage({
      type: "error",
      error: {
        message: error.message,
        stack: error.stack,
      },
    });
  }
}

main();
