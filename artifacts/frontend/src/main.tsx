import { createRoot } from "react-dom/client";
import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";
import { readStoredSession } from "@/lib/auth-session";
import { initTheme } from "@/lib/theme";

import App from "./App";
import "./index.css";
import { unlockPageInteraction } from "@/lib/unlock-page-interaction";

// Apply stored theme before first paint to prevent flash
initTheme();

// Clear stale tutorial driver overlays from prior sessions
unlockPageInteraction();
document.querySelectorAll(".driver-overlay, .driver-popover").forEach((el) => el.remove());

const apiUrl = import.meta.env.VITE_API_URL;
if (apiUrl) setBaseUrl(apiUrl);

setAuthTokenGetter(() => readStoredSession().token);

createRoot(document.getElementById("root")!).render(<App />);