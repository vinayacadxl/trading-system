import { useLocation, Link } from "wouter";
import {
    LayoutDashboard, Bot, History,
    FlaskConical, Radio, Settings, Zap
} from "lucide-react";

const NAV = [
    { to: "/", Icon: LayoutDashboard, label: "Dashboard" },
    { to: "/bot", Icon: Bot, label: "Bot Control" },
    { to: "/history", Icon: History, label: "Trade History" },
    { to: "/tester", Icon: FlaskConical, label: "Strategy Tester" },
    { to: "/live", Icon: Radio, label: "Live Data" },
    { to: "/settings", Icon: Settings, label: "Settings" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
    const [loc] = useLocation();

    return (
        <div className="app-layout">
            {/* ─── Sidebar ─────────────────────────────── */}
            <aside className="sidebar">
                <div className="sb-logo">
                    <Zap size={20} className="icon" />
                    <span className="sb-logo-text">DeltaAlgo</span>
                </div>

                <div className="sb-section">Navigation</div>

                {NAV.map(({ to, Icon, label }) => {
                    const active = to === "/" ? loc === "/" : loc.startsWith(to);
                    return (
                        <Link key={to} href={to}>
                            <a className={`nav-item${active ? " active" : ""}`}>
                                <Icon size={15} />
                                {label}
                            </a>
                        </Link>
                    );
                })}

                <div className="sb-footer">
                    <div className="sb-online" />
                    <span>System Online</span>
                </div>
            </aside>

            {/* ─── Content ─────────────────────────────── */}
            <div className="main-area">
                {children}
            </div>
        </div>
    );
}
