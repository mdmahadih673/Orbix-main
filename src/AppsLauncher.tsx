import { useEffect, useMemo, useRef, useState } from "react";
import { emitTo } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Search, X } from "lucide-react";
import type { AppInfo } from "./dockApps";
import { initTheme } from "./theme";
import "./AppsLauncher.css";

const appWindow = getCurrentWebviewWindow();

export function AppsLauncher() {
	const [apps, setApps] = useState<AppInfo[]>([]);
	const [icons, setIcons] = useState<Record<string, string>>({});
	const [query, setQuery] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [loading, setLoading] = useState(true);
	const inputRef = useRef<HTMLInputElement>(null);
	const gridRef = useRef<HTMLDivElement>(null);
	const requestedIcons = useRef(new Set<string>());

	useEffect(() => initTheme("settings"), []);

	useEffect(() => {
		let unlisten: (() => void) | undefined;
		void appWindow.onFocusChanged(({ payload: focused }) => {
			if (!focused) void appWindow.hide();
		}).then((stop) => { unlisten = stop; });
		return () => unlisten?.();
	}, []);

	useEffect(() => {
		void invoke<AppInfo[]>("get_installed_apps")
			.then((result) => setApps(result.filter((app) => app.path !== "start").sort((a, b) => a.name.localeCompare(b.name))))
			.catch((error) => console.error("Could not load installed apps:", error))
			.finally(() => setLoading(false));
		requestAnimationFrame(() => inputRef.current?.focus());
	}, []);

	const filteredApps = useMemo(() => {
		const needle = query.trim().toLowerCase();
		return needle ? apps.filter((app) => app.name.toLowerCase().includes(needle)) : apps;
	}, [apps, query]);

	useEffect(() => {
		setSelectedIndex(0);
		gridRef.current?.scrollTo({ top: 0 });
	}, [query]);

	useEffect(() => {
		const grid = gridRef.current;
		if (!grid || filteredApps.length === 0) return;
		let active = true;
		const loadIcon = (path: string) => {
			if (requestedIcons.current.has(path)) return;
			requestedIcons.current.add(path);
			const appName = filteredApps.find((app) => app.path === path)?.name;
			void invoke<string | null>("get_app_icon", { path, name: appName })
				.then((icon) => {
					if (active && icon) setIcons((current) => ({ ...current, [path]: icon }));
				})
				.catch(() => {});
		};

		if (typeof IntersectionObserver !== "undefined") {
			const observer = new IntersectionObserver((entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						const path = (entry.target as HTMLElement).dataset.appPath;
						if (path) loadIcon(path);
						observer.unobserve(entry.target);
					}
				}
			}, { root: grid, rootMargin: "100px" });
		grid.querySelectorAll<HTMLElement>("[data-app-path]").forEach((node) => observer.observe(node));
			return () => { active = false; observer.disconnect(); };
		}
		filteredApps.slice(0, 25).forEach((app) => loadIcon(app.path));
		return () => { active = false; };
	}, [filteredApps]);

	const close = () => void appWindow.hide();
	const launch = async (app: AppInfo) => {
		await emitTo("dock", "apps-launch-selected", app);
		close();
	};

	const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Escape") {
			event.preventDefault();
			close();
		} else if (event.key === "ArrowDown") {
			event.preventDefault();
			setSelectedIndex((index) => Math.min(index + 1, filteredApps.length - 1));
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			setSelectedIndex((index) => Math.max(index - 1, 0));
		} else if (event.key === "Enter" && filteredApps[selectedIndex]) {
			event.preventDefault();
			void launch(filteredApps[selectedIndex]);
		}
	};

	useEffect(() => {
		gridRef.current?.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`)?.scrollIntoView({ block: "nearest" });
	}, [selectedIndex]);

	return (
		<main className="apps-launcher-window">
			<header className="apps-launcher-header">
				<div className="apps-launcher-title">Apps</div>
				<div className="apps-launcher-search">
					<Search size={15} strokeWidth={1.8} />
					<input
						ref={inputRef}
						value={query}
						placeholder="Search apps"
						aria-label="Search installed apps"
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={handleKeyDown}
					/>
					{query && <button className="apps-search-clear" onClick={() => setQuery("")} aria-label="Clear search"><X size={13} /></button>}
				</div>
				<button className="apps-launcher-close" onClick={close} aria-label="Close Apps"><X size={14} /></button>
			</header>
			<div className="apps-launcher-grid" ref={gridRef}>
				{loading ? (
					<div className="apps-launcher-empty">Loading apps…</div>
				) : filteredApps.length ? (
					filteredApps.map((app, index) => (
						<button
							key={`${app.path}:${app.name}`}
							className={`apps-launcher-card${index === selectedIndex ? " selected" : ""}`}
							data-index={index}
							data-app-path={app.path}
							onMouseEnter={() => setSelectedIndex(index)}
							onClick={() => void launch(app)}
						>
							<span className="apps-launcher-icon">
				{icons[app.path] || app.icon ? (
					<img src={icons[app.path] || app.icon!} alt="" draggable={false} />
				) : (
					<span>{app.name.slice(0, 1).toUpperCase()}</span>
				)}
							</span>
							<span className="apps-launcher-name">{app.name}</span>
						</button>
					))
				) : (
					<div className="apps-launcher-empty">No apps found</div>
				)}
			</div>
			<footer className="apps-launcher-footer">{filteredApps.length} apps <span>Esc to close</span></footer>
		</main>
	);
}
