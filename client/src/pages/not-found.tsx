import { Link } from "wouter";
import { Home, AlertTriangle } from "lucide-react";

export default function NotFound() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", gap: 20, padding: 24, background: "var(--bg)" }}>
      <div style={{ width: 64, height: 64, borderRadius: 16, background: "var(--red-dim)", border: "1px solid rgba(244,63,94,0.22)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--red)" }}>
        <AlertTriangle size={30} />
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 56, fontWeight: 900, color: "var(--red)", lineHeight: 1, marginBottom: 8 }}>404</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--tx1)", marginBottom: 8 }}>Page Not Found</div>
        <div style={{ fontSize: 13, color: "var(--tx2)" }}>The page you're looking for doesn't exist.</div>
      </div>
      <Link href="/">
        <a className="btn btn-p">
          <Home size={14} />Return Home
        </a>
      </Link>
    </div>
  );
}
