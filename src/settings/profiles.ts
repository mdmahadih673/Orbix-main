export const PROFILE_KEYS = [
	"bloom-theme-mode",
	"bloom-theme-color",
	"bloom-theme-opacity",
	"bloom-notch-opacity",
	"bloom-dock-opacity",
	"bloom-theme-saturation",
	"bloom-theme-brightness",
	"bloom-notch-blur",
	"bloom-dock-blur",
	"bloom-time-format-24h",
	"bloom-clock-date-format",
	"bloom-clock-font",
	"bloom-clock-show-seconds",
	"bloom-clock-show-date",
	"bloom-status-widgets",
	"bloom-dock-mode",
	"bloom-dock-icon-only",
	"bloom-dock-adaptive",
	"bloom-weather-enabled",
	"bloom-music-mode-enabled",
	"bloom-calendar-enabled"
];

const PROFILE_DEFAULTS: Record<string, string> = {
	"bloom-theme-mode": "dark",
	"bloom-theme-color": "#6B5290",
	"bloom-theme-opacity": "0.58",
	"bloom-notch-opacity": "0.58",
	"bloom-dock-opacity": "0.58",
	"bloom-theme-saturation": "0.5",
	"bloom-theme-brightness": "0.15",
	"bloom-notch-blur": "24",
	"bloom-dock-blur": "24",
	"bloom-time-format-24h": "false",
	"bloom-clock-date-format": "short",
	"bloom-clock-font": "system",
	"bloom-clock-show-seconds": "false",
	"bloom-clock-show-date": "true",
	"bloom-status-widgets": JSON.stringify({ left: ["weather"], right: ["battery"] }),
	"bloom-dock-mode": "smart",
	"bloom-dock-icon-only": "false",
	"bloom-dock-adaptive": "false",
	"bloom-weather-enabled": "true",
	"bloom-music-mode-enabled": "true",
	"bloom-calendar-enabled": "true"
};

export const BUILTIN_PROFILES = [
	{ id: "work", label: "Work", description: "A clear clock with useful status widgets" },
	{ id: "focus", label: "Focus", description: "A quieter, minimal Orbix layout" },
	{ id: "gaming", label: "Gaming", description: "A bold, colorful glass setup" }
] as const;

export function saveCurrentProfile(profileId: string) {
	const snapshot: Record<string, string> = {};
	for (const key of PROFILE_KEYS) {
		const value = localStorage.getItem(key);
		snapshot[key] = value ?? PROFILE_DEFAULTS[key] ?? "";
	}
	localStorage.setItem(`bloom-profile-${profileId}`, JSON.stringify(snapshot));
}

export function hasSavedProfile(profileId: string) {
	return localStorage.getItem(`bloom-profile-${profileId}`) !== null;
}
