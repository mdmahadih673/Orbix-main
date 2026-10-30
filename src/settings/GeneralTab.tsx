import { Power, Download, Clock, BatteryWarning, RefreshCw, RotateCcw, LogOut, CalendarDays, Type } from "lucide-react";
import { SettingRow } from "./SettingRow";

interface GeneralTabProps {
	autostart: boolean;
	toggleAutostart: () => void;
	timeFormat24h: boolean;
	toggleTimeFormat24h: () => void;
	clockDateFormat: string;
	setClockDateFormatValue: (value: string) => void;
	clockFont: string;
	setClockFontValue: (value: string) => void;
	clockShowSeconds: boolean;
	toggleClockShowSeconds: () => void;
	clockShowDate: boolean;
	toggleClockShowDate: () => void;
	showUpdateIndicator: boolean;
	toggleUpdateIndicator: () => void;
	lowBatteryThreshold: number;
	handleThresholdChange: (val: number) => void;
	restartBloom: () => void;
	resetToDefaults: () => void;
	quitBloom: () => void;
}

export function GeneralTab({
	autostart,
	toggleAutostart,
	timeFormat24h,
	toggleTimeFormat24h,
	clockDateFormat,
	setClockDateFormatValue,
	clockFont,
	setClockFontValue,
	clockShowSeconds,
	toggleClockShowSeconds,
	clockShowDate,
	toggleClockShowDate,
	showUpdateIndicator,
	toggleUpdateIndicator,
	lowBatteryThreshold,
	handleThresholdChange,
	restartBloom,
	resetToDefaults,
	quitBloom
}: GeneralTabProps) {
	return (
		<>
			<div className="setting-group-label">System</div>
			<div className="setting-group">
				<SettingRow icon={Power} label="Launch at Login" desc="Open Orbix automatically">
					<label className="toggle-switch">
						<input type="checkbox" checked={autostart} onChange={toggleAutostart} />
						<span className="slider"></span>
					</label>
				</SettingRow>

				<SettingRow
					icon={Download}
					label="Update Indicator"
					desc="Show green dot when update available"
				>
					<label className="toggle-switch">
						<input type="checkbox" checked={showUpdateIndicator} onChange={toggleUpdateIndicator} />
						<span className="slider"></span>
					</label>
				</SettingRow>

				<SettingRow icon={Clock} label="24-Hour Time" desc="Use 24-hour clock format">
					<label className="toggle-switch">
						<input type="checkbox" checked={timeFormat24h} onChange={toggleTimeFormat24h} />
						<span className="slider"></span>
					</label>
				</SettingRow>

				<SettingRow
					icon={BatteryWarning}
					label="Low Battery Alert"
					desc={`Trigger at ${lowBatteryThreshold}%`}
					divider={false}
				>
					<input
						type="range"
						min="5"
						max="50"
						step="5"
						value={lowBatteryThreshold}
						onChange={(e) => handleThresholdChange(parseInt(e.target.value))}
						className="settings-slider"
					/>
				</SettingRow>
			</div>

			<div className="setting-group-label">Clock</div>
			<div className="setting-group">
				<SettingRow icon={CalendarDays} label="Show Date" desc="Display the date beside the time">
					<label className="toggle-switch"><input type="checkbox" checked={clockShowDate} onChange={toggleClockShowDate} /><span className="slider" /></label>
				</SettingRow>
				{clockShowDate && <SettingRow icon={CalendarDays} label="Date Format" desc="Choose how the date appears">
					<select className="settings-select" value={clockDateFormat} onChange={(e) => setClockDateFormatValue(e.target.value)}>
						<option value="short">Oct 30</option><option value="weekday">Fri, Oct 30</option><option value="long">October 30, 2026</option><option value="numeric">10/30/2026</option>
					</select>
				</SettingRow>}
				<SettingRow icon={Clock} label="Show Seconds" desc="Include seconds in the clock">
					<label className="toggle-switch"><input type="checkbox" checked={clockShowSeconds} onChange={toggleClockShowSeconds} /><span className="slider" /></label>
				</SettingRow>
				<SettingRow icon={Type} label="Clock Font" desc="Choose the time and date typeface" divider={false}>
					<select className="settings-select" value={clockFont} onChange={(e) => setClockFontValue(e.target.value)}>
						<option value="system">System</option><option value="inter">Inter</option><option value="mono">Monospace</option>
					</select>
				</SettingRow>
			</div>

			<div className="setting-group-label">App</div>
			<div className="setting-group">
				<SettingRow
					icon={RotateCcw}
					label="Reset to Defaults"
					desc="Restore all settings and restart Orbix"
					action
					danger
					onClick={resetToDefaults}
				/>
				<SettingRow
					icon={RefreshCw}
					label="Restart Orbix"
					desc="Reinitialize all components"
					action
					onClick={restartBloom}
				/>
				<SettingRow
					icon={LogOut}
					label="Quit Orbix"
					desc="Exit application completely"
					action
					danger
					onClick={quitBloom}
					divider={false}
				/>
			</div>
		</>
	);
}
