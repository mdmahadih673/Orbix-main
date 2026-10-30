import { useEffect, useRef, useState } from "react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { preferredSpeechVoice } from "./speechVoice";
import { Bot, Bug, Check, Code2, FileSearch, FolderOpen, KeyRound, LoaderCircle, MessageCircle, Mic, MicOff, Power, Send, Sparkles, Volume2, VolumeX, X } from "lucide-react";
import "./Assistant.css";

type SearchFile = { name: string; path: string; is_dir: boolean; ext?: string | null };
type AssistantAction = { type: "search_files" | "open_file"; query: string } | { type: "launch_app"; name: string } | { type: "open_url"; url: string } | { type: "set_volume"; volume: number } | { type: "diagnose_workspace" } | { type: "write_workspace_file"; path: string; content: string };
type WebCitation = { title?: string | null; uri?: string | null };
type AssistantReply = { reply: string; action?: AssistantAction | null; sources?: WebCitation[] };
type WorkspaceDiagnostics = { command: string; exitCode: number | null; output: string };
type ChatMessage = { role: "user" | "assistant"; text: string; action?: AssistantAction | null; files?: SearchFile[]; sources?: WebCitation[]; diagnostics?: WorkspaceDiagnostics };
type VoiceStatus = "off" | "connecting" | "listening" | "speaking";
type MicDevice = { deviceId: string; label: string };
type WakeRecognition = {
	continuous: boolean;
	interimResults: boolean;
	lang: string;
	onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
	onerror: ((event: { error?: string }) => void) | null;
	onend: (() => void) | null;
	start: () => void;
	stop: () => void;
};
type WakeRecognitionConstructor = new () => WakeRecognition;

export default function Assistant() {
	const [hasKey, setHasKey] = useState(false);
	const [replacingKey, setReplacingKey] = useState(false);
	const [apiKey, setApiKey] = useState("");
	const [acknowledged, setAcknowledged] = useState(() => localStorage.getItem("orbix-assistant-google-consent-v2") === "true");
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [input, setInput] = useState("");
	const [busy, setBusy] = useState(false);
	const [voiceReplies, setVoiceReplies] = useState(true);
	const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("off");
	const [wakeWordEnabled, setWakeWordEnabled] = useState(() => localStorage.getItem("lulu-wake-word-enabled") !== "false");
	const [voiceCaption, setVoiceCaption] = useState("");
	const [micLevel, setMicLevel] = useState(0);
	const [micDevices, setMicDevices] = useState<MicDevice[]>([]);
	const [selectedMic, setSelectedMic] = useState(() => localStorage.getItem("orbix-assistant-mic-device") ?? "");
	const [microphoneDenied, setMicrophoneDenied] = useState(false);
	const [error, setError] = useState("");
	const [workspacePath, setWorkspacePath] = useState(() => localStorage.getItem("orbix-assistant-workspace") ?? "");
	const [shareWorkspace, setShareWorkspace] = useState(() => localStorage.getItem("orbix-assistant-share-workspace") === "true");
	const bottomRef = useRef<HTMLDivElement>(null);
	const liveSocketRef = useRef<WebSocket | null>(null);
	const liveStreamRef = useRef<MediaStream | null>(null);
	const audioContextRef = useRef<AudioContext | null>(null);
	const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
	const inputProcessorRef = useRef<ScriptProcessorNode | null>(null);
	const mutedInputGainRef = useRef<GainNode | null>(null);
	const audioSourcesRef = useRef(new Set<AudioBufferSourceNode>());
	const audioPlayheadRef = useRef(0);
	const liveUserTranscriptRef = useRef("");
	const liveAssistantTranscriptRef = useRef("");
	const transcriptFlushTimerRef = useRef<number | null>(null);
	const voiceGenerationRef = useRef(0);
	const wakeRecognitionRef = useRef<WakeRecognition | null>(null);
	const setAssistantConsent = (value: boolean) => {
		setAcknowledged(value);
		localStorage.setItem("orbix-assistant-google-consent-v2", String(value));
	};
	const chooseWorkspace = async () => {
		try {
			const selected = await openDialog({ directory: true, multiple: false, title: "Select a VS Code project folder" });
			if (typeof selected === "string") {
				setWorkspacePath(selected);
				localStorage.setItem("orbix-assistant-workspace", selected);
			}
		} catch (e) { setError(String(e)); }
	};
	const setWorkspaceSharing = (enabled: boolean) => {
		setShareWorkspace(enabled);
		localStorage.setItem("orbix-assistant-share-workspace", String(enabled));
	};

	const refreshMicrophones = async (requestLabels = false) => {
		if (!navigator.mediaDevices?.enumerateDevices) return;
		try {
			let devices = await navigator.mediaDevices.enumerateDevices();
			if (requestLabels && devices.some((device) => device.kind === "audioinput" && !device.label)) {
				const temporaryStream = await navigator.mediaDevices.getUserMedia({ audio: true });
				temporaryStream.getTracks().forEach((track) => track.stop());
				devices = await navigator.mediaDevices.enumerateDevices();
			}
			setMicDevices(devices.filter((device) => device.kind === "audioinput").map((device, index) => ({
				deviceId: device.deviceId,
				label: device.label || `Microphone ${index + 1}`
			})));
		} catch (e) {
			if (requestLabels) setError(`Microphone list পাওয়া যায়নি: ${String(e)}`);
		}
	};
	useEffect(() => { invoke<boolean>("assistant_has_key").then(setHasKey).catch(() => setHasKey(false)); }, []);
	useEffect(() => {
		void refreshMicrophones();
		const mediaDevices = navigator.mediaDevices;
		if (!mediaDevices?.addEventListener) return;
		const update = () => { void refreshMicrophones(); };
		mediaDevices.addEventListener("devicechange", update);
		return () => mediaDevices.removeEventListener("devicechange", update);
	}, []);
	useEffect(() => {
		const activity = voiceStatus === "speaking" ? "speaking" : busy || voiceStatus !== "off" ? "working" : "idle";
		void emit("assistant-activity", activity).catch(() => {});
	}, [busy, voiceStatus]);
	useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);
	useEffect(() => {
		if (!wakeWordEnabled || !acknowledged || !hasKey || voiceStatus !== "off" || busy) return;
		const speechWindow = window as Window & { SpeechRecognition?: WakeRecognitionConstructor; webkitSpeechRecognition?: WakeRecognitionConstructor };
		const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
		if (!Recognition) {
			setError("এই Windows WebView-তে wake-word speech recognition নেই। Lulu চালু করতে mic button ব্যবহার করুন।");
			return;
		}
		const recognition = new Recognition();
		recognition.continuous = true;
		recognition.interimResults = true;
		recognition.lang = "en-US";
		wakeRecognitionRef.current = recognition;
		recognition.onresult = (event) => {
			for (let index = event.resultIndex; index < event.results.length; index++) {
				const phrase = event.results[index][0]?.transcript ?? "";
				if (/\b(lulu|loo\s*loo)\b|লুলু/i.test(phrase)) {
					setError("");
					setVoiceCaption("Lulu ডেকেছেন · সংযোগ হচ্ছে…");
					wakeRecognitionRef.current = null;
					recognition.stop();
					void invoke("assistant_open").catch((error) => setError(String(error)));
					void startVoiceChat();
					return;
				}
			}
		};
		recognition.onerror = (event) => {
			if (event.error && event.error !== "no-speech" && event.error !== "aborted") {
				setError(`Lulu wake word শুনতে পারেনি (${event.error})। Microphone permission ও Windows default microphone দেখুন।`);
				if (event.error === "not-allowed" || event.error === "service-not-allowed") {
					wakeRecognitionRef.current = null;
					setWakeWordEnabled(false);
					localStorage.setItem("lulu-wake-word-enabled", "false");
				}
			}
		};
		recognition.onend = () => {
			if (wakeRecognitionRef.current !== recognition) return;
			window.setTimeout(() => {
				if (wakeRecognitionRef.current !== recognition) return;
				try { recognition.start(); } catch { /* the browser may already have restarted recognition */ }
			}, 250);
		};
		try {
			recognition.start();
			setError("");
		} catch (e) {
			wakeRecognitionRef.current = null;
			setError(`Lulu wake word চালু হয়নি: ${String(e)}`);
		}
		return () => {
			if (wakeRecognitionRef.current === recognition) wakeRecognitionRef.current = null;
			try { recognition.stop(); } catch { /* recognition already stopped */ }
		};
	}, [wakeWordEnabled, acknowledged, hasKey, voiceStatus, busy]);

	const speak = (text: string) => {
		if (!voiceReplies || !("speechSynthesis" in window)) return;
		window.speechSynthesis.cancel();
		const utterance = new SpeechSynthesisUtterance(text);
		utterance.lang = /[\u0980-\u09FF]/.test(text) ? "bn-BD" : "en-US";
		utterance.rate = 0.96;
		utterance.onstart = () => { void emit("assistant-activity", "speaking").catch(() => {}); };
		const finishSpeaking = () => { void emit("assistant-activity", "idle").catch(() => {}); };
		utterance.onend = finishSpeaking;
		utterance.onerror = finishSpeaking;
		const femaleVoice = preferredSpeechVoice(utterance.lang);
		if (femaleVoice) utterance.voice = femaleVoice;
		window.speechSynthesis.speak(utterance);
	};

	const releaseVoiceAudio = () => {
		inputProcessorRef.current?.disconnect();
		inputSourceRef.current?.disconnect();
		mutedInputGainRef.current?.disconnect();
		inputProcessorRef.current = null;
		inputSourceRef.current = null;
		mutedInputGainRef.current = null;
		liveStreamRef.current?.getTracks().forEach((track) => track.stop());
		liveStreamRef.current = null;
		for (const source of audioSourcesRef.current) { try { source.stop(); } catch { /* already stopped */ } }
		audioSourcesRef.current.clear();
		const context = audioContextRef.current;
		audioContextRef.current = null;
		if (context && context.state !== "closed") void context.close();
	};

	const stopVoiceChat = () => {
		voiceGenerationRef.current += 1;
		const socket = liveSocketRef.current;
		liveSocketRef.current = null;
		if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "Voice chat ended by user");
		if (transcriptFlushTimerRef.current !== null) window.clearTimeout(transcriptFlushTimerRef.current);
		transcriptFlushTimerRef.current = null;
		liveUserTranscriptRef.current = "";
		liveAssistantTranscriptRef.current = "";
		releaseVoiceAudio();
		setVoiceStatus("off");
		setVoiceCaption("");
		setMicLevel(0);
	};

	const flushLiveTranscript = (delay = 500) => {
		if (transcriptFlushTimerRef.current !== null) window.clearTimeout(transcriptFlushTimerRef.current);
		transcriptFlushTimerRef.current = window.setTimeout(() => {
			const userText = liveUserTranscriptRef.current.trim();
			const assistantText = liveAssistantTranscriptRef.current.trim();
			if (userText) setMessages((old) => [...old, { role: "user", text: userText }]);
			if (assistantText) setMessages((old) => [...old, { role: "assistant", text: assistantText }]);
			liveUserTranscriptRef.current = "";
			liveAssistantTranscriptRef.current = "";
			setVoiceCaption("");
		}, delay);
	};

	const executeAssistantTool = async (name: string, args: Record<string, unknown>) => {
		if (name === "web_search") {
			const query = String(args.query ?? "").trim();
			if (!query) throw new Error("A web search query is required.");
			const result = await invoke<AssistantReply>("assistant_ask", { message: query, workspaceContext: null });
			return { reply: result.reply, sources: result.sources ?? [] };
		}
		if (name === "set_volume") {
			const volume = Math.max(0, Math.min(100, Math.round(Number(args.volume))));
			await invoke("set_volume", { volume: volume / 100 });
			return { success: true, volume };
		}
		if (name === "diagnose_workspace") {
			if (!workspacePath) throw new Error("আগে VS Code project folder select করুন।");
			return await invoke<WorkspaceDiagnostics>("assistant_diagnose_workspace", { workspacePath });
		}
		if (name === "write_workspace_file") {
			if (!workspacePath || !shareWorkspace) throw new Error("আগে project folder select করুন এবং code sharing চালু করুন।");
			const path = String(args.path ?? "").trim();
			const content = String(args.content ?? "");
			const savedPath = await invoke<string>("assistant_write_workspace_file", { workspacePath, path, content });
			await invoke("assistant_open_vscode_file", { workspacePath, path });
			return { success: true, savedPath };
		}
		if (name === "open_url") {
			const url = new URL(String(args.url ?? ""));
			if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Only public http/https website links can be opened.");
			await openUrl(url.href);
			return { success: true, url: url.href };
		}
		if (name === "launch_app") {
			const requested = String(args.name ?? "").trim();
			const apps = await invoke<{ name: string; path: string }[]>("get_installed_apps");
			const target = apps.find((app) => app.name.toLowerCase() === requested.toLowerCase())
				?? apps.find((app) => app.name.toLowerCase().includes(requested.toLowerCase()));
			if (!target) throw new Error(`Installed app “${requested}” was not found.`);
			await invoke("open_app", { appName: target.path });
			setMessages((old) => [...old, { role: "assistant", text: `Opening ${target.name}.` }]);
			return { success: true, app: target.name };
		}
		if (name === "search_files" || name === "open_file") {
			const query = String(args.query ?? "").trim();
			if (!query) throw new Error("A file name or search phrase is required.");
			const files = await invoke<SearchFile[]>("search_user_files", { query });
			if (name === "open_file") {
				const exact = files.filter((file) => file.name.toLowerCase() === query.toLowerCase());
				const match = exact.length === 1 ? exact[0] : exact.length === 0 && files.length === 1 ? files[0] : null;
				if (match) {
					await invoke("shelf_open", { path: match.path });
					setMessages((old) => [...old, { role: "assistant", text: `Opening ${match.name}.` }]);
					return { success: true, opened: match.name };
				}
				if (name === "open_file") return { needsClarification: true, matches: files.slice(0, 10).map(({ name: fileName, is_dir }) => ({ name: fileName, is_dir })) };
			}
			return { files: files.slice(0, 10).map(({ name: fileName, is_dir }) => ({ name: fileName, is_dir })) };
		}
		throw new Error(`Unsupported assistant tool: ${name}`);
	};

	const startVoiceChat = async () => {
		if (!acknowledged) {
			setError("Voice conversation চালাতে আগে উপরের Gemini voice consent-এ টিক দিন।");
			return;
		}
		if (voiceStatus !== "off" || busy) return;
		if (!navigator.mediaDevices?.getUserMedia || typeof WebSocket === "undefined") {
			setError("এই Windows WebView-তে live voice conversation সমর্থিত নয়।");
			return;
		}
		const generation = ++voiceGenerationRef.current;
		setMicrophoneDenied(false);
		setError("");
		setVoiceStatus("connecting");
		setVoiceCaption("Gemini voice session-এ সংযোগ হচ্ছে…");
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: { ...(selectedMic ? { deviceId: { exact: selectedMic } } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true }
			});
			if (generation !== voiceGenerationRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
			liveStreamRef.current = stream;
			void refreshMicrophones();
			const context = new AudioContext();
			audioContextRef.current = context;
			await context.resume();
			const token = await invoke<string>("assistant_create_live_token");
			if (generation !== voiceGenerationRef.current) { releaseVoiceAudio(); return; }
			const socket = new WebSocket(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(token)}`);
			liveSocketRef.current = socket;
			socket.onopen = () => {
				if (generation !== voiceGenerationRef.current) return;
				const voiceInstruction = "You are Lulu, the user's friendly desktop voice assistant. Have a natural, concise spoken conversation. Respond in the language the user speaks, especially Bengali or English. Keep spoken replies clear and reasonably short. For every current or time-sensitive question, including sports fixtures and schedules, you MUST call web_search before answering. After receiving web_search results, summarize them in the user's language; never claim you cannot browse or invent a technical problem. If the tool returns an error, tell the user its exact message. Use set_volume for system sound. Use diagnose_workspace for project errors and write_workspace_file only when code changes are explicitly requested. Use open_url only on explicit request. When the user asks to launch an app, find a file, or open a file, call the matching local tool. Never claim an action succeeded unless its tool response confirms it. Never invent file paths.";
				const desktopTools = [{ functionDeclarations: [
					{ name: "set_volume", description: "Set Windows master output volume from 0 (muted) to 100.", parameters: { type: "OBJECT", properties: { volume: { type: "INTEGER", description: "Volume percentage from 0 to 100" } }, required: ["volume"] } },
					{ name: "diagnose_workspace", description: "Run the selected project's existing npm build script or cargo check to locate code errors.", parameters: { type: "OBJECT", properties: {} } },
					{ name: "write_workspace_file", description: "Write code to a relative path inside the selected VS Code workspace, only when the user explicitly asked to create or change code.", parameters: { type: "OBJECT", properties: { path: { type: "STRING", description: "Relative file path within the selected project" }, content: { type: "STRING", description: "Complete file contents" } }, required: ["path", "content"] } },
					{ name: "web_search", description: "Search the public web for current facts, news, sports fixtures, schedules, and other time-sensitive information.", parameters: { type: "OBJECT", properties: { query: { type: "STRING", description: "Search question" } }, required: ["query"] } },
					{ name: "open_url", description: "Open a public website in the user's default browser when explicitly requested.", parameters: { type: "OBJECT", properties: { url: { type: "STRING", description: "Absolute http or https URL" } }, required: ["url"] } },
					{ name: "launch_app", description: "Launch an installed application requested by the user.", parameters: { type: "OBJECT", properties: { name: { type: "STRING", description: "App name" } }, required: ["name"] } },
					{ name: "search_files", description: "Search the user's Desktop, Downloads, Documents, Pictures, Music, and Videos by name.", parameters: { type: "OBJECT", properties: { query: { type: "STRING", description: "Filename or search words" } }, required: ["query"] } },
					{ name: "open_file", description: "Find a requested file and open it with its default Windows app when the match is unambiguous.", parameters: { type: "OBJECT", properties: { query: { type: "STRING", description: "Filename or search words" } }, required: ["query"] } }
				] }];
				socket.send(JSON.stringify({ setup: {
					model: "models/gemini-3.8-live",
					generationConfig: {
						responseModalities: ["AUDIO"],
						speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } } }
					},
					inputAudioTranscription: {},
					outputAudioTranscription: {},
					sessionResumption: {},
					systemInstruction: { parts: [{ text: voiceInstruction }] },
					tools: desktopTools
				} }));
			};
			socket.onmessage = async (event) => {
				if (generation !== voiceGenerationRef.current) return;
				let packet: any;
				try {
					const payload = typeof event.data === "string"
						? event.data
						: event.data instanceof Blob
							? await event.data.text()
							: event.data instanceof ArrayBuffer
								? new TextDecoder().decode(event.data)
								: String(event.data);
					packet = JSON.parse(payload);
				} catch (parseError) {
					if (generation !== voiceGenerationRef.current) return;
					const kind = event.data instanceof Blob ? "binary Blob" : event.data instanceof ArrayBuffer ? "binary frame" : "unknown frame";
					setError(`Gemini Live-এর ${kind} response পড়া যায়নি (${String(parseError)})।`);
					stopVoiceChat();
					return;
				}
				if (packet.error) {
					const detail = packet.error.message ?? JSON.stringify(packet.error);
					setError(`Voice session error: ${detail}`);
					stopVoiceChat();
					return;
				}
				if (packet.toolCall?.functionCalls?.length) {
					const functionResponses = await Promise.all(packet.toolCall.functionCalls.map(async (call: any) => {
						try {
							const result = await executeAssistantTool(String(call.name), call.args ?? {});
							return { id: call.id, name: call.name, response: { result } };
						} catch (toolError) {
							if (call.name === "web_search") setError(`Web search failed: ${String(toolError)}`);
							return { id: call.id, name: call.name, response: { error: String(toolError) } };
						}
					}));
					if (generation === voiceGenerationRef.current && socket.readyState === WebSocket.OPEN) {
						socket.send(JSON.stringify({ toolResponse: { functionResponses } }));
					}
				}
				if (packet.setupComplete) {
					const audioContext = audioContextRef.current;
					const activeStream = liveStreamRef.current;
					if (!audioContext || !activeStream) return;
					const source = audioContext.createMediaStreamSource(activeStream);
					const processor = audioContext.createScriptProcessor(4096, 1, 1);
					const silentGain = audioContext.createGain();
					let meterFrames = 0;
					silentGain.gain.value = 0;
					processor.onaudioprocess = (audioEvent) => {
						if (socket.readyState !== WebSocket.OPEN || liveSocketRef.current !== socket) return;
						const samples = audioEvent.inputBuffer.getChannelData(0);
						let energy = 0;
						for (let i = 0; i < samples.length; i++) energy += samples[i] * samples[i];
						const level = Math.min(1, Math.sqrt(energy / samples.length) * 20);
						if (++meterFrames % 4 === 0) setMicLevel(level);
						const ratio = audioContext.sampleRate / 16000;
						const sampleCount = Math.floor(samples.length / ratio);
						const pcm = new ArrayBuffer(sampleCount * 2);
						const view = new DataView(pcm);
						for (let i = 0; i < sampleCount; i++) {
							// A little clean digital gain helps quiet laptop microphones; clipping is bounded here.
							const value = Math.max(-1, Math.min(1, samples[Math.floor(i * ratio)] * 2.5));
							view.setInt16(i * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
						}
						const bytes = new Uint8Array(pcm);
						let binary = "";
						for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
						socket.send(JSON.stringify({ realtimeInput: { audio: { data: btoa(binary), mimeType: "audio/pcm;rate=16000" } } }));
					};
					source.connect(processor);
					processor.connect(silentGain);
					silentGain.connect(audioContext.destination);
					inputSourceRef.current = source;
					inputProcessorRef.current = processor;
					mutedInputGainRef.current = silentGain;
					setVoiceStatus("listening");
					setVoiceCaption("আমি শুনছি… কথা বলুন");
				}
				const server = packet.serverContent;
				if (!server) return;
				if (server.interrupted) {
					for (const audioSource of audioSourcesRef.current) { try { audioSource.stop(); } catch { /* already stopped */ } }
					audioSourcesRef.current.clear();
					audioPlayheadRef.current = audioContextRef.current?.currentTime ?? 0;
				}
				if (server.inputTranscription?.text) {
					liveUserTranscriptRef.current += server.inputTranscription.text;
					setVoiceCaption(`তুমি: ${liveUserTranscriptRef.current}`);
					flushLiveTranscript(900);
				}
				if (server.interimInputTranscription?.text && !server.inputTranscription?.text) {
					setVoiceCaption(`শুনছি: ${server.interimInputTranscription.text}`);
				}
				if (server.outputTranscription?.text) {
					liveAssistantTranscriptRef.current += server.outputTranscription.text;
					setVoiceCaption(`Lulu: ${liveAssistantTranscriptRef.current}`);
					flushLiveTranscript(900);
				}
				for (const part of server.modelTurn?.parts ?? []) {
					if (!part.inlineData?.data || !String(part.inlineData.mimeType).startsWith("audio/pcm")) continue;
					const audioContext = audioContextRef.current;
					if (!audioContext) continue;
					const raw = atob(part.inlineData.data);
					const samples = Math.floor(raw.length / 2);
					const buffer = audioContext.createBuffer(1, samples, 24000);
					const channel = buffer.getChannelData(0);
					for (let i = 0; i < samples; i++) {
						const sample = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8);
						channel[i] = (sample & 0x8000) ? (sample - 0x10000) / 0x8000 : sample / 0x7fff;
					}
					const audioSource = audioContext.createBufferSource();
					audioSource.buffer = buffer;
					audioSource.connect(audioContext.destination);
					const playAt = Math.max(audioContext.currentTime + 0.02, audioPlayheadRef.current);
					audioSource.start(playAt);
					audioPlayheadRef.current = playAt + buffer.duration;
					audioSourcesRef.current.add(audioSource);
					setVoiceStatus("speaking");
					audioSource.onended = () => {
						audioSourcesRef.current.delete(audioSource);
						if (liveSocketRef.current === socket && audioSourcesRef.current.size === 0) {
							setVoiceStatus("listening");
							setVoiceCaption("আমি শুনছি… কথা বলুন");
						}
					};
				}
				if (server.turnComplete) {
					if (audioSourcesRef.current.size === 0) {
						setVoiceStatus("listening");
						setVoiceCaption("আমি শুনছি… কথা বলুন");
					}
					flushLiveTranscript(400);
				}
			};
			socket.onerror = () => {
				if (generation === voiceGenerationRef.current) setError("Gemini Live connection ব্যর্থ হয়েছে। Network ও Google API key যাচাই করে আবার চেষ্টা করুন।");
			};
			socket.onclose = (event) => {
				if (generation !== voiceGenerationRef.current || liveSocketRef.current !== socket) return;
				liveSocketRef.current = null;
				releaseVoiceAudio();
				setVoiceStatus("off");
				setVoiceCaption("");
				if (event.code !== 1000) setError(`Gemini voice session বন্ধ হয়েছে (${event.code}) ${event.reason}`.trim());
			};
		} catch (e) {
			if (generation !== voiceGenerationRef.current) return;
			releaseVoiceAudio();
			setVoiceStatus("off");
			setVoiceCaption("");
			const message = String(e);
			const denied = message.toLowerCase().includes("notallowed") || message.toLowerCase().includes("permission");
			setMicrophoneDenied(denied);
			setError(denied ? `Lulu microphone access পায়নি (${message})। Windows privacy setting ON রাখুন।` : `Voice conversation চালু হয়নি: ${message}`);
		}
	};

	const toggleVoiceChat = () => {
		if (voiceStatus === "off") void startVoiceChat();
		else stopVoiceChat();
	};

	const toggleWakeWord = () => {
		if (voiceStatus !== "off") return;
		if (!acknowledged || !hasKey) {
			setError("Lulu wake word চালু করতে Gemini key ও উপরের consent আগে সম্পন্ন করুন।");
			return;
		}
		const enabled = !wakeWordEnabled;
		setWakeWordEnabled(enabled);
		localStorage.setItem("lulu-wake-word-enabled", String(enabled));
		setError("");
	};

	useEffect(() => () => {
		const socket = liveSocketRef.current;
		liveSocketRef.current = null;
		if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
		releaseVoiceAudio();
		if (transcriptFlushTimerRef.current !== null) window.clearTimeout(transcriptFlushTimerRef.current);
		window.speechSynthesis?.cancel();
	}, []);

	const saveKey = async () => {
		setError("");
		try {
			await invoke("assistant_save_key", { apiKey });
			setHasKey(true);
			setReplacingKey(false);
			setApiKey("");
		} catch (e) { setError(String(e)); }
	};

	const send = async (event?: React.FormEvent) => {
		event?.preventDefault();
		const text = input.trim();
		if (!text || busy || !acknowledged || voiceStatus !== "off") return;
		setInput("");
		setError("");
		setMessages((old) => [...old, { role: "user", text }]);
		setBusy(true);
		try {
			const codeRequest = /code|source|bug|error|issue|debug|fix|compile|build|vs.?code|ভুল|সমস্যা|এরর|কোড/i.test(text);
			let workspaceContext: string | null = null;
			if (codeRequest && workspacePath && shareWorkspace) {
				workspaceContext = await invoke<string>("assistant_get_workspace_context", { workspacePath, query: text });
			}
			const result = await invoke<AssistantReply>("assistant_ask", { message: text, workspaceContext });
			let files: SearchFile[] | undefined;
			if (result.action?.type === "search_files" || result.action?.type === "open_file") {
				files = await invoke<SearchFile[]>("search_user_files", { query: result.action.query });
			}
			if (result.action?.type === "open_file" && files?.length === 1) {
				await invoke("shelf_open", { path: files[0].path });
				setMessages((old) => [...old, { role: "assistant", text: `Opening ${files[0].name}.` }]);
			} else if (result.action?.type === "diagnose_workspace") {
				if (!workspacePath) throw new Error("আগে VS Code project folder select করুন।");
				const diagnostics = await invoke<WorkspaceDiagnostics>("assistant_diagnose_workspace", { workspacePath });
				const analysis = await invoke<AssistantReply>("assistant_ask", { message: `Explain these project diagnostics in ${/[\u0980-\u09ff]/.test(text) ? "Bengali" : "the user's language"}. Point out the first actionable compiler/build errors and suggest fixes.\nCommand: ${diagnostics.command}\nExit code: ${diagnostics.exitCode}\nOutput:\n${diagnostics.output}`, workspaceContext: null });
				setMessages((old) => [...old, { role: "assistant", text: analysis.reply, diagnostics, sources: analysis.sources }]);
				speak(analysis.reply);
				return;
			} else if (result.action?.type === "launch_app" || result.action?.type === "open_url" || result.action?.type === "set_volume") {
				await runAction(result.action, result.sources);
			} else {
				setMessages((old) => [...old, { role: "assistant", text: result.reply, action: result.action, files, sources: result.sources }]);
			}
			speak(result.reply);
		} catch (e) { setError(String(e)); }
		finally { setBusy(false); }
	};

	const runAction = async (action: AssistantAction, sources: WebCitation[] = []) => {
		setError("");
		try {
			if (action.type === "set_volume") {
				const volume = Math.max(0, Math.min(100, Math.round(action.volume)));
				await invoke("set_volume", { volume: volume / 100 });
				setMessages((old) => [...old, { role: "assistant", text: `System volume ${volume}% করেছি।`, sources }]);
				return;
			}
			if (action.type === "write_workspace_file") {
				if (!workspacePath || !shareWorkspace) throw new Error("আগে project folder select করুন এবং code sharing চালু করুন।");
				const savedPath = await invoke<string>("assistant_write_workspace_file", { workspacePath, path: action.path, content: action.content });
				await invoke("assistant_open_vscode_file", { workspacePath, path: action.path });
				setMessages((old) => [...old, { role: "assistant", text: `VS Code-এ ${action.path} সংরক্ষণ করে খুলেছি: ${savedPath}`, sources }]);
				return;
			}
			if (action.type === "open_url") {
				const url = new URL(action.url);
				if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Only public http/https website links can be opened.");
				await openUrl(url.href);
				setMessages((old) => [...old, { role: "assistant", text: `Browser-এ ${url.hostname} খুলছি।`, sources }]);
				return;
			}
			if (action.type === "launch_app") {
				const apps = await invoke<{ name: string; path: string }[]>("get_installed_apps");
				const target = apps.find((app) => app.name.toLowerCase() === action.name.toLowerCase())
					?? apps.find((app) => app.name.toLowerCase().includes(action.name.toLowerCase()));
				if (!target) throw new Error(`Installed app “${action.name}” was not found. Try asking with its full app name.`);
				await invoke("open_app", { appName: target.path });
				setMessages((old) => [...old, { role: "assistant", text: `Opening ${target.name}.` }]);
			}
		} catch (e) { setError(String(e)); }
	};

	const openFile = async (file: SearchFile) => {
		try { await invoke("shelf_open", { path: file.path }); }
		catch (e) { setError(String(e)); }
	};

	return <main className="assistant-shell">
		<header className="assistant-header" data-tauri-drag-region>
			<div className="assistant-brand"><span className="assistant-brand-icon"><Sparkles size={17} /></span><div><strong>Lulu</strong><small>Gemini · desktop assistant</small></div></div>
			<div className="assistant-header-actions">{hasKey && <button className="assistant-close" onClick={() => setReplacingKey((value) => !value)} aria-label="Change API key"><KeyRound size={16}/></button>}<button className="assistant-close" onClick={() => { const next = !voiceReplies; setVoiceReplies(next); if (!next) window.speechSynthesis?.cancel(); }} aria-label={voiceReplies ? "Voice replies on" : "Voice replies off"} title={voiceReplies ? "Voice replies on" : "Voice replies off"}>{voiceReplies ? <Volume2 size={16}/> : <VolumeX size={16}/>}</button><button className="assistant-close" onClick={() => getCurrentWindow().hide()} aria-label="Hide assistant"><X size={17} /></button></div>
		</header>
		{(!hasKey || replacingKey) ? <section className="assistant-setup">
			<div className="assistant-hero"><span><KeyRound size={25} /></span><h1>Connect Gemini</h1><p>Google AI Studio-এর free API key যোগ করুন। Key Windows Credential Manager-এ রাখা হবে।</p></div>
			<button className="assistant-link" onClick={() => openUrl("https://aistudio.google.com/app/apikey").catch((e) => setError(String(e)))}>Google AI Studio-তে free key নিন ↗</button>
			<label className="assistant-label" htmlFor="gemini-key">API key</label>
			<input id="gemini-key" className="assistant-input" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="AIza…" />
			<label className="assistant-consent"><input type="checkbox" checked={acknowledged} onChange={(e) => setAssistantConsent(e.target.checked)} /><span>আমি Google-এর শর্তে যোগ্য (১৮+, পেশাগত/ব্যবসায়িক ব্যবহার; ১৮ বছরের কম বয়সীদের জন্য নয়)। Text ও চালু voice chat-এর live audio Google-এ process হবে। Lulu wake word চালু রাখলে speech-recognition provider trigger word শনাক্ত করতে mic শুনবে। File search/open করলে matching file name Google-এ পাঠানো হতে পারে, file content নয়। Free-tier data উন্নত করতে ও human review-তে ব্যবহার হতে পারে। Sensitive বা confidential তথ্য দেব না।</span></label>
			<button className="assistant-primary" disabled={!apiKey.trim() || !acknowledged} onClick={saveKey}><KeyRound size={16} /> Key save করুন</button>
			{error && <p className="assistant-error">{error}</p>}
		</section> : <>
			<label className="assistant-session-consent"><input type="checkbox" checked={acknowledged} onChange={(e) => setAssistantConsent(e.target.checked)} /><span><Check size={13} /> আমি Google-এর শর্তে যোগ্য (১৮+, পেশাগত/ব্যবসায়িক ব্যবহার; ১৮ বছরের কম বয়সীদের জন্য নয়)। আমার text ও চালু voice chat-এর live audio Google-এ process হবে। Lulu wake word চালু রাখলে speech-recognition provider trigger word শনাক্ত করতে mic শুনবে। File search/open ব্যবহার করলে matching file name Google-এ পাঠানো হতে পারে; file content পাঠানো হবে না। Free-tier data Google উন্নত করতে ও human review-তে ব্যবহার হতে পারে। Sensitive বা confidential তথ্য দেব না।</span></label>
			<div className="assistant-workspace-tools">
				<button className="assistant-workspace-select" onClick={() => void chooseWorkspace()}><FolderOpen size={14}/><span>{workspacePath ? workspacePath.split(/[\\/]/).filter(Boolean).pop() : "VS Code project folder বেছে নিন"}</span><Code2 size={13}/></button>
				{workspacePath && <label className="assistant-code-consent"><input type="checkbox" checked={shareWorkspace} onChange={(event) => setWorkspaceSharing(event.target.checked)} /><span>Code review/লেখার সময় নির্বাচিত project-এর source code Google Gemini-তে পাঠাতে সম্মতি দিচ্ছি।</span></label>}
			</div>
			<button type="button" className={`assistant-wake-toggle ${wakeWordEnabled ? "active" : ""}`} onClick={toggleWakeWord} aria-pressed={wakeWordEnabled}><Mic size={14}/><span><b>{wakeWordEnabled ? "Lulu wake word চালু" : "“Lulu” বলে চালু করুন"}</b><small>{wakeWordEnabled ? "Mic শুনছে · বলুন “Lulu” · বন্ধ করতে চাপুন" : "Orbix চালু থাকলে mic-এ Lulu বলে assistant খুলুন"}</small></span><span className="assistant-wake-state">{wakeWordEnabled ? "ON" : "OFF"}</span></button>
			<section className="assistant-messages">
				{messages.length === 0 && <div className="assistant-empty"><span><Bot size={28} /></span><h1>কীভাবে সাহায্য করতে পারি?</h1><p>ফাইল খুঁজুন, app চালু করুন, অথবা যেকোনো প্রশ্ন করুন।</p><div className="assistant-suggestions"><button onClick={() => setInput("Downloads folder-এ PDF খুঁজে দাও") }><FileSearch size={15}/> PDF খুঁজুন</button><button onClick={() => setInput("Open Settings app") }><Power size={15}/> App চালান</button><button onClick={() => setInput("আজকের কাজের জন্য focus tips দাও") }><MessageCircle size={15}/> প্রশ্ন করুন</button></div></div>}
				{messages.map((message, i) => <article key={i} className={`assistant-message ${message.role}`}><div className="assistant-avatar">{message.role === "user" ? "You" : <Sparkles size={15}/>}</div><div className="assistant-bubble"><p>{message.text}</p>
					{message.action?.type === "launch_app" && <button className="assistant-action" onClick={() => runAction(message.action!)}><Power size={14}/> Open {message.action.name}</button>}
					{message.action?.type === "open_url" && <button className="assistant-action" onClick={() => runAction(message.action!)}><Power size={14}/> Open {message.action.url}</button>}
					{message.action?.type === "set_volume" && <button className="assistant-action" onClick={() => runAction(message.action!)}><Volume2 size={14}/> Set volume {message.action.volume}%</button>}
					{message.action?.type === "write_workspace_file" && <><details className="assistant-code-preview"><summary>Generated code · {message.action.path}</summary><pre>{message.action.content}</pre></details><button className="assistant-action" onClick={() => runAction(message.action!, message.sources)}><Code2 size={14}/> Save and open in VS Code</button></>}
					{message.files?.map((file) => <button key={file.path} className="assistant-file" onClick={() => openFile(file)}><FileSearch size={16}/><span><b>{file.name}</b><small>{file.is_dir ? "Folder" : file.path}</small></span></button>)}
					{message.sources && message.sources.length > 0 && <div className="assistant-sources"><small>Web sources</small>{message.sources.slice(0, 5).map((source, sourceIndex) => source.uri && <button key={`${source.uri}-${sourceIndex}`} onClick={() => openUrl(source.uri!).catch((e) => setError(String(e)))}>{source.title || new URL(source.uri).hostname} ↗</button>)}</div>}
					{message.diagnostics && <details className="assistant-code-preview"><summary><Bug size={13}/> {message.diagnostics.command} · exit {message.diagnostics.exitCode ?? "unknown"}</summary><pre>{message.diagnostics.output || "Build/diagnostics successful; no output."}</pre></details>}
					{message.action?.type === "search_files" && message.files?.length === 0 && <small className="assistant-muted">কোনো matching file পাওয়া যায়নি।</small>}
				</div></article>)}
				{busy && <div className="assistant-loading"><LoaderCircle size={16} className="assistant-spin"/> Gemini উত্তর দিচ্ছে…</div>}
				{voiceStatus !== "off" && <div className="assistant-voice-live"><span className="assistant-voice-pulse"/>{voiceStatus === "connecting" ? "Gemini-র সাথে সংযোগ হচ্ছে…" : voiceStatus === "speaking" ? "Lulu বলছে…" : micLevel > 0.04 ? "কথা ধরা পড়েছে · Gemini-তে পাঠাচ্ছি" : "Mic চালু · কথা বলুন"}<div className="assistant-mic-meter" role="meter" aria-label="Microphone input level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(micLevel * 100)}><span style={{ width: `${Math.round(micLevel * 100)}%` }}/></div>{voiceCaption && <small>{voiceCaption}</small>}</div>}
				<div ref={bottomRef}/>
			</section>
			{error && <div className="assistant-inline-error">{error}{microphoneDenied && <button className="assistant-action" onClick={() => invoke("open_microphone_privacy_settings").catch((e) => setError(String(e)))}><Mic size={14}/> Microphone Settings খুলুন</button>}</div>}
			<label className="assistant-mic-picker"><Mic size={13}/><span>Input mic</span><select value={selectedMic} onFocus={() => void refreshMicrophones(true)} onChange={(event) => { setSelectedMic(event.target.value); localStorage.setItem("orbix-assistant-mic-device", event.target.value); }} aria-label="Select microphone" disabled={voiceStatus !== "off"}><option value="">Default microphone</option>{micDevices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}</select></label>
			<form className="assistant-composer" onSubmit={send}><textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} placeholder={acknowledged ? "Lulu-কে কিছু জিজ্ঞাসা করুন…" : "চালিয়ে যেতে উপরের সম্মতি দিন…"} rows={2} disabled={voiceStatus !== "off"}/><button type="button" className={`assistant-mic ${voiceStatus !== "off" ? "listening" : ""}`} onClick={toggleVoiceChat} disabled={busy} aria-label={voiceStatus === "off" ? "Start voice conversation" : "End voice conversation"} title={voiceStatus === "off" ? acknowledged ? "Live voice chat শুরু করুন" : "আগে উপরের Gemini voice-consent checkbox-এ টিক দিন" : "Voice conversation শেষ করুন"}>{voiceStatus === "off" ? <Mic size={16}/> : <MicOff size={16}/>}</button><button type="submit" disabled={busy || voiceStatus !== "off" || !input.trim() || !acknowledged} aria-label="Send"><Send size={17}/></button><small>{voiceStatus === "connecting" ? "Live voice session তৈরি হচ্ছে…" : voiceStatus !== "off" ? "আমি শুনছি ও উত্তর বলছি · শেষ করতে mic চাপুন" : acknowledged ? wakeWordEnabled ? "Mic-এ “Lulu” বলুন, অথবা mic button চাপুন" : "Mic চাপুন—সরাসরি কথা বলুন · শেষ করতে আবার চাপুন" : "Mic চালু করতে উপরের consent checkbox-এ টিক দিন"}</small></form>
		</>}
	</main>;
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<Assistant />
	</StrictMode>
);
