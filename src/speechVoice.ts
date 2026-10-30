const feminineVoiceName = /female|zira|aria|jenny|ava|sonia|hazel|catherine|susan|michelle|libby|natasha|neerja|asha|tanishaa|eva|siri/i;

export function preferredSpeechVoice(language: string): SpeechSynthesisVoice | null {
	if (!("speechSynthesis" in window)) return null;
	const voices = window.speechSynthesis.getVoices();
	const normalizedLanguage = language.toLowerCase();
	const languageVoices = voices.filter((voice) => voice.lang.toLowerCase().startsWith(normalizedLanguage.split("-")[0]));
	return languageVoices.find((voice) => feminineVoiceName.test(voice.name))
		?? voices.find((voice) => feminineVoiceName.test(voice.name))
		?? languageVoices[0]
		?? null;
}
