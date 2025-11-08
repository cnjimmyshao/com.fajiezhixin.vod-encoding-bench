const form = document.getElementById("experiment-form");
const startButton = document.getElementById("startButton");
const statusCard = document.getElementById("statusCard");
const resultsCard = document.getElementById("resultsCard");
const taskIdEl = document.getElementById("taskId");
const taskStatusEl = document.getElementById("taskStatus");
const summaryPathEl = document.getElementById("summaryPath");
const resultsBody = document.getElementById("resultsBody");
const logList = document.getElementById("logList");

let pollTimer = null;
let activeTaskId = null;

async function loadDefaultConfig() {
  try {
    const response = await fetch("/config");
    if (!response.ok) {
      throw new Error(`加载配置失败: ${response.status}`);
    }
    const config = await response.json();
    populateForm(config);
  } catch (error) {
    console.error(error);
    alert("无法加载默认配置，请检查服务器日志。");
  }
}

function populateForm(config) {
  const setValue = (id, value) => {
    const input = document.getElementById(id);
    if (input) {
      input.value = value ?? "";
    }
  };

  if (!config) {
    return;
  }

  setValue("targetVmaf", config.targetVmaf);
  setValue("baselineCrf", config.baselineCrf);
  setValue("gopSec", config.gopSec);
  setValue("sceneThresh", config.sceneThresh);
  setValue("audioKbps", config.audioKbps);
  setValue("vmafModel", config.vmafModel);
  setValue("aiPreprocessModel", config.aiPreprocessModel);
  setValue("heightList", Array.isArray(config.heightList) ? config.heightList.join(", ") : "");
  setValue("codecs", Array.isArray(config.codecs) ? config.codecs.join(", ") : "");
  setValue(
    "implementations",
    Array.isArray(config.encoderImplementations)
      ? config.encoderImplementations.join(", ")
      : ""
  );
  setValue(
    "probeBitrates",
    Array.isArray(config.probeBitratesKbps)
      ? config.probeBitratesKbps.join(", ")
      : ""
  );
  setValue("modes", Array.isArray(config.modes) ? config.modes.join(", ") : "");
}

function parseNumberList(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((num) => Number.isFinite(num));
}

function parseStringList(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseNumber(value) {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  if (!trimmed) return undefined;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : undefined;
}

function collectPayload() {
  const formData = new FormData(form);
  const inputFile = (formData.get("inputFile") || "").toString().trim();
  if (!inputFile) {
    throw new Error("请输入输入视频路径");
  }

  const overrides = {};

  const targetVmaf = parseNumber(formData.get("targetVmaf"));
  if (targetVmaf !== undefined) overrides.targetVmaf = targetVmaf;

  const baselineCrf = parseNumber(formData.get("baselineCrf"));
  if (baselineCrf !== undefined) overrides.baselineCrf = baselineCrf;

  const gopSec = parseNumber(formData.get("gopSec"));
  if (gopSec !== undefined) overrides.gopSec = gopSec;

  const sceneThresh = parseNumber(formData.get("sceneThresh"));
  if (sceneThresh !== undefined) overrides.sceneThresh = sceneThresh;

  const audioKbps = parseNumber(formData.get("audioKbps"));
  if (audioKbps !== undefined) overrides.audioKbps = audioKbps;

  const vmafModel = (formData.get("vmafModel") || "").toString().trim();
  if (vmafModel) overrides.vmafModel = vmafModel;

  const aiPreprocessModel = (formData.get("aiPreprocessModel") || "").toString().trim();
  if (aiPreprocessModel) overrides.aiPreprocessModel = aiPreprocessModel;

  const heightList = parseNumberList(formData.get("heightList"));
  if (heightList.length > 0) overrides.heightList = heightList;

  const codecs = parseStringList(formData.get("codecs"));
  if (codecs.length > 0) overrides.codecs = codecs;

  const implementations = parseStringList(formData.get("implementations"));
  if (implementations.length > 0) overrides.encoderImplementations = implementations;

  const probeBitrates = parseNumberList(formData.get("probeBitrates"));
  if (probeBitrates.length > 0) overrides.probeBitratesKbps = probeBitrates;

  const modes = parseStringList(formData.get("modes"));
  if (modes.length > 0) overrides.modes = modes;

  return {
    inputFile,
    configOverrides: overrides,
  };
}

function setFormEnabled(enabled) {
  startButton.disabled = !enabled;
  form.querySelectorAll("input, button").forEach((el) => {
    el.disabled = !enabled && el !== startButton;
  });
}

function renderLogs(logs) {
  logList.innerHTML = "";
  if (!Array.isArray(logs)) {
    return;
  }
  const recent = logs.slice(-50);
  for (const entry of recent) {
    const li = document.createElement("li");
    li.textContent = `${entry.at ?? ""} ${entry.message ?? ""}`.trim();
    logList.appendChild(li);
  }
}

function renderSummaryRows(rows) {
  resultsBody.innerHTML = "";
  if (!Array.isArray(rows)) {
    return;
  }
  for (const row of rows) {
    const tr = document.createElement("tr");

    const cells = [
      row.mode,
      row.codec,
      row.implementation,
      row.height ? `${row.height}p` : "",
      row.finalVmaf !== undefined ? row.finalVmaf.toFixed(2) : "",
      row.avgBitrateKbps !== undefined ? row.avgBitrateKbps.toFixed(1) : "",
      row.encodingEfficiency !== undefined
        ? row.encodingEfficiency.toFixed(2)
        : "",
      row.outputFile || "",
    ];

    for (const value of cells) {
      const td = document.createElement("td");
      td.textContent = value ?? "";
      tr.appendChild(td);
    }

    resultsBody.appendChild(tr);
  }
}

async function fetchTask(id) {
  const response = await fetch(`/experiments/${id}`);
  if (!response.ok) {
    throw new Error(`获取任务状态失败: ${response.status}`);
  }
  return response.json();
}

function updateTaskView(task) {
  statusCard.hidden = false;
  resultsCard.hidden = false;

  taskIdEl.textContent = task.id;
  taskStatusEl.textContent = task.status;
  summaryPathEl.textContent = task.summaryPath || "-";

  renderLogs(task.logs);
  renderSummaryRows(task.summaryRows);

  if (task.status === "completed" || task.status === "failed") {
    clearInterval(pollTimer);
    pollTimer = null;
    setFormEnabled(true);
    if (task.status === "failed" && task.error?.message) {
      alert(`任务失败: ${task.error.message}`);
    }
  }
}

async function startPolling(id) {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  const tick = async () => {
    try {
      const task = await fetchTask(id);
      updateTaskView(task);
    } catch (error) {
      console.error(error);
      clearInterval(pollTimer);
      pollTimer = null;
      setFormEnabled(true);
      alert(error.message);
    }
  };

  await tick();
  pollTimer = setInterval(tick, 3000);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = collectPayload();
    setFormEnabled(false);
    startButton.textContent = "运行中...";

    const response = await fetch("/experiments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `启动任务失败: ${response.status}`);
    }

    const data = await response.json();
    activeTaskId = data.id;
    taskIdEl.textContent = activeTaskId;
    taskStatusEl.textContent = "running";
    summaryPathEl.textContent = "-";
    logList.innerHTML = "";
    resultsBody.innerHTML = "";
    statusCard.hidden = false;
    resultsCard.hidden = false;

    await startPolling(activeTaskId);
  } catch (error) {
    alert(error.message);
    setFormEnabled(true);
  } finally {
    startButton.textContent = "启动实验";
  }
});

window.addEventListener("load", () => {
  loadDefaultConfig();
});
