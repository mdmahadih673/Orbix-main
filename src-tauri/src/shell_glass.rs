use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use tauri::AppHandle;
use windows::core::{BOOL, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM};
use windows::Win32::Graphics::Dwm::{
    DwmGetWindowAttribute, DwmSetWindowAttribute, DWM_SYSTEMBACKDROP_TYPE, DWMSBT_AUTO,
    DWMSBT_TRANSIENTWINDOW, DWMWA_SYSTEMBACKDROP_TYPE,
};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetWindowThreadProcessId,
};

const SETTING_KEY: &str = "bloom-shell-glass-enabled";

static ENABLED: AtomicBool = AtomicBool::new(false);
static STYLED_WINDOWS: OnceLock<Mutex<HashMap<isize, DWM_SYSTEMBACKDROP_TYPE>>> = OnceLock::new();

#[derive(Default)]
struct WindowList(Vec<HWND>);

unsafe extern "system" fn collect_shell_window(hwnd: HWND, param: LPARAM) -> BOOL {
    let list = &mut *(param.0 as *mut WindowList);
    let mut class_name = [0u16; 128];
    let class_len = GetClassNameW(hwnd, &mut class_name);
    if class_len <= 0 {
        return BOOL(1);
    }
    let class_name = String::from_utf16_lossy(&class_name[..class_len as usize]);

    let is_explorer = class_name == "CabinetWClass" || class_name == "ExploreWClass";
    let is_taskbar = class_name == "Shell_TrayWnd" || class_name == "Shell_SecondaryTrayWnd";
    let is_start_menu_host = class_name == "Windows.UI.Core.CoreWindow"
        || class_name == "XamlExplorerHostIslandWindow"
        || class_name == "Windows.UI.Composition.DesktopWindowContentBridge";
    let is_start_menu = is_start_menu_host
        && !is_taskbar
        && process_name_for_window(hwnd)
            .is_some_and(|name| name.eq_ignore_ascii_case("StartMenuExperienceHost.exe"));

    if is_explorer || is_taskbar || is_start_menu {
        list.0.push(hwnd);
    }
    BOOL(1)
}

unsafe fn process_name_for_window(hwnd: HWND) -> Option<String> {
    let mut process_id = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut process_id));
    if process_id == 0 {
        return None;
    }

    let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id).ok()?;
    let mut path = [0u16; 1024];
    let mut path_len = path.len() as u32;
    let result = QueryFullProcessImageNameW(
        process,
        PROCESS_NAME_FORMAT(0),
        PWSTR(path.as_mut_ptr()),
        &mut path_len,
    );
    let _ = CloseHandle(process);
    result.ok()?;

    String::from_utf16(&path[..path_len as usize])
        .ok()?
        .rsplit(['\\', '/'])
        .next()
        .map(str::to_string)
}

fn shell_windows() -> Vec<HWND> {
    let mut list = WindowList::default();
    unsafe {
        let _ = EnumWindows(
            Some(collect_shell_window),
            LPARAM(&mut list as *mut WindowList as isize),
        );
    }
    list.0
}

fn get_backdrop(hwnd: HWND) -> Option<DWM_SYSTEMBACKDROP_TYPE> {
    let mut backdrop = DWMSBT_AUTO;
    unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_SYSTEMBACKDROP_TYPE,
            &mut backdrop as *mut _ as *mut _,
            std::mem::size_of_val(&backdrop) as u32,
        )
    }
    .ok()?;
    Some(backdrop)
}

fn set_backdrop(hwnd: HWND, backdrop: DWM_SYSTEMBACKDROP_TYPE) -> bool {
    unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_SYSTEMBACKDROP_TYPE,
            &backdrop as *const _ as *const _,
            std::mem::size_of_val(&backdrop) as u32,
        )
    }
    .is_ok()
}

fn apply_to_current_windows(enabled: bool) {
    let windows = shell_windows();
    let styled = STYLED_WINDOWS.get_or_init(|| Mutex::new(HashMap::new()));
    let Ok(mut styled) = styled.lock() else {
        return;
    };

    if enabled {
        let current: HashSet<isize> = windows.iter().map(|hwnd| hwnd.0 as isize).collect();
        styled.retain(|hwnd, _| current.contains(hwnd));
        for hwnd in windows {
            let key = hwnd.0 as isize;
            if !styled.contains_key(&key) {
                let original = get_backdrop(hwnd).unwrap_or(DWMSBT_AUTO);
                if set_backdrop(hwnd, DWMSBT_TRANSIENTWINDOW) {
                    styled.insert(key, original);
                }
            }
        }
    } else {
        for (raw, original) in std::mem::take(&mut *styled) {
            let _ = set_backdrop(HWND(raw as *mut _), original);
        }
    }
}

pub fn start_monitor(app: AppHandle) {
    std::thread::spawn(move || loop {
        let enabled = crate::utils::get_setting_str(&app, SETTING_KEY)
            .is_none_or(|value| value == "true");
        let previous = ENABLED.swap(enabled, Ordering::Relaxed);
        if previous != enabled {
            apply_to_current_windows(enabled);
        } else if enabled {
            apply_to_current_windows(true);
        }
        std::thread::sleep(Duration::from_millis(900));
    });
}

pub fn set_enabled(enabled: bool) {
    ENABLED.store(enabled, Ordering::Relaxed);
    apply_to_current_windows(enabled);
}

pub fn restore_on_exit() {
    ENABLED.store(false, Ordering::Relaxed);
    apply_to_current_windows(false);
}
