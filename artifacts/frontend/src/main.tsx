import { createRoot } from "react-dom/client";
import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

const TOKEN_KEY = "carescribe_token";

const apiUrl = import.meta.env.VITE_API_URL;
if (apiUrl) setBaseUrl(apiUrl);

setAuthTokenGetter(() => localStorage.getItem(TOKEN_KEY));

createRoot(document.getElementById("root")!).render(<App />);
