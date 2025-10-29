import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

export function computeVmaf(distFile, refFile, vmafModel, outJson) {
  execSync(
    `ffmpeg -hide_banner -r 30 -i "${distFile}" -r 30 -i "${refFile}" ` +
    `-lavfi "[0:v][1:v]libvmaf=model_path='${vmafModel}':log_fmt=json:log_path='${outJson}'" ` +
    `-f null -`,
    { stdio: "pipe", shell: "/bin/bash" }
  );
  const obj = JSON.parse(readFileSync(outJson,"utf8"));
  const score =
    (obj.global_metrics && obj.global_metrics.vmaf) ||
    (obj.aggregate && obj.aggregate.VMAF_score) ||
    (obj.VMAF_score) || 0;
  return score;
}
