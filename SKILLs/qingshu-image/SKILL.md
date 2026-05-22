---
name: qingshu-image
description: "当用户要求用青数内置绘图模型生成、绘制、出图、改图、参考图编辑、局部重绘、海报、插画、UI mockup、中文文字图片或营销视觉时使用此 skill。必须通过 QingShuClaw 登录态下的青数后台图片代理调用，不直接调用 OpenAI，不要求用户提供 API Key。"
compatibility: "Requires Python 3.11+ and QingShuClaw logged-in runtime. The desktop app injects QINGSHU_IMAGE_PROXY_BASE_URL so requests use the current user's login token through the local token proxy."
metadata: {"openclaw":{"requires":{"anyBins":["python3","python"]},"primaryEnv":"QINGSHU_IMAGE_PROXY_BASE_URL"}}
---

# qingshu-image

青数专用绘图 skill。用于通过青数后台图片代理调用内置图片模型，支持文生图和参考图编辑。不要使用 `OPENAI_API_KEY`，不要让用户输入 API Key，也不要绕过 QingShuClaw 本地 token proxy。

## 工作流程

1. 判断任务类型：文生图、参考图编辑、局部重绘、多参考图合成。
2. 明确画面目标、文字内容、尺寸比例、质量档位、参考图路径和输出路径。
3. 调用本 skill 的脚本：

```bash
python3 "$SKILLS_ROOT/qingshu-image/scripts/generate.py" -p "PROMPT" [options]
```

如果运行环境只有 `python`：

```bash
python "$SKILLS_ROOT/qingshu-image/scripts/generate.py" -p "PROMPT" [options]
```

4. 返回生成文件的绝对路径，并简短说明本次使用的尺寸、质量和是否使用参考图。
5. 如果用户需要手机查看、外部访问、发送给他人、放到报告/消息里作为链接，必须继续调用 `qingshu_file_publish`，用生成文件的本地路径换取青数 `shareUrl`；不要把本地路径当作跨端访问链接。

长耗时文生图任务可以拆成两步，避免工具进程等待过久：

```bash
python3 "$SKILLS_ROOT/qingshu-image/scripts/generate.py" \
  -p "PROMPT" \
  --size portrait \
  --quality high \
  -f output.png \
  --submit-only
```

脚本会输出 `jobId` 和可恢复命令。之后用同一个 `jobId` 拉取并写入结果：

```bash
python3 "$SKILLS_ROOT/qingshu-image/scripts/generate.py" \
  --job-id "<jobId>" \
  --timeout 600 \
  -f output.png
```

如果一次性生成命令被外层工具超时中断，但已经拿到 `jobId`，不要重新提交同一张图，优先用 `--job-id` 恢复查询。

## 认证与路由

- QingShuClaw 会注入 `QINGSHU_IMAGE_PROXY_BASE_URL`，通常形如 `http://127.0.0.1:<port>/v1`。
- 该本地代理会使用当前登录用户 token 转发到青数后台 `/api/qingshu-claw/proxy/v1/images/...`。
- 脚本兼容 `QINGSHU_ACCESS_TOKEN` / `QINGSHU_AUTH_TOKEN` / `QTB_ACCESS_TOKEN`，仅用于本地调试；正常应用内调用不需要也不应该传 token。
- 不打印、不记录、不回显任何 token。

## 常用命令

文生图：

```bash
python3 "$SKILLS_ROOT/qingshu-image/scripts/generate.py" \
  -p "一张青绿色科技风格的 SaaS 产品海报，中文标题为'青数智能绘图'，干净高级" \
  --size portrait \
  --quality high \
  -f output.png
```

参考图编辑：

```bash
python3 "$SKILLS_ROOT/qingshu-image/scripts/generate.py" \
  -p "保持主体构图，把背景改成明亮的青数品牌科技展厅" \
  -i input.png \
  --size 1k \
  --quality high \
  -f edited.png
```

局部重绘：

```bash
python3 "$SKILLS_ROOT/qingshu-image/scripts/generate.py" \
  -p "只替换透明区域，加入发光的数据看板" \
  -i input.png \
  -m mask.png \
  -f inpaint.png
```

生成后发布访问链接：

```json
{
  "filePath": "/absolute/path/to/generated.png"
}
```

使用工具：`qingshu_file_publish`。成功后把工具返回的 `shareUrl` 提供给用户；本地路径只作为本机文件定位信息。

## 参数

| 参数 | 取值 | 说明 |
|---|---|---|
| `-p, --prompt` | string | 必填，绘图或改图指令 |
| `-f, --file` | path | 输出路径；不填则自动命名 |
| `-i, --image` | repeatable path | 参考图；出现该参数时走编辑接口 |
| `-m, --mask` | PNG path | 局部重绘遮罩，需要同时提供 `-i` |
| `--model` | default `gpt-image-2` | 青数后台公开图片模型 ID |
| `--size` | `1k`, `2k`, `4k`, `portrait`, `landscape`, `square`, `wide`, `tall` 或实际尺寸 | 画布尺寸 |
| `--quality` | `low`, `medium`, `high`, `auto` | 成本/质量档位 |
| `-n, --n` | integer | 返回图片数量 |
| `--background` | `auto`, `opaque` | 背景模式 |
| `--moderation` | `auto`, `low` | 文生图审核强度 |
| `--format` | `png`, `jpeg`, `webp` | 输出格式 |
| `--compression` | `0-100` | JPEG/WebP 压缩率 |
| `--user` | string | 可选用户标识；默认不需要，后台以 token 用户为准 |
| `--submit-only` | flag | 只提交文生图异步任务并输出 `jobId`，不等待结果 |
| `--job-id` | string | 恢复已有文生图异步任务，成功后写入 `-f` 指定文件 |
| `--timeout` | seconds | 本次提交或恢复查询的最长等待时间，默认 600 秒 |

## 质量与尺寸建议

- 草图、多方案探索：`--quality low` 或 `medium`。
- 海报、中文文字、UI、图表、交付素材：`--quality high`。
- 默认正方形：`1k` / `1024x1024`。
- 手机海报、竖版视觉：`portrait`。
- 横向封面、产品图、场景图：`landscape`。
- 精修或论文/报告配图：`2k`。

## 错误处理

- 报 `QingShu image proxy is not available`：说明当前脚本不在 QingShuClaw 登录运行时内，或本地 token proxy 未启动。
- HTTP 401/403：通常是登录态失效；让用户重新登录 QingShuClaw 后重试。
- HTTP 402/429/余额相关错误：按青数后台返回内容提示用户降档、减少张数或充值。
- 参考图或 mask 不存在时，先让用户确认本地文件路径。
- `qingshu_file_publish` 返回未登录：让用户重新登录 QingShuClaw 后，再用同一个本地文件路径重试发布。
- `qingshu_file_publish` 返回文件过大：当前分享上传限制为 50MB，需要降低尺寸、压缩格式或只返回本地路径。
