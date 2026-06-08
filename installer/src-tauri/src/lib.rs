// lib.rs
use mslnk::ShellLink;
use std::env;
use std::fs;
use std::io::{copy, Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use winreg::enums::*;
use winreg::RegKey;

const APP_NAME: &str = env!("INSTALLER_APP_NAME");
const APP_DISPLAY_NAME: &str = env!("INSTALLER_APP_DISPLAY_NAME");
const APP_PUBLISHER: &str = env!("INSTALLER_APP_PUBLISHER");
const APP_VERSION: &str = env!("INSTALLER_APP_VERSION");
const EXE_NAME: &str = env!("INSTALLER_EXE_NAME");
const APP_DESCRIPTION: &str = env!("INSTALLER_APP_DESCRIPTION");

#[derive(serde::Serialize)]
struct AppConfig {
    app_name: &'static str,
    app_display_name: &'static str,
    app_publisher: &'static str,
    app_version: &'static str,
    exe_name: &'static str,
    app_description: &'static str,
}

#[tauri::command]
fn get_app_config() -> AppConfig {
    AppConfig {
        app_name: APP_NAME,
        app_display_name: APP_DISPLAY_NAME,
        app_publisher: APP_PUBLISHER,
        app_version: APP_VERSION,
        exe_name: EXE_NAME,
        app_description: APP_DESCRIPTION,
    }
}

static PAYLOAD_BYTES: &[u8] = include_bytes!("../payload/payload.tar.zst");

// 空 payload 即视为"演示模式"——构建时未打包 Electron 产物，仅作 UI 预览。
fn is_demo_mode() -> bool {
    PAYLOAD_BYTES.is_empty()
}

// 通知 Shell 立即刷新（让开始菜单 / 搜索马上发现新快捷方式）
#[cfg(windows)]
fn notify_shell_changed(path: &Path) {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::{
        SHChangeNotify, SHCNE_CREATE, SHCNE_ASSOCCHANGED, SHCNF_PATHW, SHCNF_IDLIST,
    };
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    unsafe {
        SHChangeNotify(SHCNE_CREATE as i32, SHCNF_PATHW, wide.as_ptr() as *const _, std::ptr::null());
        SHChangeNotify(SHCNE_ASSOCCHANGED as i32, SHCNF_IDLIST, std::ptr::null(), std::ptr::null());
    }
}

#[cfg(not(windows))]
fn notify_shell_changed(_path: &Path) {}

// 计算目录大小（KB），用于写入卸载信息的 EstimatedSize
fn dir_size_kb(path: &Path) -> u64 {
    fn walk(p: &Path) -> u64 {
        let mut sum: u64 = 0;
        if let Ok(rd) = fs::read_dir(p) {
            for entry in rd.flatten() {
                if let Ok(ft) = entry.file_type() {
                    if ft.is_dir() {
                        sum += walk(&entry.path());
                    } else if let Ok(m) = entry.metadata() {
                        sum += m.len();
                    }
                }
            }
        }
        sum
    }
    walk(path) / 1024
}

// 创建带完整元数据的快捷方式（Windows 搜索 / 开始菜单要靠这些才能正确索引）
fn make_shortcut(target_exe: &Path, install_dir: &Path, lnk_path: &Path) -> Result<(), String> {
    let mut sl = ShellLink::new(target_exe).map_err(|e| format!("ShellLink::new: {e}"))?;
    sl.set_name(Some(APP_DISPLAY_NAME.to_string()));
    sl.set_working_dir(Some(install_dir.to_string_lossy().to_string()));
    sl.set_icon_location(Some(target_exe.to_string_lossy().to_string()));
    sl.create_lnk(lnk_path).map_err(|e| format!("create_lnk {}: {e}", lnk_path.display()))?;
    notify_shell_changed(lnk_path);
    Ok(())
}

// 写入「应用和功能」卸载信息
fn write_uninstall_registry(install_dir: &Path) -> std::io::Result<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let path = format!("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{}", APP_NAME);
    let (key, _) = hkcu.create_subkey(&path)?;

    let exe_path = install_dir.join(EXE_NAME);
    let install_dir_str = install_dir.to_string_lossy().to_string();

    key.set_value("DisplayName", &APP_DISPLAY_NAME)?;
    key.set_value("DisplayVersion", &APP_VERSION)?;
    key.set_value("Publisher", &APP_PUBLISHER)?;
    key.set_value("DisplayIcon", &exe_path.to_string_lossy().to_string())?;
    key.set_value("InstallLocation", &install_dir_str)?;
    key.set_value("EstimatedSize", &(dir_size_kb(install_dir) as u32))?;
    key.set_value("NoModify", &1u32)?;
    key.set_value("NoRepair", &1u32)?;

    // 卸载命令：删除快捷方式 + 安装目录 + 注册表自身
    let appdata = env::var("APPDATA").unwrap_or_default();
    let start_menu_lnk = format!(
        "{}\\Microsoft\\Windows\\Start Menu\\Programs\\{}.lnk",
        appdata, APP_NAME
    );
    let desktop_lnk_pattern = format!("$env:USERPROFILE + '\\Desktop\\{}.lnk'", APP_NAME);

    let uninstall_cmd = format!(
        "powershell.exe -NoProfile -WindowStyle Hidden -Command \"\
            Remove-Item -LiteralPath '{lnk}' -Force -ErrorAction SilentlyContinue; \
            Remove-Item -LiteralPath ({desk}) -Force -ErrorAction SilentlyContinue; \
            Remove-Item -LiteralPath '{dir}' -Recurse -Force -ErrorAction SilentlyContinue; \
            Remove-Item -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{name}' -Recurse -Force -ErrorAction SilentlyContinue\"",
        lnk = start_menu_lnk,
        desk = desktop_lnk_pattern,
        dir = install_dir_str,
        name = APP_NAME,
    );
    key.set_value("UninstallString", &uninstall_cmd)?;
    key.set_value("QuietUninstallString", &uninstall_cmd)?;
    Ok(())
}

#[tauri::command]
async fn run_installation(app: AppHandle, path: String) -> Result<(), String> {
    let install_dir = PathBuf::from(path);

    // 演示模式：未打包 payload，模拟 0→100 进度，不做任何文件写入
    if is_demo_mode() {
        thread::spawn(move || {
            let _ = app.emit("install-log", "演示模式：未打包 payload，仅模拟进度".to_string());
            for pct in 1u32..=100 {
                thread::sleep(Duration::from_millis(30));
                let _ = app.emit("install-progress", pct);
            }
        });
        return Ok(());
    }

    thread::spawn(move || {
        let emit_log = |msg: String| {
            let _ = app.emit("install-log", msg);
        };

        if install_dir.exists() {
            let _ = fs::remove_dir_all(&install_dir);
        }
        if let Err(e) = fs::create_dir_all(&install_dir) {
            emit_log(format!("创建安装目录失败: {e}"));
            return;
        }

        // 解压：先把 zstd 一次性解到内存，再用 tar 流式提取
        let mut tar_buf: Vec<u8> = Vec::new();
        {
            let mut zstd_reader = match zstd::stream::read::Decoder::new(Cursor::new(PAYLOAD_BYTES)) {
                Ok(d) => d,
                Err(e) => {
                    emit_log(format!("zstd 解码失败: {e}"));
                    return;
                }
            };
            if let Err(e) = zstd_reader.read_to_end(&mut tar_buf) {
                emit_log(format!("zstd 读取失败: {e}"));
                return;
            }
        }
        let total_uncompressed = tar_buf.len() as u64;

        let mut archive = tar::Archive::new(Cursor::new(&tar_buf));
        let entries = match archive.entries() {
            Ok(e) => e,
            Err(e) => {
                emit_log(format!("tar 读取失败: {e}"));
                return;
            }
        };

        let mut written: u64 = 0;
        let mut last_pct: u32 = 0;
        for entry_res in entries {
            let mut entry = match entry_res {
                Ok(e) => e,
                Err(_) => continue,
            };
            let rel_path = match entry.path() {
                Ok(p) => p.into_owned(),
                Err(_) => continue,
            };
            let outpath = install_dir.join(&rel_path);
            let entry_size = entry.size();

            let header_type = entry.header().entry_type();
            if header_type.is_dir() {
                let _ = fs::create_dir_all(&outpath);
            } else if header_type.is_file() {
                if let Some(p) = outpath.parent() {
                    let _ = fs::create_dir_all(p);
                }
                match fs::File::create(&outpath) {
                    Ok(mut outfile) => {
                        let _ = copy(&mut entry, &mut outfile);
                        let _ = outfile.flush();
                    }
                    Err(e) => {
                        emit_log(format!("写入 {} 失败: {e}", outpath.display()));
                    }
                }
            }
            written += entry_size;
            let pct = if total_uncompressed > 0 {
                (written * 95 / total_uncompressed) as u32
            } else {
                0
            };
            if pct != last_pct {
                last_pct = pct;
                let _ = app.emit("install-progress", pct);
            }
        }

        let target_exe = install_dir.join(EXE_NAME);
        if !target_exe.exists() {
            emit_log(format!("解压完成但找不到 {}，跳过快捷方式创建", EXE_NAME));
        } else {
            // 开始菜单快捷方式
            if let Ok(app_data) = env::var("APPDATA") {
                let start_menu_path = PathBuf::from(app_data)
                    .join("Microsoft")
                    .join("Windows")
                    .join("Start Menu")
                    .join("Programs");
                let _ = fs::create_dir_all(&start_menu_path);
                let lnk = start_menu_path.join(format!("{}.lnk", APP_NAME));
                if let Err(e) = make_shortcut(&target_exe, &install_dir, &lnk) {
                    emit_log(format!("开始菜单快捷方式失败: {e}"));
                } else {
                    emit_log("开始菜单快捷方式已创建".to_string());
                }
            } else {
                emit_log("读取 APPDATA 失败，跳过开始菜单快捷方式".to_string());
            }

            // 桌面快捷方式
            if let Ok(desktop) = app.path().desktop_dir() {
                let lnk = desktop.join(format!("{}.lnk", APP_NAME));
                if let Err(e) = make_shortcut(&target_exe, &install_dir, &lnk) {
                    emit_log(format!("桌面快捷方式失败: {e}"));
                }
            }
        }

        // 写注册表
        if let Err(e) = write_uninstall_registry(&install_dir) {
            emit_log(format!("写入卸载注册表失败: {e}"));
        }

        let _ = app.emit("install-progress", 100u32);
    });
    Ok(())
}

#[tauri::command]
fn default_install_dir(app: AppHandle) -> Result<String, String> {
    let base = app.path().local_data_dir().map_err(|e| e.to_string())?;
    Ok(base.join(APP_NAME).to_string_lossy().to_string())
}

#[tauri::command]
fn check_dir_status(path: String) -> Result<(bool, bool), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Ok((false, true));
    }
    if !p.is_dir() {
        return Ok((true, false));
    }
    match fs::read_dir(&p) {
        Ok(mut it) => Ok((true, it.next().is_none())),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn launch_app(app: AppHandle) -> Result<(), String> {
    // 优先从注册表 InstallLocation 读取真实安装路径
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let reg_path = format!("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{}", APP_NAME);
    let install_dir: Option<PathBuf> = hkcu
        .open_subkey(&reg_path)
        .ok()
        .and_then(|k| k.get_value::<String, _>("InstallLocation").ok())
        .map(PathBuf::from);

    let exe_path = match install_dir {
        Some(dir) => dir.join(EXE_NAME),
        None => app
            .path()
            .local_data_dir()
            .map_err(|e| e.to_string())?
            .join(APP_NAME)
            .join(EXE_NAME),
    };

    if exe_path.exists() {
        Command::new(&exe_path)
            .current_dir(exe_path.parent().unwrap_or(Path::new(".")))
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err(format!("找不到已安装的程序：{}", exe_path.display()))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            run_installation,
            launch_app,
            check_dir_status,
            get_app_config,
            default_install_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
