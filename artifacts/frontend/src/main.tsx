import { createRoot } from "react-dom/client";
import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";
import { readStoredSession } from "@/lib/auth-session";

import App from "./App";
import "./index.css";

const apiUrl = import.meta.env.VITE_API_URL;
if (apiUrl) setBaseUrl(apiUrl);

setAuthTokenGetter(() => readStoredSession().token);

createRoot(document.getElementById("root")!).render(<App />);