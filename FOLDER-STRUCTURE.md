# Crypto-Bot-Trade – Folder & File Structure

Project root: `Crypto-Bot-Trade/`

```
Crypto-Bot-Trade/
│
├── .env.example              # Example env vars (DELTA_API_KEY, etc.)
├── .gitignore
├── .replit                   # Replit config (if used)
├── components.json           # shadcn/ui components config
├── drizzle.config.ts         # Drizzle ORM config
├── package.json
├── package-lock.json
├── postcss.config.js
├── tsconfig.json             # TypeScript config
├── vite.config.ts            # Vite build config
├── vite-plugin-meta-images.ts
├── debug.json                # Debug / temp data (optional)
│
├── client/                   # Frontend (React + Vite)
│   ├── index.html
│   ├── public/
│   │   ├── favicon.png
│   │   └── opengraph.jpg
│   └── src/
│       ├── App.tsx           # Main app + routes
│       ├── main.tsx          # Entry point
│       ├── index.css         # Global styles
│       ├── components/
│       │   ├── layout/
│       │   │   └── AppShell.tsx   # Layout, sidebar, header
│       │   └── ui/                # shadcn/ui components
│       │       ├── badge.tsx
│       │       ├── button.tsx
│       │       ├── card.tsx
│       │       ├── sidebar.tsx
│       │       ├── table.tsx
│       │       ├── tabs.tsx
│       │       └── ... (other UI primitives)
│       ├── hooks/
│       │   ├── use-mobile.tsx
│       │   ├── use-portfolio.ts   # Portfolio / balance
│       │   ├── use-positions.ts   # Open positions
│       │   └── use-toast.ts
│       ├── lib/
│       │   ├── mockData.ts
│       │   ├── queryClient.ts
│       │   └── utils.ts
│       └── pages/
│           ├── dashboard.tsx     # Dashboard
│           ├── bot-control.tsx   # Bot control
│           ├── strategy-tester.tsx # Strategy backtest UI
│           ├── trade-history.tsx  # Trade history
│           ├── settings.tsx      # Settings
│           └── not-found.tsx     # 404
│
├── server/                   # Backend (Node + Express)
│   ├── index.ts              # Server entry, starts Express
│   ├── routes.ts             # API routes (/api/delta/...)
│   ├── vite.ts               # Vite dev middleware
│   ├── static.ts             # Static file serving
│   ├── storage.ts            # Storage / persistence helpers
│   ├── delta.ts              # Delta Exchange API client
│   └── strategy-engine.ts    # Backtest, EMA, ADX, RSI, regime
│
├── shared/
│   └── schema.ts             # Shared DB/types (Drizzle schema)
│
├── script/                   # Build / one-off scripts
│   └── build.ts
│
├── scripts/                  # Utility scripts
│   ├── check_delta.py
│   ├── check-delta-keys.ts
│   └── delta_error.log
│
└── attached_assets/          # Pasted / reference assets
    └── Pasted-Build-a-fully-functional-personal-crypto-auto-trading-d_*.txt
```

---

## Summary

| Folder / File        | Purpose |
|----------------------|--------|
| **client/**          | React frontend, pages (dashboard, bot-control, strategy-tester, trade-history, settings), UI components, hooks |
| **server/**          | Express API, Delta Exchange integration, strategy backtest engine |
| **shared/**          | Shared TypeScript types / Drizzle schema |
| **script/, scripts/**| Build and utility scripts |
| Root config files    | Vite, TypeScript, PostCSS, Drizzle, package.json |

*Note: `node_modules/` and `.git/` are not listed; they are generated / version-controlled.*
