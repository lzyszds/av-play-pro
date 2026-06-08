use std::fs;
use std::path::PathBuf;

fn main() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let config_path = manifest_dir
        .parent()
        .expect("no parent dir")
        .join("installer.config.json");

    // 默认值（找不到配置文件时使用，保证能编译）
    let mut app_name = "App".to_string();
    let mut app_display_name = "App".to_string();
    let mut app_publisher = "Unknown".to_string();
    let mut app_version = "1.0.0".to_string();
    let mut exe_name = "app.exe".to_string();
    let mut app_description = "Installer".to_string();

    if config_path.exists() {
        let raw = fs::read_to_string(&config_path).expect("read installer.config.json");
        let v: serde_json::Value = serde_json::from_str(&raw).expect("parse installer.config.json");
        if let Some(s) = v.get("appName").and_then(|x| x.as_str()) { app_name = s.into(); }
        if let Some(s) = v.get("appDisplayName").and_then(|x| x.as_str()) { app_display_name = s.into(); }
        if let Some(s) = v.get("appPublisher").and_then(|x| x.as_str()) { app_publisher = s.into(); }
        if let Some(s) = v.get("appVersion").and_then(|x| x.as_str()) { app_version = s.into(); }
        if let Some(s) = v.get("exeName").and_then(|x| x.as_str()) { exe_name = s.into(); }
        if let Some(s) = v.get("appDescription").and_then(|x| x.as_str()) { app_description = s.into(); }
        println!("cargo:rerun-if-changed={}", config_path.display());
    }

    println!("cargo:rustc-env=INSTALLER_APP_NAME={}", app_name);
    println!("cargo:rustc-env=INSTALLER_APP_DISPLAY_NAME={}", app_display_name);
    println!("cargo:rustc-env=INSTALLER_APP_PUBLISHER={}", app_publisher);
    println!("cargo:rustc-env=INSTALLER_APP_VERSION={}", app_version);
    println!("cargo:rustc-env=INSTALLER_EXE_NAME={}", exe_name);
    println!("cargo:rustc-env=INSTALLER_APP_DESCRIPTION={}", app_description);

    // 确保 payload 文件存在，否则 include_bytes! 会让 Rust 编译失败。
    // 缺失时创建空文件 → 运行时进入"演示模式"（仅展示 UI 与动效，不执行安装逻辑）。
    // include_bytes!("../payload/payload.tar.zst") 在 src/lib.rs 中是相对
    // src/ 解析的，所以真实路径是 src-tauri/payload/payload.tar.zst
    let payload_dir = manifest_dir.join("payload");
    let payload_file = payload_dir.join("payload.tar.zst");
    if !payload_file.exists() {
        let _ = fs::create_dir_all(&payload_dir);
        let _ = fs::write(&payload_file, b"");
        println!(
            "cargo:warning=payload/payload.tar.zst 缺失，已创建空文件进入演示模式（仅 UI 预览）。"
        );
    }
    println!("cargo:rerun-if-changed={}", payload_file.display());

    tauri_build::build()
}
