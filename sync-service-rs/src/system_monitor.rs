use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use sysinfo::System;

static GPU_CACHE: Mutex<Option<(Instant, Value)>> = Mutex::new(None);

pub fn get_system_metrics() -> Value {
    let mut sys = System::new();
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    // Brief yield so cpu usage is meaningful on first call patterns
    std::thread::sleep(Duration::from_millis(50));
    sys.refresh_cpu_usage();

    let cpu_percent = sys.global_cpu_usage() as f64;
    let cores = sys.cpus().len();
    let total = sys.total_memory() as f64;
    let used = sys.used_memory() as f64;
    let mem_percent = if total > 0.0 {
        (used / total) * 100.0
    } else {
        0.0
    };

    json!({
        "cpu": {
            "percent": (cpu_percent * 10.0).round() / 10.0,
            "cores": cores,
        },
        "memory": {
            "percent": (mem_percent * 10.0).round() / 10.0,
            "usedGb": (used / 1e9 * 100.0).round() / 100.0,
            "totalGb": (total / 1e9 * 100.0).round() / 100.0,
        },
        "gpu": get_gpu(),
    })
}

fn get_gpu() -> Value {
    let mut cache = GPU_CACHE.lock().unwrap();
    if let Some((at, value)) = cache.as_ref() {
        if at.elapsed() < Duration::from_secs(1) {
            return value.clone();
        }
    }
    let value = query_gpu();
    *cache = Some((Instant::now(), value.clone()));
    value
}

fn query_gpu() -> Value {
    let mut command = Command::new("nvidia-smi");
    command.args([
        "--query-gpu=utilization.gpu,utilization.memory,memory.used,memory.total,name",
        "--format=csv,noheader,nounits",
    ]);
    crate::process_win::hide_console(&mut command);
    let output = command.output();

    let Ok(output) = output else {
        return json!({ "available": false });
    };
    if !output.status.success() {
        return json!({ "available": false });
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let Some(line) = stdout.lines().next() else {
        return json!({ "available": false });
    };
    let parts: Vec<&str> = line.split(',').map(|s| s.trim()).collect();
    if parts.len() < 5 {
        return json!({ "available": false });
    }
    let util: f64 = parts[0].parse().unwrap_or(0.0);
    let mem_used: f64 = parts[2].parse().unwrap_or(0.0);
    let mem_total: f64 = parts[3].parse().unwrap_or(0.0);
    let name = parts[4].to_string();
    let mem_percent = if mem_total > 0.0 {
        (mem_used / mem_total * 1000.0).round() / 10.0
    } else {
        0.0
    };
    json!({
        "available": true,
        "percent": util,
        "memPercent": mem_percent,
        "memUsedMb": mem_used,
        "memTotalMb": mem_total,
        "name": name,
    })
}
