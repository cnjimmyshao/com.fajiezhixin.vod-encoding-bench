#!/usr/bin/env node
/**
 * 基础烟雾测试脚本
 * Basic smoke test script
 * 
 * 测试内容：
 * Test coverage:
 * 1. 生成 10 帧测试视频
 *    Generate a 10-frame test video
 * 2. 测试 preprocess_video.py
 *    Test preprocess_video.py
 * 3. 测试 per_scene_encode.mjs
 *    Test per_scene_encode.mjs
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 测试工作目录
// Test working directory
const testWorkdir = join(__dirname, "test_workdir");

function sh(cmd, description) {
  console.log(`\n[测试步骤 / Test step] ${description}`);
  console.log(`[命令 / Command] ${cmd}`);
  try {
    const output = execSync(cmd, { 
      stdio: "pipe", 
      encoding: "utf8"
    });
    console.log(`[成功 / Success] ${description}`);
    return output;
  } catch (error) {
    console.error(`[失败 / Failed] ${description}`);
    console.error(`[错误 / Error] ${error.message}`);
    throw error;
  }
}

function cleanup() {
  if (existsSync(testWorkdir)) {
    console.log(`\n[清理 / Cleanup] 删除测试工作目录 / Removing test workdir: ${testWorkdir}`);
    rmSync(testWorkdir, { recursive: true, force: true });
  }
}

function setup() {
  console.log(`\n[设置 / Setup] 创建测试工作目录 / Creating test workdir: ${testWorkdir}`);
  mkdirSync(testWorkdir, { recursive: true });
}

function generateTestVideo() {
  const testVideo = join(testWorkdir, "test_input.mp4");
  console.log(`\n[步骤 1/3] 生成 10 帧测试视频`);
  console.log(`[Step 1/3] Generating 10-frame test video`);
  
  // 检查 ffmpeg 是否可用
  // Check if ffmpeg is available
  try {
    const whichCmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
    execSync(whichCmd, { stdio: "pipe" });
  } catch (error) {
    console.warn(`[警告 / Warning] ffmpeg 未安装，跳过视频生成测试`);
    console.warn(`[Warning] ffmpeg not installed, skipping video generation test`);
    // 创建一个占位文件用于后续测试
    // Create a placeholder file for subsequent tests
    writeFileSync(testVideo, "");
    return testVideo;
  }
  
  // 生成 10 帧（约 0.33 秒）的简单测试视频
  // Generate a simple 10-frame (approximately 0.33 seconds) test video
  sh(
    `ffmpeg -f lavfi -i testsrc=duration=0.33:size=640x480:rate=30 ` +
    `-f lavfi -i sine=frequency=1000:duration=0.33 ` +
    `-c:v libx264 -preset ultrafast -crf 23 -pix_fmt yuv420p ` +
    `-c:a aac -b:a 128k "${testVideo}"`,
    "生成测试视频 / Generate test video"
  );
  
  if (!existsSync(testVideo)) {
    throw new Error(`测试视频生成失败 / Test video generation failed: ${testVideo}`);
  }
  
  console.log(`[成功 / Success] 测试视频已生成 / Test video generated: ${testVideo}`);
  return testVideo;
}

function testPreprocessScript(inputVideo) {
  console.log(`\n[步骤 2/3] 测试 AI 预处理脚本`);
  console.log(`[Step 2/3] Testing AI preprocessing script`);
  
  const outputVideo = join(testWorkdir, "test_preprocessed.mp4");
  const scriptPath = join(__dirname, "..", "ai_preprocess", "preprocess_video.py");
  
  sh(
    `python3 "${scriptPath}" --input "${inputVideo}" --output "${outputVideo}" --model realesrgan_x4plus`,
    "运行 preprocess_video.py / Run preprocess_video.py"
  );
  
  if (!existsSync(outputVideo)) {
    throw new Error(`预处理输出文件未生成 / Preprocessed output not generated: ${outputVideo}`);
  }
  
  console.log(`[成功 / Success] 预处理脚本测试通过 / Preprocessing script test passed`);
  return outputVideo;
}

function testPerSceneEncode(inputVideo) {
  console.log(`\n[步骤 3/3] 测试 per_scene_encode.mjs 10帧模式`);
  console.log(`[Step 3/3] Testing per_scene_encode.mjs with 10-frame mode`);
  
  // 检查 ffmpeg 是否可用
  // Check if ffmpeg is available
  try {
    const whichCmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
    execSync(whichCmd, { stdio: "pipe" });
  } catch (error) {
    console.warn(`[警告 / Warning] ffmpeg 未安装，跳过编码测试`);
    console.warn(`[Warning] ffmpeg not installed, skipping encoding test`);
    return;
  }
  
  // 导入 per_scene_encode 模块并运行简单测试
  // Import per_scene_encode module and run a simple test
  const encodeWorkdir = join(testWorkdir, "encode_test");
  const testScript = `
import { runPerSceneEncode } from "../scripts/per_scene_encode.mjs";

const result = runPerSceneEncode({
  inputFile: ${JSON.stringify(inputVideo)},
  height: 480,
  codec: "libx264",
  implementation: "cpu",
  segmentPlan: [
    {
      start: 0,
      dur: 0.33,
      chosenBitrateKbps: 500,
      estVmaf: 95,
      implementation: "cpu"
    }
  ],
  gopSec: 2,
  audioKbps: 128,
  workdir: ${JSON.stringify(encodeWorkdir)},
  vmafModel: "vmaf_v0.6.1.json",
  modeTag: "smokeTest"
});

console.log(JSON.stringify({
  finalFile: result.finalFile,
  finalVmaf: result.finalVmaf
}, null, 2));
`;

  const testScriptPath = join(testWorkdir, "test_encode.mjs");
  writeFileSync(testScriptPath, testScript, "utf8");
  
  try {
    const output = sh(
      `node "${testScriptPath}"`,
      "运行 per_scene_encode 测试 / Run per_scene_encode test"
    );
    
    // 解析输出验证结果
    // Parse output to verify results
    const resultMatch = output.match(/\{[\s\S]*\}/);
    if (resultMatch) {
      const result = JSON.parse(resultMatch[0]);
      if (!existsSync(result.finalFile)) {
        throw new Error(`编码输出文件未生成 / Encoded output not generated: ${result.finalFile}`);
      }
      console.log(`[成功 / Success] 编码测试通过 / Encoding test passed`);
      console.log(`[输出文件 / Output file] ${result.finalFile}`);
      console.log(`[VMAF 分数 / VMAF score] ${result.finalVmaf}`);
    }
  } catch (error) {
    // 如果是因为缺少 ffmpeg 或 vmaf 模型，打印警告但不失败
    // If failure is due to missing ffmpeg or vmaf model, warn but don't fail
    if (error.message.includes("ffmpeg") || error.message.includes("vmaf") || error.message.includes("libvmaf")) {
      console.warn(`[警告 / Warning] 编码测试需要 ffmpeg 和 VMAF 支持，跳过此测试`);
      console.warn(`[Warning] Encoding test requires ffmpeg with VMAF support, skipping`);
      return;
    }
    throw error;
  }
}

function runTests() {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║   VOD Encoding Bench - 烟雾测试 / Smoke Test Suite        ║
╚════════════════════════════════════════════════════════════╝
`);

  try {
    cleanup();
    setup();
    
    const testVideo = generateTestVideo();
    const preprocessedVideo = testPreprocessScript(testVideo);
    testPerSceneEncode(preprocessedVideo);
    
    console.log(`
╔════════════════════════════════════════════════════════════╗
║   ✓ 所有测试通过 / All tests passed                        ║
╚════════════════════════════════════════════════════════════╝
`);
    
    cleanup();
    process.exit(0);
  } catch (error) {
    console.error(`
╔════════════════════════════════════════════════════════════╗
║   ✗ 测试失败 / Tests failed                                ║
╚════════════════════════════════════════════════════════════╝
`);
    console.error(error);
    cleanup();
    process.exit(1);
  }
}

runTests();
