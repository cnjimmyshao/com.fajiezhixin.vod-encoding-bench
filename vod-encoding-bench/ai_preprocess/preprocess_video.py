"""
预处理脚本占位说明。
Placeholder description for the preprocessing script.

后续将集成 Real-ESRGAN、降噪、去块、超分 等模型。
Future work will integrate models such as Real-ESRGAN, denoising, deblocking, or super-resolution.

把原视频转成“更干净、更好压缩”的版本，然后输出到指定路径。
The goal is to transform the source video into a cleaner, easier-to-compress version and write it to the specified path.

伪接口约定：
Interface contract:
python preprocess_video.py --input in.mp4 --output enhanced.mp4 --model realesrgan_x4plus

当前先不实现推理细节，后续再填。
In this placeholder we omit inference details; real logic can be added later.
"""
import argparse
import shutil
from pathlib import Path

parser = argparse.ArgumentParser(description="AI 预处理占位脚本\nAI preprocessing placeholder script")
parser.add_argument("--input", required=True, help="输入视频路径。\nPath to the input video.")
parser.add_argument("--output", required=True, help="输出视频路径。\nPath to the output video.")
parser.add_argument("--model", default="realesrgan_x4plus", help="模型名称。\nModel identifier.")
args = parser.parse_args()

# 目前先直接复制，后面再接入真实的超分或降噪推理。
# Currently we simply copy; future versions can add real enhancement logic.
src_path = Path(args.input)
dst_path = Path(args.output)

if not src_path.exists():
    raise SystemExit(
        f"输入文件不存在: {src_path}\n"
        f"Input file not found: {src_path}"
    )

# 支持将输出写入尚未创建的目录。
# Allow writing into directories that do not exist yet.
dst_path.parent.mkdir(parents=True, exist_ok=True)

if src_path.resolve() == dst_path.resolve():
    print(
        f"[提示 / Info] 输入与输出文件相同，跳过复制: {src_path}"
    )
else:
    shutil.copyfile(src_path, dst_path)

print(
    f"[模拟] 已按模型 {args.model} 对 {src_path} 进行占位预处理 -> {dst_path}"
)
print(
    f"[Mock] Placeholder preprocessing applied with model {args.model} on {src_path} -> {dst_path}"
)
