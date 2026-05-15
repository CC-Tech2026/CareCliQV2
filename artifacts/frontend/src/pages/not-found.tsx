import { AlertCircle } from "lucide-react";
import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center" style={{ background: "#F6F4FB" }}>
      <div
        className="w-full max-w-md mx-4 bg-white rounded-2xl p-8 text-center"
        style={{ boxShadow: "0 1px 4px rgba(84,34,105,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}
      >
        <div
          className="h-14 w-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
          style={{ background: "rgba(241,115,138,0.10)" }}
        >
          <AlertCircle className="h-7 w-7" style={{ color: "#F1738A" }} />
        </div>
        <h1 className="text-[22px] font-bold mb-2" style={{ color: "#1C1626" }}>Page Not Found</h1>
        <p className="text-[14px] mb-6" style={{ color: "#4A3D5A" }}>
          The page you're looking for doesn't exist or may have moved.
        </p>
        <Link href="/dashboard">
          <span
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: "linear-gradient(135deg, #F1738A 0%, #542269 100%)" }}
          >
            Go to Dashboard
          </span>
        </Link>
      </div>
    </div>
  );
}
