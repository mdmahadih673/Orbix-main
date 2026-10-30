import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppsLauncher } from "./AppsLauncher";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<AppsLauncher />
	</StrictMode>
);
