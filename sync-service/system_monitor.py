"""System metrics (CPU / RAM / GPU) for the monitor gadget.

CPU and memory come from psutil. GPU usage is read from nvidia-smi when it is
available on PATH; on machines without an NVIDIA GPU (or without the driver
tools) the ``gpu`` block reports ``available: False`` and the gadget hides its
GPU chart.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import time

import psutil

# Prime the CPU counter so the first real reading reflects usage since startup
# rather than returning 0.0 for the whole interval.
psutil.cpu_percent(interval=None)

_NVIDIA_SMI = shutil.which("nvidia-smi")
_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0

# nvidia-smi spawns a process per call; cache briefly so rapid polls (or several
# clients) do not pile up subprocesses.
_GPU_CACHE_TTL = 1.0
_gpu_cache: dict | None = None
_gpu_cache_at = 0.0


def _query_gpu() -> dict:
    if not _NVIDIA_SMI:
        return {"available": False}

    try:
        result = subprocess.run(
            [
                _NVIDIA_SMI,
                "--query-gpu=utilization.gpu,utilization.memory,memory.used,memory.total,name",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=4,
            creationflags=_NO_WINDOW,
        )
        line = result.stdout.strip().splitlines()[0]
        util, _mem_util, mem_used, mem_total, name = (part.strip() for part in line.split(","))
        mem_used_mb = float(mem_used)
        mem_total_mb = float(mem_total)
        return {
            "available": True,
            "percent": float(util),
            "memPercent": round(mem_used_mb / mem_total_mb * 100, 1) if mem_total_mb else 0.0,
            "memUsedMb": mem_used_mb,
            "memTotalMb": mem_total_mb,
            "name": name,
        }
    except Exception:
        return {"available": False}


def _get_gpu() -> dict:
    global _gpu_cache, _gpu_cache_at
    now = time.monotonic()
    if _gpu_cache is not None and (now - _gpu_cache_at) < _GPU_CACHE_TTL:
        return _gpu_cache
    _gpu_cache = _query_gpu()
    _gpu_cache_at = now
    return _gpu_cache


def get_system_metrics() -> dict:
    memory = psutil.virtual_memory()
    return {
        "cpu": {
            "percent": psutil.cpu_percent(interval=None),
            "cores": psutil.cpu_count(logical=True),
        },
        "memory": {
            "percent": memory.percent,
            "usedGb": round(memory.used / 1e9, 2),
            "totalGb": round(memory.total / 1e9, 2),
        },
        "gpu": _get_gpu(),
    }
