import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import orbixMask from "../assets/orbix-mask.svg";
import "./OrbixMask.css";

type OrbixMaskProps = {
	className?: string;
};

export function OrbixMask({ className = "" }: OrbixMaskProps) {
	const maskRef = useRef<HTMLSpanElement>(null);
	const gazeLeftRef = useRef<SVGGElement>(null);
	const gazeRightRef = useRef<SVGGElement>(null);

	useEffect(() => {
		let active = true;
		let windowX = 0;
		let windowY = 0;
		let scaleFactor = 1;
		let unlisten: (() => void) | undefined;
		const currentWindow = getCurrentWindow();

		void Promise.all([currentWindow.outerPosition(), currentWindow.scaleFactor()])
			.then(([position, scale]) => {
				if (!active) return;
				windowX = position.x;
				windowY = position.y;
				scaleFactor = scale || 1;
			})
			.catch(() => {});

		void listen<{ x: number; y: number }>("orbix-global-cursor", (event) => {
			const rect = maskRef.current?.getBoundingClientRect();
			if (!rect || rect.width === 0 || rect.height === 0) return;

			const cursorX = (event.payload.x - windowX) / scaleFactor;
			const cursorY = (event.payload.y - windowY) / scaleFactor;
			const centerX = rect.left + rect.width / 2;
			const centerY = rect.top + rect.height / 2;
			const facingX = Math.max(-1, Math.min(1, (cursorX - centerX) / Math.max(window.innerWidth / 2, 1)));
			const facingY = Math.max(-1, Math.min(1, (cursorY - centerY) / Math.max(window.innerHeight / 2, 1)));
			maskRef.current?.style.setProperty("--mascot-turn-x", `${(-facingY * 18).toFixed(2)}deg`);
			maskRef.current?.style.setProperty("--mascot-turn-y", `${(facingX * 25).toFixed(2)}deg`);
			maskRef.current?.style.setProperty("--mascot-roll", `${(facingX * -5).toFixed(2)}deg`);
			const lookAt = (eye: SVGGElement | null, eyeX: number) => {
				if (!eye) return;
				const eyeScreenX = rect.left + rect.width * eyeX / 160;
				const eyeScreenY = rect.top + rect.height * 55 / 112;
				const dx = Math.max(-4, Math.min(4, (cursorX - eyeScreenX) / Math.max(window.innerWidth * .2, 1) * 4));
				const dy = Math.max(-3, Math.min(3, (cursorY - eyeScreenY) / Math.max(window.innerHeight * .2, 1) * 3));
				eye.setAttribute("transform", `translate(${dx.toFixed(2)} ${dy.toFixed(2)})`);
			};

			lookAt(gazeLeftRef.current, 63);
			lookAt(gazeRightRef.current, 101);
		}).then((stop) => {
			if (active) unlisten = stop;
			else stop();
		}).catch(() => {});

		return () => {
			active = false;
			unlisten?.();
		};
	}, []);

	return (
		<span ref={maskRef} className={`orbix-mask ${className}`.trim()} aria-hidden="true">
			<img src={orbixMask} alt="" draggable={false} />
			<svg className="orbix-mask-eyes" viewBox="0 0 160 112" focusable="false">
				<g ref={gazeLeftRef} className="orbix-mask-eye-gaze"><ellipse className="orbix-mask-eye orbix-mask-eye-left" cx="63" cy="55" rx="7" ry="11" /></g>
				<g ref={gazeRightRef} className="orbix-mask-eye-gaze"><ellipse className="orbix-mask-eye orbix-mask-eye-right" cx="101" cy="55" rx="7" ry="11" /></g>
				<circle className="orbix-mask-mouth-dot" cx="82" cy="80" r="2.3" />
				<g className="orbix-mask-mouth-bars">
					<rect className="orbix-mask-mouth-bar bar-1" x="62" y="74" width="4" height="8" rx="1.5" />
					<rect className="orbix-mask-mouth-bar bar-2" x="69" y="68" width="4" height="14" rx="1.5" />
					<rect className="orbix-mask-mouth-bar bar-3" x="76" y="59" width="4" height="23" rx="1.5" />
					<rect className="orbix-mask-mouth-bar bar-4" x="83" y="55" width="4" height="27" rx="1.5" />
					<rect className="orbix-mask-mouth-bar bar-5" x="90" y="63" width="4" height="19" rx="1.5" />
					<rect className="orbix-mask-mouth-bar bar-6" x="97" y="70" width="4" height="12" rx="1.5" />
				<rect className="orbix-mask-mouth-bar bar-7" x="104" y="75" width="4" height="7" rx="1.5" />
				</g>
			</svg>
		</span>
	);
}
