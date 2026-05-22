#!/usr/bin/env python3
"""Generate or edit images through the QingShuClaw logged-in backend proxy.

This script intentionally does not use OPENAI_API_KEY. In QingShuClaw it prefers
the local token proxy URL injected as QINGSHU_IMAGE_PROXY_BASE_URL, so the actual
user access token stays inside the desktop main process.
"""
from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import re
import sys
import time
import uuid
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any


SIZE_SHORTCUTS: dict[str, str] = {
    "1k": "1024x1024",
    "2k": "2048x2048",
    "4k": "3840x2160",
    "portrait": "1024x1536",
    "landscape": "1536x1024",
    "square": "1024x1024",
    "wide": "2048x1152",
    "tall": "2160x3840",
}

DEFAULT_MODEL = "gpt-image-2"
DEFAULT_SIZE = "1024x1024"
DEFAULT_MODERATION = "low"
DEFAULT_TIMEOUT_SECONDS = 600
GENERATION_PATH = "/images/generations"
GENERATION_JOB_PATH = "/images/jobs"
EDIT_PATH = "/images/edits"
QINGSHU_SERVER_PROVIDER_IDS = ("qingshu-server", "lobsterai-server")


def resolve_size(value: str) -> str:
    return SIZE_SHORTCUTS.get(value.lower(), value)


def slugify(text: str, max_len: int = 30) -> str:
    value = re.sub(r"[^\w\s-]", "", text.lower()).strip()
    value = re.sub(r"[-\s]+", "-", value)[:max_len]
    return value or "image"


def default_output_path(prompt: str, extension: str) -> Path:
    cwd = Path.cwd()
    target_dir = cwd / "fig" if (cwd / "fig").is_dir() else cwd
    stamp = datetime.now().strftime("%Y-%m-%d-%H-%M-%S")
    return target_dir / f"{stamp}-{slugify(prompt)}.{extension}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="qingshu-image",
        description="Call QingShuClaw image proxy for generations or edits.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("-p", "--prompt", help="Text prompt / edit instruction.")
    parser.add_argument(
        "-f",
        "--file",
        help="Output path. Auto-generated as YYYY-MM-DD-HH-MM-SS-<slug>.<ext> if omitted.",
    )
    parser.add_argument(
        "-i",
        "--image",
        action="append",
        type=Path,
        default=None,
        help="Reference image path. Repeat for multi-reference edits.",
    )
    parser.add_argument(
        "-m",
        "--mask",
        type=Path,
        default=None,
        help="Alpha-channel PNG mask. Edits endpoint only; requires -i.",
    )
    parser.add_argument("--model", default=DEFAULT_MODEL, help=f"Model ID (default {DEFAULT_MODEL}).")
    parser.add_argument(
        "--size",
        default=DEFAULT_SIZE,
        help="Image size. Accepts 1k, 2k, 4k, portrait, landscape, square, wide, tall, or literal size.",
    )
    parser.add_argument(
        "--quality",
        default="high",
        choices=["auto", "low", "medium", "high"],
        help="Rendering fidelity / budget knob. Default high.",
    )
    parser.add_argument("-n", "--n", type=int, default=1, help="Number of images to return. Default 1.")
    parser.add_argument("--background", default=None, choices=["auto", "opaque"], help="Background mode.")
    parser.add_argument(
        "--moderation",
        default=DEFAULT_MODERATION,
        choices=["auto", "low"],
        help="Generations only. Default low.",
    )
    parser.add_argument(
        "--input-fidelity",
        dest="input_fidelity",
        default=None,
        choices=["low", "high"],
        help="Edits only. Forwarded when supported by the selected model.",
    )
    parser.add_argument(
        "--format",
        dest="output_format",
        default=None,
        choices=["png", "jpeg", "webp"],
        help="Output encoding. Default png.",
    )
    parser.add_argument(
        "--compression",
        dest="output_compression",
        type=int,
        default=None,
        help="0-100 compression level for jpeg/webp. Ignored for png.",
    )
    parser.add_argument("--user", default=None, help="Optional end-user identifier forwarded to QingShu backend.")
    parser.add_argument(
        "--request-id",
        default=None,
        help="Optional request id for backend tracing. Auto-generated when omitted.",
    )
    parser.add_argument(
        "--submit-only",
        action="store_true",
        help="Submit an async generation job and print the job id without waiting for image bytes.",
    )
    parser.add_argument(
        "--job-id",
        default=None,
        help="Resume an existing async generation job and write its result to --file.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=DEFAULT_TIMEOUT_SECONDS,
        help=f"Request timeout in seconds. Default {DEFAULT_TIMEOUT_SECONDS}.",
    )
    return parser.parse_args()


def validate_args(args: argparse.Namespace) -> int:
    if args.mask and not args.image:
        print("error: --mask requires --image (edits endpoint only)", file=sys.stderr)
        return 2
    if args.n < 1:
        print("error: --n must be >= 1", file=sys.stderr)
        return 2
    if args.job_id and args.submit_only:
        print("error: --job-id cannot be used with --submit-only", file=sys.stderr)
        return 2
    if args.job_id and args.image:
        print("error: --job-id is only supported for generation jobs, not edits", file=sys.stderr)
        return 2
    if args.submit_only and args.image:
        print("error: --submit-only is only supported for generation jobs, not edits", file=sys.stderr)
        return 2
    if not args.job_id and not args.prompt:
        print("error: --prompt is required unless --job-id is provided", file=sys.stderr)
        return 2
    return 0


def filter_none(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if value is not None}


def is_loopback_url(value: str) -> bool:
    try:
        parsed = urllib.parse.urlparse(value)
    except ValueError:
        return False
    return parsed.scheme in ("http", "https") and parsed.hostname in ("127.0.0.1", "localhost", "::1")


def openclaw_config_candidates() -> list[Path]:
    candidates: list[Path] = []
    for key in ("OPENCLAW_CONFIG_PATH",):
        value = os.environ.get(key)
        if value and value.strip():
            candidates.append(Path(value.strip()).expanduser())

    for key in ("OPENCLAW_STATE_DIR",):
        value = os.environ.get(key)
        if value and value.strip():
            candidates.append(Path(value.strip()).expanduser() / "openclaw.json")

    for key in ("OPENCLAW_HOME",):
        value = os.environ.get(key)
        if value and value.strip():
            candidates.append(Path(value.strip()).expanduser() / "state" / "openclaw.json")

    home = Path.home()
    candidates.extend([
        home / "Library" / "Application Support" / "QingShuClaw" / "openclaw" / "state" / "openclaw.json",
        home / "Library" / "Application Support" / "LobsterAI" / "openclaw" / "state" / "openclaw.json",
        home / ".openclaw" / "openclaw.json",
    ])

    unique: list[Path] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = str(candidate)
        if key not in seen:
            seen.add(key)
            unique.append(candidate)
    return unique


def load_json_file(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def resolve_provider_base_url(config: dict[str, Any]) -> str | None:
    models = config.get("models")
    providers = models.get("providers") if isinstance(models, dict) else None
    if not isinstance(providers, dict):
        return None

    for provider_id in QINGSHU_SERVER_PROVIDER_IDS:
        provider = providers.get(provider_id)
        if not isinstance(provider, dict):
            continue
        for key in ("baseUrl", "baseURL", "base_url"):
            value = provider.get(key)
            if isinstance(value, str) and value.strip() and is_loopback_url(value.strip()):
                return value.strip().rstrip("/")
    return None


def resolve_base_url_from_openclaw_config() -> str | None:
    for candidate in openclaw_config_candidates():
        if not candidate.is_file():
            continue
        config = load_json_file(candidate)
        if not config:
            continue
        base_url = resolve_provider_base_url(config)
        if base_url:
            return base_url
    return None


def resolve_base_url() -> str | None:
    for key in ("QINGSHU_IMAGE_PROXY_BASE_URL", "QINGSHU_API_BASE_URL", "QTB_API_BASE_URL"):
        value = os.environ.get(key)
        if value and value.strip():
            return value.strip().rstrip("/")
    return resolve_base_url_from_openclaw_config()


def resolve_access_token() -> str | None:
    for key in ("QINGSHU_ACCESS_TOKEN", "QINGSHU_AUTH_TOKEN", "QTB_ACCESS_TOKEN"):
        value = os.environ.get(key)
        if value and value.strip():
            return value.strip()
    return None


def build_url(base_url: str, path: str) -> str:
    if base_url.endswith("/api/qingshu-claw/proxy/v1"):
        return f"{base_url}{path}"
    if base_url.endswith("/v1"):
        return f"{base_url}{path}"
    return f"{base_url}/api/qingshu-claw/proxy/v1{path}"


def http_json(url: str, payload: dict[str, Any], timeout: int) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    token = resolve_access_token()
    if token:
        headers["Authorization"] = f"Bearer {token}"
        headers["auth"] = f"Bearer {token}"
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    return read_json_response(request, timeout)


def http_get_json(url: str, timeout: int) -> dict[str, Any]:
    headers = {"Accept": "application/json"}
    token = resolve_access_token()
    if token:
        headers["Authorization"] = f"Bearer {token}"
        headers["auth"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers, method="GET")
    return read_json_response(request, timeout)


def guess_content_type(path: Path) -> str:
    guessed, _ = mimetypes.guess_type(str(path))
    return guessed or "application/octet-stream"


def encode_multipart(fields: dict[str, Any], files: list[tuple[str, Path]], boundary: str) -> bytes:
    chunks: list[bytes] = []
    for name, value in fields.items():
        if value is None:
            continue
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"))
        chunks.append(str(value).encode("utf-8"))
        chunks.append(b"\r\n")

    for name, path in files:
        filename = path.name.replace('"', "")
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(
            (
                f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'
                f"Content-Type: {guess_content_type(path)}\r\n\r\n"
            ).encode("utf-8")
        )
        chunks.append(path.read_bytes())
        chunks.append(b"\r\n")

    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(chunks)


def http_multipart(url: str, fields: dict[str, Any], files: list[tuple[str, Path]], timeout: int) -> dict[str, Any]:
    boundary = f"----QingShuImageBoundary{uuid.uuid4().hex}"
    body = encode_multipart(fields, files, boundary)
    headers = {
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Accept": "application/json",
    }
    token = resolve_access_token()
    if token:
        headers["Authorization"] = f"Bearer {token}"
        headers["auth"] = f"Bearer {token}"
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    return read_json_response(request, timeout)


def read_json_response(request: urllib.request.Request, timeout: int) -> dict[str, Any]:
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
    except urllib.error.HTTPError as error:
        raw = error.read()
        detail = raw.decode("utf-8", errors="replace")[:2000]
        print(f"error: QingShu image API returned HTTP {error.code}: {detail}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as error:
        print(f"error: QingShu image API request failed: {error}", file=sys.stderr)
        sys.exit(1)

    try:
        return json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError:
        preview = raw[:2000].decode("utf-8", errors="replace")
        print(f"error: QingShu image API returned non-JSON response: {preview}", file=sys.stderr)
        sys.exit(1)


def build_generation_payload(args: argparse.Namespace) -> dict[str, Any]:
    return filter_none({
        "model": args.model,
        "prompt": args.prompt,
        "size": resolve_size(args.size),
        "quality": args.quality,
        "n": args.n,
        "background": args.background,
        "moderation": args.moderation,
        "output_format": args.output_format,
        "output_compression": args.output_compression,
        "user": args.user,
        "request_id": args.request_id or str(uuid.uuid4()),
    })


def call_generate(base_url: str, args: argparse.Namespace) -> dict[str, Any]:
    payload = build_generation_payload(args)
    return call_generate_job(base_url, payload, args.timeout)


def unwrap_response_payload(result: dict[str, Any]) -> dict[str, Any]:
    payload = result.get("data") if isinstance(result.get("data"), dict) else result
    return payload if isinstance(payload, dict) else {}


def extract_job_id(payload: dict[str, Any]) -> str | None:
    job_id = payload.get("jobId") or payload.get("job_id") or payload.get("requestId")
    if isinstance(job_id, str) and job_id.strip():
        return job_id.strip()
    return None


def create_generate_job(base_url: str, payload: dict[str, Any], timeout: int) -> dict[str, Any] | None:
    try:
        create_result = http_json(build_url(base_url, GENERATION_JOB_PATH), payload, min(timeout, 30))
    except SystemExit:
        return None

    job_payload = unwrap_response_payload(create_result)
    if not extract_job_id(job_payload):
        return None
    return job_payload


def call_generate_job(base_url: str, payload: dict[str, Any], timeout: int) -> dict[str, Any]:
    job_payload = create_generate_job(base_url, payload, timeout)
    if not job_payload:
        return http_json(build_url(base_url, GENERATION_PATH), payload, timeout)

    job_id = extract_job_id(job_payload)
    if not job_id:
        return http_json(build_url(base_url, GENERATION_PATH), payload, timeout)

    return poll_generate_job(base_url, job_id, timeout)


def poll_generate_job(base_url: str, job_id: str, timeout: int) -> dict[str, Any]:
    deadline = time.time() + timeout
    status_url = build_url(base_url, f"{GENERATION_JOB_PATH}/{urllib.parse.quote(job_id.strip())}")
    last_status: dict[str, Any] = {}
    while time.time() < deadline:
        status_result = http_get_json(status_url, min(30, max(1, int(deadline - time.time()))))
        status_payload = unwrap_response_payload(status_result)
        if isinstance(status_payload, dict):
            last_status = status_payload
        status = str(last_status.get("status") or "").upper()
        if status == "SUCCESS":
            result = last_status.get("result")
            if isinstance(result, dict):
                return result
            print(f"error: image job succeeded without result: {json.dumps(last_status, ensure_ascii=False)[:2000]}", file=sys.stderr)
            sys.exit(1)
        if status == "FAILED":
            message = last_status.get("errorMessage") or last_status.get("error_code") or "image job failed"
            print(f"error: QingShu image job failed: {message}", file=sys.stderr)
            sys.exit(1)
        time.sleep(3)

    print(f"error: QingShu image job timed out: {json.dumps(last_status, ensure_ascii=False)[:2000]}", file=sys.stderr)
    sys.exit(1)


def print_submitted_job(job_payload: dict[str, Any], args: argparse.Namespace) -> int:
    job_id = extract_job_id(job_payload)
    if not job_id:
        print(f"error: image job submission returned no job id: {json.dumps(job_payload, ensure_ascii=False)[:2000]}", file=sys.stderr)
        return 1

    output_file = args.file or f"{job_id}.png"
    resume_command = (
        f"python3 {Path(__file__).resolve()} "
        f"--job-id {job_id} "
        f"--timeout {args.timeout} "
        f"-f {json.dumps(output_file, ensure_ascii=False)}"
    )
    print(f"jobId: {job_id}")
    print(f"status: {job_payload.get('status') or 'SUBMITTED'}")
    print(f"resume: {resume_command}")
    return 0


def call_edit(base_url: str, args: argparse.Namespace) -> dict[str, Any]:
    for image in args.image:
        if not image.is_file():
            print(f"error: --image not found: {image}", file=sys.stderr)
            sys.exit(2)
    if args.mask and not args.mask.is_file():
        print(f"error: --mask not found: {args.mask}", file=sys.stderr)
        sys.exit(2)

    fields = filter_none({
        "model": args.model,
        "prompt": args.prompt,
        "size": resolve_size(args.size),
        "quality": args.quality,
        "n": args.n,
        "background": args.background,
        "input_fidelity": args.input_fidelity,
        "output_format": args.output_format,
        "output_compression": args.output_compression,
        "user": args.user,
        "request_id": args.request_id or str(uuid.uuid4()),
    })
    files = [("image", image) for image in args.image]
    if args.mask:
        files.append(("mask", args.mask))
    return http_multipart(build_url(base_url, EDIT_PATH), fields, files, args.timeout)


def response_data(result: dict[str, Any]) -> list[dict[str, Any]]:
    data = result.get("data")
    if isinstance(data, dict) and isinstance(data.get("data"), list):
        data = data.get("data")
    if not isinstance(data, list):
        return []
    return [item for item in data if isinstance(item, dict)]


def write_outputs(data: list[dict[str, Any]], out_path: Path, n: int, timeout: int) -> list[Path]:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for index, item in enumerate(data):
        b64 = item.get("b64_json") or item.get("b64Json")
        url = item.get("url")
        if isinstance(b64, str) and b64:
            raw = base64.b64decode(b64)
        elif isinstance(url, str) and url:
            with urllib.request.urlopen(url, timeout=timeout) as response:
                raw = response.read()
        else:
            print(f"error: response item {index} has neither b64_json nor url", file=sys.stderr)
            sys.exit(1)

        if n == 1:
            target = out_path
        else:
            stem = out_path.with_suffix("")
            target = stem.parent / f"{stem.name}_{index}{out_path.suffix}"
        target.write_bytes(raw)
        written.append(target)
    return written


def main() -> int:
    args = parse_args()
    validation_code = validate_args(args)
    if validation_code:
        return validation_code

    base_url = resolve_base_url()
    if not base_url:
        print(
            "error: QingShu image proxy is not available. Missing QINGSHU_IMAGE_PROXY_BASE_URL and no local qingshu-server baseUrl was found in OpenClaw config. Please run this skill inside QingShuClaw after login.",
            file=sys.stderr,
        )
        return 2

    if args.submit_only:
        job_payload = create_generate_job(base_url, build_generation_payload(args), args.timeout)
        if not job_payload:
            print("error: QingShu image async job endpoint is not available.", file=sys.stderr)
            return 1
        return print_submitted_job(job_payload, args)

    extension = args.output_format or "png"
    output_hint = args.prompt or args.job_id or "qingshu-image-job"
    out_path = Path(args.file).expanduser().resolve() if args.file else default_output_path(output_hint, extension)
    if args.job_id:
        result = poll_generate_job(base_url, args.job_id, args.timeout)
    else:
        result = call_edit(base_url, args) if args.image else call_generate(base_url, args)
    data = response_data(result)
    if not data:
        print(f"error: no image data in response: {json.dumps(result, ensure_ascii=False)[:2000]}", file=sys.stderr)
        return 1

    for path in write_outputs(data, out_path, args.n, args.timeout):
        print(path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
