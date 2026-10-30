import { useState } from "react";
import { BriefcaseBusiness, Gamepad2, MoonStar, Save, Check } from "lucide-react";
import { BUILTIN_PROFILES, hasSavedProfile, saveCurrentProfile } from "./profiles";

const ICONS = { work: BriefcaseBusiness, focus: MoonStar, gaming: Gamepad2 };

export function ProfilesPanel({ onApply }: { onApply: (profileId: string) => Promise<void> }) {
	const [saved, setSaved] = useState(() =>
		Object.fromEntries(BUILTIN_PROFILES.map(({ id }) => [id, hasSavedProfile(id)])) as Record<string, boolean>
	);
	const [active, setActive] = useState<string | null>(null);

	const save = (id: string) => {
		saveCurrentProfile(id);
		setSaved((current) => ({ ...current, [id]: true }));
	};

	const apply = async (id: string) => {
		setActive(id);
		try {
			await onApply(id);
		} finally {
			setActive(null);
		}
	};

	return (
		<div className="profile-grid">
			{BUILTIN_PROFILES.map(({ id, label, description }) => {
				const Icon = ICONS[id];
				return (
					<div className="profile-card" key={id}>
						<div className="profile-card-heading">
							<span className={`profile-icon profile-icon-${id}`}><Icon size={15} /></span>
							<div><strong>{label}</strong><span>{description}</span></div>
						</div>
						<div className="profile-card-actions">
							<button type="button" onClick={() => save(id)} title={`Save current settings to ${label}`}>
								{saved[id] ? <Check size={12} /> : <Save size={12} />}{saved[id] ? "Saved" : "Save current"}
							</button>
							<button type="button" onClick={() => void apply(id)} disabled={!saved[id] || active !== null}>
								{active === id ? "Applying…" : "Apply"}
							</button>
						</div>
					</div>
				);
			})}
		</div>
	);
}
