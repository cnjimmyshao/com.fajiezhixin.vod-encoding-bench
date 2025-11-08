#!/usr/bin/env node
/**
 * 自适应码率搜索测试脚本
 * Adaptive bitrate search test script
 *
 * 对比传统线性探测和新的自适应搜索的效率
 * Compare efficiency between traditional linear probing and new adaptive search
 */

import { decideBitrateForSegment } from "./scripts/bitrate_probe.mjs";
import {
  detectScenes,
  buildSegments,
  getDurationSeconds,
} from "./scripts/scene_detect.mjs";
import { mkdirSync } from "node:fs";

console.log("\n╔════════════════════════════════════════════════════════════╗");
console.log("║   自适应码率搜索演示 / Adaptive Bitrate Search Demo      ║");
console.log("╚════════════════════════════════════════════════════════════╝\n");

const INPUT_FILE = "assets/sample.mpeg";
const TEST_TMP_DIR = "/tmp/adaptive_test";
const TARGET_VMAF = 95;

// 准备测试环境
mkdirSync(TEST_TMP_DIR, { recursive: true });

// 获取前3个片段进行测试
const totalDur = getDurationSeconds(INPUT_FILE);
const cuts = detectScenes(INPUT_FILE, 0.35);
const segments = buildSegments(cuts, totalDur, 4.0, 8.0).slice(0, 3); // 只测试前3个片段

console.log(`测试视频 / Test video: ${INPUT_FILE}`);
console.log(`片段数量 / Number of segments: ${segments.length}`);
console.log(`目标 VMAF / Target VMAF: ${TARGET_VMAF}\n`);

// 测试 1: 传统线性探测（禁用自适应搜索）
console.log("═══════════════════════════════════════════════════════════");
console.log("测试 1: 传统线性探测 / Test 1: Traditional Linear Probing");
console.log("═══════════════════════════════════════════════════════════\n");

const linearStart = Date.now();
let linearProbes = 0;

for (let i = 0; i < segments.length; i++) {
  const seg = segments[i];
  console.log(
    `\n片段 ${i + 1}/${segments.length} [${seg.start.toFixed(
      2
    )}s-${seg.end.toFixed(2)}s]`
  );
  console.log(
    `Segment ${i + 1}/${segments.length} [${seg.start.toFixed(
      2
    )}s-${seg.end.toFixed(2)}s]`
  );

  const result = decideBitrateForSegment({
    inputFile: INPUT_FILE,
    start: seg.start,
    dur: seg.dur,
    height: 720,
    codec: "libx264",
    implementation: "cpu",
    probeBitratesKbps: [600, 800, 1000, 1500, 2500, 3500, 5000],
    gopSec: 2,
    audioKbps: 128,
    tmpDir: TEST_TMP_DIR + "/linear",
    vmafModel: "vmaf_v0.6.1.json",
    targetVmaf: TARGET_VMAF,
    useAdaptiveSearch: false, // 禁用自适应搜索
  });

  linearProbes += 7; // 固定探测7个码率
  console.log(
    `  结果 / Result: ${
      result.chosenBitrateKbps
    } kbps, VMAF=${result.estVmaf.toFixed(2)}`
  );
  console.log(`  探测次数 / Probes: 7 (固定 / fixed)`);
}

const linearTime = Date.now() - linearStart;

console.log("\n═══════════════════════════════════════════════════════════");
console.log("测试 2: 自适应码率搜索 / Test 2: Adaptive Bitrate Search");
console.log("═══════════════════════════════════════════════════════════\n");

const adaptiveStart = Date.now();
let adaptiveProbes = 0;
let previousResult = null;

for (let i = 0; i < segments.length; i++) {
  const seg = segments[i];
  console.log(
    `\n片段 ${i + 1}/${segments.length} [${seg.start.toFixed(
      2
    )}s-${seg.end.toFixed(2)}s]`
  );
  console.log(
    `Segment ${i + 1}/${segments.length} [${seg.start.toFixed(
      2
    )}s-${seg.end.toFixed(2)}s]`
  );

  if (previousResult) {
    console.log(
      `  参考前一片段 / Previous reference: ${
        previousResult.chosenBitrateKbps
      } kbps, VMAF=${previousResult.estVmaf.toFixed(2)}`
    );
  }

  const result = decideBitrateForSegment({
    inputFile: INPUT_FILE,
    start: seg.start,
    dur: seg.dur,
    height: 720,
    codec: "libx264",
    implementation: "cpu",
    probeBitratesKbps: [], // 自适应模式下不使用此参数
    gopSec: 2,
    audioKbps: 128,
    tmpDir: TEST_TMP_DIR + "/adaptive",
    vmafModel: "vmaf_v0.6.1.json",
    targetVmaf: TARGET_VMAF,
    previousSegmentResult: previousResult,
    useAdaptiveSearch: true, // 启用自适应搜索
  });

  adaptiveProbes += result.probesUsed || 0;
  console.log(
    `  结果 / Result: ${
      result.chosenBitrateKbps
    } kbps, VMAF=${result.estVmaf.toFixed(2)}`
  );
  console.log(`  探测次数 / Probes: ${result.probesUsed}`);

  previousResult = result;
}

const adaptiveTime = Date.now() - adaptiveStart;

// 性能对比总结
console.log("\n╔════════════════════════════════════════════════════════════╗");
console.log("║   性能对比总结 / Performance Comparison Summary           ║");
console.log("╚════════════════════════════════════════════════════════════╝\n");

console.log("传统线性探测 / Traditional Linear Probing:");
console.log(`  总探测次数 / Total probes: ${linearProbes}`);
console.log(
  `  总耗时 / Total time: ${(linearTime / 1000).toFixed(2)} 秒 / seconds`
);
console.log(
  `  平均每片段 / Average per segment: ${(
    linearProbes / segments.length
  ).toFixed(1)} 次探测 / probes\n`
);

console.log("自适应搜索 / Adaptive Search:");
console.log(`  总探测次数 / Total probes: ${adaptiveProbes}`);
console.log(
  `  总耗时 / Total time: ${(adaptiveTime / 1000).toFixed(2)} 秒 / seconds`
);
console.log(
  `  平均每片段 / Average per segment: ${(
    adaptiveProbes / segments.length
  ).toFixed(1)} 次探测 / probes\n`
);

const probeReduction = (
  ((linearProbes - adaptiveProbes) / linearProbes) *
  100
).toFixed(1);
const timeReduction = (
  ((linearTime - adaptiveTime) / linearTime) *
  100
).toFixed(1);

console.log("效率提升 / Efficiency Improvement:");
console.log(`  探测次数减少 / Probe reduction: ${probeReduction}%`);
console.log(`  时间节省 / Time saved: ${timeReduction}%\n`);

if (parseFloat(probeReduction) > 0) {
  console.log("✓ 自适应搜索成功减少了探测次数！");
  console.log("✓ Adaptive search successfully reduced probe count!\n");
} else {
  console.log("⚠ 自适应搜索未能减少探测次数，可能需要调整策略参数");
  console.log(
    "⚠ Adaptive search did not reduce probe count, strategy parameters may need adjustment\n"
  );
}
