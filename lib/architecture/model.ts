export type ArchPerspective = "full" | "terminal" | "trading" | "screener" | "resilience";
export type ArchLayer = "source" | "transport" | "engine" | "state" | "ui";

export interface ArchNode {
  id: string;
  title: string;
  subtitle: string;
  layer: ArchLayer;
  layerLabel: string;
  /** Column index 0..3 in SVG layout */
  col: 0 | 1 | 2 | 3;
  /** Vertical center Y coordinate inside 500px SVG canvas */
  y: number;
  accent: "accent" | "buy" | "vwap" | "poc" | "warn";
  protocol: string;
  cadence: string;
  files: string[];
  perspectives: ArchPerspective[];
  summary: string;
  responsibilities: string[];
  inputs: string[];
  outputs: string[];
}

export interface ArchEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  detail: string;
  perspectives: ArchPerspective[];
  dashed?: boolean;
}

export interface TraceStep {
  step: number;
  nodeId: string;
  edgeId?: string;
  title: string;
  summary: string;
  modulePath: string;
  payloadLabel: string;
  payload: string;
}

export interface CadenceMetric {
  id: string;
  nodeId: string;
  label: string;
  ms: number;
  displayValue: string;
  category: "Tiempo real" | "Throttling" | "Agregación" | "Resiliencia";
  rationale: string;
}

export interface ArchitectureChangeEntry {
  id: string;
  version: string;
  title: string;
  category: "Datos y Relay" | "Indicadores" | "Trading y Análisis" | "Visualización y UX";
  nodeId: string;
  summary: string;
  details: string[];
  files: string[];
}

export interface ArchitectureCapabilityItem {
  version: string;
  title: string;
  whatItDoes: string;
  whereToFind: string;
}

export interface ArchitectureCapabilitySuite {
  id: string;
  name: string;
  shortName: string;
  versionRange: string;
  nodeId: string;
  route: "/" | "/trading-options" | "/interactive-charts" | "/screener" | "/architecture";
  routeLabel: string;
  color: "accent" | "buy" | "vwap" | "poc" | "warn";
  summary: string;
  capabilities: ArchitectureCapabilityItem[];
}

export const LAYER_META: Record<ArchLayer, { title: string; description: string }> = {
  source: {
    title: "1. Fuente de Datos Única (OKX v5)",
    description: "Ingesta exclusiva desde WebSocket público y API REST de OKX para perpetuos SWAP y mercado Spot en múltiples temporalidades.",
  },
  transport: {
    title: "2. Adaptación, Relay y Screener en Servidor",
    description: "Normalización de contratos OKX, sembrado inicial en frío, conmutación automática a SSE/JSON y Screener interno.",
  },
  engine: {
    title: "3. Motores Analíticos (Order Flow, Liquidez, Wyckoff y Opciones)",
    description: "Velas footprint, nodos HVN, muros de liquidez L2, Ciclo de Wyckoff (Clímax, MACD, ADX 14, Volume Profile POC/VA y Overlay Histórico), ATR(14) y Bollinger.",
  },
  state: {
    title: "4. Sesión Compartida, Estado Zustand y Temas",
    description: "MarketSessionProvider raíz compartido entre todas las pestañas, alertas, Replay IndexedDB y paleta multi-tema (incl. Sepia).",
  },
  ui: {
    title: "5. Presentación Canvas DPR y Vistas Recharts",
    description: "Footprint Canvas 60 FPS, Opciones de Trading con liquidez cercana, Velas L2, Suite completa Wyckoff, Screener y Arquitectura viva.",
  },
};

export const ARCH_NODES: ArchNode[] = [
  {
    id: "okx-ws",
    title: "OKX WebSocket v5",
    subtitle: "wss://ws.okx.com:8443/ws/v5/public",
    layer: "source",
    layerLabel: "Fuente Externa",
    col: 0,
    y: 155,
    accent: "accent",
    protocol: "WSS JSON Push + Heartbeat 25 s",
    cadence: "Sub-segundo (tick a tick)",
    files: ["lib/adapters/exchanges.ts", "server/okxFeed.ts"],
    perspectives: ["full", "terminal", "trading", "screener", "resilience"],
    summary:
      "Única fuente de datos en tiempo real de la aplicación. Emite operaciones ejecutadas, libro L2 incremental, interés abierto, funding rate, mark/index price y liquidaciones forzadas de OKX.",
    responsibilities: [
      "Canal trades y books (snapshot + actualizaciones incrementales) para Perpetuos SWAP y Spot.",
      "Canales de derivados: open-interest, funding-rate, mark-price, index-tickers y liquidation-orders.",
      "Conexión compartida en servidor (OkxFeed) para seguir ~40 contratos perpetuos simultáneamente.",
    ],
    inputs: ["Suscripciones por instId (ej. BTC-USDT-SWAP o BTC-USDT)"],
    outputs: ["Mensajes JSON de trades, libro L2, derivados y liquidaciones"],
  },
  {
    id: "okx-rest",
    title: "OKX REST API v5",
    subtitle: "api/v5/public & api/v5/market",
    layer: "source",
    layerLabel: "Fuente Externa",
    col: 0,
    y: 365,
    accent: "poc",
    protocol: "HTTPS JSON",
    cadence: "Bajo demanda / arranque",
    files: ["lib/adapters/exchanges.ts", "app/api/terminal/klines/route.ts", "app/api/screener/adx/route.ts", "server/terminalRelay.ts", "server/okxFeed.ts"],
    perspectives: ["full", "terminal", "trading", "screener", "resilience"],
    summary:
      "Provee metadatos de contratos OKX, sembrado inicial de trades recientes al conectar en frío y velas OHLCV multi-temporalidad (1m a 4H) para perfiles previos, ATR, Bollinger y el escáner ADX de la watchlist.",
    responsibilities: [
      "Consulta /public/instruments para resolver ctVal y descubrir los 40 pares más líquidos.",
      "Expone /api/terminal/klines (1m–4H) y /api/screener/adx para hidratar baselines OHLC multi-activo en el escáner ADX(14).",
      "Siembra trades iniciales desde /market/trades para mostrar datos al instante sin esperar el primer tick.",
    ],
    inputs: ["Parámetros instId, instType=SWAP/SPOT, bar y lista de watchlist"],
    outputs: ["Multiplicador ctVal, trades iniciales, catálogo OKX y velas OHLCV multi-símbolo"],
  },
  {
    id: "terminal-adapters",
    title: "Adaptadores OKX + Relay SSE",
    subtitle: "Direct WS ↔ ServerRelayAdapter",
    layer: "transport",
    layerLabel: "Transporte y Failover",
    col: 1,
    y: 130,
    accent: "buy",
    protocol: "WebSocket · SSE · Polling JSON",
    cadence: "Failover 3.5 s · Book 100 ms",
    files: [
      "lib/adapters/exchanges.ts",
      "lib/adapters/relay.ts",
      "lib/session/adapterPool.ts",
      "server/terminalRelay.ts",
      "app/api/terminal/stream/route.ts",
      "app/api/terminal/snapshot/route.ts",
      "app/api/terminal/klines/route.ts",
    ],
    perspectives: ["full", "terminal", "trading", "resilience"],
    summary:
      "Capa híbrida de conectividad que normaliza OKXFuturesAdapter y OKXSpotAdapter. Si el navegador bloquea el socket directo en 3.5 s, conmuta al relay SSE del servidor con warm-up inmediato.",
    responsibilities: [
      "Normaliza instId (BTCUSDT → BTC-USDT-SWAP / BTC-USDT) y escala tamaños por ctVal.",
      "Emite stream SSE en /api/terminal/stream con book L2 throttled a 100 ms y respaldo /api/terminal/snapshot.",
      "Sirve velas por temporalidad en /api/terminal/klines para Prior Sessions, ATR y Bollinger.",
    ],
    inputs: ["Eventos crudos OKX WebSocket y respuestas REST de OKX"],
    outputs: ["NormalizedTrade, NormalizedOrderBook, DerivativesSnapshot, Kline[]"],
  },
  {
    id: "screener-runtime",
    title: "Servicio Screener Interno + ADX API",
    subtitle: "InternalScreenerService + OkxFeed + /api/screener/adx",
    layer: "transport",
    layerLabel: "Backend Screener",
    col: 1,
    y: 365,
    accent: "vwap",
    protocol: "Singleton Node.js · SSE + REST",
    cadence: "Escaneo cada 2 s · Klines ADX 30 s",
    files: [
      "server/screenerService.ts",
      "server/runtime.ts",
      "server/okxFeed.ts",
      "server/demoFeed.ts",
      "server/store.ts",
      "app/api/stream/route.ts",
      "app/api/screener/route.ts",
      "app/api/screener/adx/route.ts",
    ],
    perspectives: ["full", "screener"],
    summary:
      "Servicio backend propio dentro de Next.js (sin dependencias de GitHub ni servicios externos) que ingiere ~40 perpetuos OKX, sirve baselines OHLC multi-activo vía /api/screener/adx y emite rankings por SSE (/api/stream).",
    responsibilities: [
      "Descubre hasta 40 swaps perpetuos OKX ordenados por liquidez con reconexión automática.",
      "Expone /api/screener/adx?bar=5m|15m|1h|4h con lotes paralelos OKX y recálculo ADX(14) sobre precios vivos.",
      "Persiste señales cerradas y estadísticas de forward-test en disco cada minuto.",
    ],
    inputs: ["Trades, liquidaciones, derivados y velas OKX de ~40 símbolos"],
    outputs: ["Stream SSE scan, /api/screener, /api/screener/adx, /api/signals y /api/health"],
  },
  {
    id: "orderflow-engine",
    title: "Motores Order Flow, Liquidez, Wyckoff y ATR/BB",
    subtitle: "Footprint · Liquidez · Wyckoff · ATR",
    layer: "engine",
    layerLabel: "Análisis Cuantitativo",
    col: 2,
    y: 100,
    accent: "accent",
    protocol: "Batching 50 ms · Reagregación TF",
    cadence: "50 ms / 1 s",
    files: [
      "lib/managers/marketDataManager.ts",
      "lib/engine/orderFlowEngine.ts",
      "lib/engine/analytics.ts",
      "lib/engine/tradingOptions.ts",
      "lib/engine/liquidityLevels.ts",
      "lib/engine/wyckoff.ts",
      "lib/engine/obiRolling.ts",
      "lib/engine/microstructure.ts",
      "hooks/useTimeframeKlines.ts",
    ],
    perspectives: ["full", "terminal", "trading", "resilience"],
    summary:
      "Núcleo analítico del cliente. Reagrega trades al cambiar temporalidad, detecta nodos VAP HVN y clasifica Volume Profile S/R (Soporte/Resistencia/Pivote y vacíos LVN), extrae muros L2, ejecuta la suite completa Wyckoff (fases, fechas, Clímax/Churn, MACD, ADX 14, duraciones, ciclos históricos y Volume Profile POC/VA por fase) y calcula ATR(14) + Bollinger.",
    responsibilities: [
      "Reagrega instantáneamente el buffer histórico de trades si el usuario cambia entre 1m, 5m, 15m, 30m, 1H y 4H.",
      "analyzeHighVolumeNodes() y analyzeVolumeProfileSR() detectan clusters HVN horizontales y los clasifican en Soporte, Resistencia, Pivote y vacíos LVN frente al precio vivo.",
      "extractLiquidityLevels() identifica muros Bid/Ask L2 respecto a la mediana; analyzeWyckoffCycle() computa macro-fase, Clímax/Churn, MACD(12,26,9), Wilder ADX(14), duraciones, ciclos históricos y phaseVolumeProfiles.",
      "evaluateTradingOptions() combina Wilder ATR(14), Bollinger Bands(20, 2σ), VWAP, OBI y Delta para calibrar SL, Entrada, TP1/TP2 y riesgo 2–3%.",
    ],
    inputs: ["Eventos normalizados en vivo, libro L2 y velas OKX multi-temporalidad (hasta 240 velas)"],
    outputs: ["FootprintCandles, VolumeProfileSRAnalysis (S1/R1/LVN), LiquidityLevel[], WyckoffAnalysis, TradeSetupOptions[]"],
  },
  {
    id: "stores-session",
    title: "Sesión Compartida Root, Zustand y Temas",
    subtitle: "AppProviders · TerminalStore · Sepia",
    layer: "state",
    layerLabel: "Estado Global",
    col: 2,
    y: 245,
    accent: "vwap",
    protocol: "Context Raíz + Zustand + CSS Vars",
    cadence: "Flush React 20 Hz",
    files: [
      "components/AppProviders.tsx",
      "lib/session/SessionContext.tsx",
      "lib/store/terminalStore.ts",
      "lib/store/uiStore.ts",
      "lib/theme.ts",
      "hooks/useCanvas.ts",
      "app/layout.tsx",
    ],
    perspectives: ["full", "terminal", "trading", "resilience"],
    summary:
      "AppProviders mantiene vivo un único MarketSessionProvider en el layout raíz para conservar el activo, temporalidad y stream al navegar entre pestañas, junto al motor multi-tema (incluyendo Sepia).",
    responsibilities: [
      "Preserva velas, libro L2, OBI 30m y temporalidad al cambiar entre Terminal, Opciones de Trading y Gráficos Interactivos.",
      "Gestiona preferencias persistentes (toggle VAP HVN, tema Sepia claro/pergamino, alertas y layouts).",
      "Sincroniza variables CSS del tema activo con colorScheme pre-paint y paletas de HTML5 Canvas.",
    ],
    inputs: ["MarketDataBatch, selección de activo/temporalidad y preferencias UI"],
    outputs: ["Estado reactivo compartido en toda la aplicación sin reconexiones al navegar"],
  },
  {
    id: "screener-engine",
    title: "ScreenerCore, VAP Engine y Tracker",
    subtitle: "VAP + Imbalances + Vol Z + Scoring",
    layer: "engine",
    layerLabel: "Motor de Señales",
    col: 2,
    y: 395,
    accent: "warn",
    protocol: "Evaluación cada 2 s",
    cadence: "Cada 2 s",
    files: [
      "lib/screener/screenerCore.ts",
      "lib/screener/symbolTracker.ts",
      "lib/screener/vapEngine.ts",
      "lib/signals/signalEngine.ts",
      "lib/signals/tracker.ts",
    ],
    perspectives: ["full", "screener"],
    summary:
      "Evalúa simultáneamente ~40 perpetuos OKX calculando Volume-at-Price (POC/VAH/VAL), imbalances Bid/Ask apilados, Volume Z-Score, delta share y señales Momentum/Reversal con forward-testing.",
    responsibilities: [
      "RollingVapTracker calcula perfil de volumen e imbalances ≥3× apilados en ventanas de 15m/5m.",
      "SymbolTracker mide retornos, OI 5m, funding 8h y anomalías de volumen (z-score).",
      "SignalTracker valida el desempeño real en múltiplos de riesgo R.",
    ],
    inputs: ["Flujo agregado multi-símbolo de OkxFeed"],
    outputs: ["ScanResult (ranking, POC/VAP, imbalances, volumeZ y métricas R)"],
  },
  {
    id: "ui-surfaces",
    title: "Terminal Canvas y Screener OKX",
    subtitle: "Footprint + VP S/R · OBI 30m · Tabla",
    layer: "ui",
    layerLabel: "Presentación Terminal",
    col: 3,
    y: 145,
    accent: "buy",
    protocol: "Canvas DPR 60 FPS + Recharts",
    cadence: "60 FPS interactivo",
    files: [
      "components/Terminal.tsx",
      "components/FootprintChart.tsx",
      "components/IndicatorsMenu.tsx",
      "components/RollingOBIChartPanel.tsx",
      "components/ScreenerView.tsx",
      "components/AdxScannerGrid.tsx",
      "components/AdxSparkline.tsx",
      "hooks/useAdxWatchlist.ts",
      "components/ThemeMenu.tsx",
    ],
    perspectives: ["full", "terminal", "screener"],
    summary:
      "Vista principal de ejecución con Footprint Canvas (perfil horizontal Volume Profile S/R y VAP HVN activables), gráfico Recharts OBI 30m, libro L2, Escáner Grid ADX en tiempo real con sparklines 5-ticks (/screener) y tema Sepia.",
    responsibilities: [
      "FootprintChart renderiza clusters Bid/Ask, perfil horizontal S/R (S1/R1, bandas Soporte/Resistencia y vacíos LVN), burbujas, VWAP y zonas HVN en Canvas DPR.",
      "AdxScannerGrid, AdxSparkline y ScreenerView combinan velas OKX con ticks SSE en vivo para calcular fuerza tendencial ADX(14), +DI/-DI y mostrar si la tendencia acelera o decae en los últimos 5 ticks.",
      "ThemeMenu aplica al instante cualquiera de los 7 temas (incluido Sepia) sobre CSS y Canvas.",
    ],
    inputs: ["Estado compartido Zustand, SSE /api/stream, /api/screener/adx y eventos del usuario"],
    outputs: ["Gráficos Footprint/Heatmap con VP S/R, Escáner Grid ADX(14) con Sparkline 5-ticks, OBI 30m y alertas"],
  },
  {
    id: "analytics-views",
    title: "Opciones de Trading y Gráficos",
    subtitle: "Footprint · Liquidez · Wyckoff",
    layer: "ui",
    layerLabel: "Vistas Analíticas",
    col: 3,
    y: 345,
    accent: "poc",
    protocol: "React 19 + Canvas DPR + Recharts",
    cadence: "60 FPS + Tick en vivo",
    files: [
      "components/TradingOptionsView.tsx",
      "components/TradeOperationChart.tsx",
      "components/InteractiveChartsView.tsx",
      "components/LiquidityCandlesChart.tsx",
      "components/WyckoffCycleChart.tsx",
      "components/FootprintChart.tsx",
      "components/MarketSubpageHeader.tsx",
      "app/trading-options/page.tsx",
      "app/interactive-charts/page.tsx",
    ],
    perspectives: ["full", "trading"],
    summary:
      "Dos pestañas especializadas conectadas a la misma sesión viva: Opciones de Trading (operación con liquidez cercana y visor modal) y Gráficos Interactivos (Footprint Canvas + Velas con Liquidez + Ciclo de Wyckoff con fechas, tooltips, Clímax/Churn, MACD, Trend Strength ADX, Duración de Fases, Overlay Histórico y Volume Profile POC/VA por Fase + 6 paneles Recharts).",
    responsibilities: [
      "TradingOptionsView y TradeOperationChart proyectan Entrada, Stop Loss, TP1, TP2 y piscinas de liquidez cercanas en modo Velas+BB o Tick a Tick 1s.",
      "LiquidityCandlesChart grafica velas OHLC en vivo con muros de liquidez L2, filtro ≥3.2× y perfil POC/HVN lateral.",
      "WyckoffCycleChart visualiza curva ideal y estructura real con fechas, tooltips, Clímax/Churn, MACD(12,26,9), Trend Strength (ADX/+DI/-DI), duración por fase, Overlay Historical Cycles y barra lateral de Volume Profile (POC y Value Area 70%).",
      "InteractiveChartsView integra FootprintChart Canvas DPR junto a LiquidityCandlesChart, WyckoffCycleChart y los paneles Recharts dinámicos, compartiendo activo y temporalidad vía MarketSubpageHeader.",
    ],
    inputs: ["SessionStore vivo, 240 klines por temporalidad, libro L2 OKX y análisis ATR/Bollinger/Wyckoff"],
    outputs: ["Operaciones con liquidez cercana, velas L2, Suite Wyckoff completa (ADX/MACD/VP/Overlay) y Footprint DPR"],
  },
];

export const ARCH_EDGES: ArchEdge[] = [
  {
    id: "e-ws-adapters",
    from: "okx-ws",
    to: "terminal-adapters",
    label: "Trades · Books · OI · Liq",
    detail: "Suscripción WebSocket v5 directa o vía servidor Relay si hay bloqueo de red.",
    perspectives: ["full", "terminal", "trading", "resilience"],
  },
  {
    id: "e-ws-screener",
    from: "okx-ws",
    to: "screener-runtime",
    label: "~40 Swaps OKX en vivo",
    detail: "OkxFeed consolida trades, open-interest, funding y liquidaciones para el universo OKX.",
    perspectives: ["full", "screener"],
  },
  {
    id: "e-rest-adapters",
    from: "okx-rest",
    to: "terminal-adapters",
    label: "ctVal + Klines multi-TF",
    detail: "Multiplicadores SWAP, trades de arranque y velas 1m–4H vía /api/terminal/klines.",
    perspectives: ["full", "terminal", "trading", "resilience"],
  },
  {
    id: "e-rest-screener",
    from: "okx-rest",
    to: "screener-runtime",
    label: "Descubrimiento Swaps",
    detail: "Selecciona automáticamente los contratos perpetuos OKX más líquidos al iniciar.",
    perspectives: ["full", "screener"],
  },
  {
    id: "e-adapters-engine",
    from: "terminal-adapters",
    to: "orderflow-engine",
    label: "Stream + Klines TF",
    detail: "Entrega eventos normalizados y velas históricas para Footprint, VAP HVN y ATR/Bollinger.",
    perspectives: ["full", "terminal", "trading", "resilience"],
  },
  {
    id: "e-engine-store",
    from: "orderflow-engine",
    to: "stores-session",
    label: "Batch 50 ms + HVN",
    detail: "Consolida velas footprint, perfil de volumen, flow bars y OBI en el SessionStore raíz.",
    perspectives: ["full", "terminal", "trading", "resilience"],
  },
  {
    id: "e-store-ui",
    from: "stores-session",
    to: "ui-surfaces",
    label: "Selectores + Tema Sepia",
    detail: "Alimenta el Footprint Canvas (60 FPS), HVN toggle y paneles del Terminal con tema sincronizado.",
    perspectives: ["full", "terminal", "resilience"],
  },
  {
    id: "e-store-analytics",
    from: "stores-session",
    to: "analytics-views",
    label: "Sesión Viva Compartida",
    detail: "Comparte activo, temporalidad y flujo en tiempo real hacia Opciones de Trading y Gráficos Interactivos.",
    perspectives: ["full", "trading"],
  },
  {
    id: "e-runtime-screener",
    from: "screener-runtime",
    to: "screener-engine",
    label: "FeedSink ticks & OI",
    detail: "Alimenta SymbolTracker y RollingVapTracker en memoria con cada operación OKX.",
    perspectives: ["full", "screener"],
  },
  {
    id: "e-screener-ui",
    from: "screener-engine",
    to: "ui-surfaces",
    label: "SSE /api/stream (2 s)",
    detail: "Empuja ScanResult y señales al Screener interno con respaldo HTTP /api/screener.",
    perspectives: ["full", "screener"],
  },
];

export const TRACE_STEPS: TraceStep[] = [
  {
    step: 1,
    nodeId: "okx-ws",
    title: "1. OKX emite un tick en WebSocket v5",
    summary:
      "Un comprador agresivo ejecuta 12 contratos de BTC-USDT-SWAP. OKX envía el evento por el canal público `trades` mientras `okx-rest` provee las velas históricas de la temporalidad activa.",
    modulePath: "wss://ws.okx.com:8443/ws/v5/public",
    payloadLabel: "Mensaje crudo OKX WebSocket",
    payload: `{
  "arg": { "channel": "trades", "instId": "BTC-USDT-SWAP" },
  "data": [{ "px": "94250.0", "sz": "12", "side": "buy", "ts": "1731568200412" }]
}`,
  },
  {
    step: 2,
    nodeId: "terminal-adapters",
    edgeId: "e-ws-adapters",
    title: "2. Normalización OKX, Sembrado y Relay SSE",
    summary:
      "OKXFuturesAdapter escala `sz` por `ctVal`. Si el navegador bloquea el socket directo tras 3.5 s, ServerRelayAdapter conmuta al relay Next.js (pre-sembrado con trades recientes).",
    modulePath: "lib/adapters/exchanges.ts → lib/adapters/relay.ts",
    payloadLabel: "Evento normalizado (NormalizedTrade)",
    payload: `{
  "venue": "okx-futures",
  "symbol": "BTC-USDT-SWAP",
  "price": 94250.0,
  "quantity": 0.12,
  "side": "buy"
}`,
  },
  {
    step: 3,
    nodeId: "orderflow-engine",
    edgeId: "e-adapters-engine",
    title: "3. Motores Footprint, VP S/R, Liquidez L2, Wyckoff y ATR/BB",
    summary:
      "MarketDataManager actualiza la vela activa y dispara `analyzeVolumeProfileSR()` (Soporte S1/Resistencia R1/LVN), `evaluateTradingOptions()`, `extractLiquidityLevels()` y `analyzeWyckoffCycle()` (Clímax/Churn, MACD, ADX 14, duraciones, ciclos históricos y Volume Profile por fase).",
    modulePath: "lib/engine/orderFlowEngine.ts → lib/engine/wyckoff.ts · tradingOptions.ts",
    payloadLabel: "Snapshot cuantitativo calculado",
    payload: `{
  "timeframe": "15m",
  "hvnNodes": 4,
  "vpSupportResistance": { "nearestSupport": 93980, "nearestResistance": 94620, "lvnCount": 3 },
  "liquidityWalls": 6,
  "atr14": 248.5,
  "wyckoff": {
    "macroStage": "accumulation",
    "phaseCode": "C · Spring",
    "adxCurrent": 16.4,
    "macdCross": "bullish",
    "poc": 94180,
    "historicalCycles": 3
  }
}`,
  },
  {
    step: 4,
    nodeId: "stores-session",
    edgeId: "e-engine-store",
    title: "4. Sesión Compartida Raíz y Tema Sepia",
    summary:
      "AppProviders mantiene el TerminalStore vivo en el layout raíz con el tema seleccionado (como Sepia) sincronizado en CSS Variables y HTML5 Canvas.",
    modulePath: "components/AppProviders.tsx → lib/theme.ts",
    payloadLabel: "Estado compartido multi-ruta",
    payload: `{
  "symbol": "BTCUSDT",
  "timeframe": "15m",
  "theme": "sepia",
  "sharedAcross": ["/", "/trading-options", "/interactive-charts", "/screener"]
}`,
  },
  {
    step: 5,
    nodeId: "ui-surfaces",
    edgeId: "e-store-ui",
    title: "5. Terminal Canvas DPR (VP S/R + VAP HVN) y Screener",
    summary:
      "FootprintChart proyecta nodos horizontales de Soporte/Resistencia y vacíos LVN desde el Volume Profile sobre Canvas DPR a 60 FPS junto al panel OBI 30m y el Screener interno OKX.",
    modulePath: "components/FootprintChart.tsx · components/ScreenerView.tsx",
    payloadLabel: "Renderizado Terminal",
    payload: `{
  "vpSupportResistance": true,
  "nearestS1": 93980,
  "nearestR1": 94620,
  "hvnHighlight": true,
  "canvasPalette": "sepia-light"
}`,
  },
  {
    step: 6,
    nodeId: "analytics-views",
    edgeId: "e-store-analytics",
    title: "6. Opciones de Trading, Velas L2 y Suite Wyckoff",
    summary:
      "TradingOptionsView proyecta Entrada, SL, TP1/TP2 y muros de liquidez cercanos; InteractiveChartsView combina Footprint Canvas, Velas con Liquidez y el Ciclo de Wyckoff con Clímax, MACD, Trend Strength ADX, Duraciones, Overlay Histórico y Volume Profile POC/VA por fase.",
    modulePath: "components/TradingOptionsView.tsx · components/WyckoffCycleChart.tsx",
    payloadLabel: "Vistas analíticas en tiempo real",
    payload: `{
  "tradingOptions": { "direction": "long", "entry": 94250, "sl": 93887.6, "tp1": 94793.6, "riskPct": 2.5 },
  "wyckoffPanels": ["climaxVolume", "macd(12,26,9)", "adxTrendStrength(14)", "phaseVolumeProfile(POC/VA)"],
  "overlayHistoricalCycles": true,
  "liquidityCandlesIncluded": true
}`,
  },
];

export const CADENCE_METRICS: CadenceMetric[] = [
  {
    id: "ws-tick",
    nodeId: "okx-ws",
    label: "Push WebSocket OKX",
    ms: 10,
    displayValue: "~10 ms (Push)",
    category: "Tiempo real",
    rationale: "OKX envía trades y actualizaciones L2 en tiempo real conforme ocurren en el motor de emparejamiento.",
  },
  {
    id: "batch-flush",
    nodeId: "orderflow-engine",
    label: "Batch MarketDataManager",
    ms: 50,
    displayValue: "50 ms (20 Hz)",
    category: "Throttling",
    rationale: "Agrupa ráfagas de ticks y recalcula Footprint/VAP HVN antes de emitir un solo commit a Zustand.",
  },
  {
    id: "relay-book",
    nodeId: "terminal-adapters",
    label: "Throttle OrderBook Relay",
    ms: 100,
    displayValue: "100 ms (10 Hz)",
    category: "Throttling",
    rationale: "Limita snapshots L2 profundos sobre SSE manteniendo fluidez en Terminal y Gráficos Interactivos.",
  },
  {
    id: "second-sample",
    nodeId: "orderflow-engine",
    label: "Muestreo FlowBar / OBI / OI",
    ms: 1000,
    displayValue: "1,000 ms (1 s)",
    category: "Agregación",
    rationale: "Construye barras de 1 s para CVD, OBI 30m, Volume Z-Score y los gráficos dinámicos en Recharts.",
  },
  {
    id: "screener-scan",
    nodeId: "screener-engine",
    label: "Ciclo ScreenerCore",
    ms: 2000,
    displayValue: "2,000 ms (2 s)",
    category: "Agregación",
    rationale: "Recalcula métricas cruzadas y puntajes Momentum/Reversal sobre ~40 swaps OKX.",
  },
  {
    id: "failover-ws",
    nodeId: "terminal-adapters",
    label: "Failover WS Directo → Relay",
    ms: 3500,
    displayValue: "3,500 ms (3.5 s)",
    category: "Resiliencia",
    rationale: "Si el navegador no recibe datos directos en 3.5 s, conmuta automáticamente al relay Next.js pre-sembrado.",
  },
  {
    id: "klines-refresh",
    nodeId: "okx-rest",
    label: "Klines OKX Multi-Temporalidad",
    ms: 60000,
    displayValue: "Bajo cambio / 60 s",
    category: "Agregación",
    rationale: "Hidrata velas históricas de OKX para la temporalidad activa (1m–4H), alimentando ATR(14), Bollinger y pPOC.",
  },
];

export const ARCH_CAPABILITY_SUITES: ArchitectureCapabilitySuite[] = [
  {
    id: "wyckoff-indicadores",
    name: "Indicadores Wyckoff Sincronizados (Clímax, MACD y ADX)",
    shortName: "Wyckoff Indicadores",
    versionRange: "v2.10 – v2.15",
    nodeId: "analytics-views",
    route: "/interactive-charts",
    routeLabel: "Ir a Gráficos Interactivos",
    color: "accent",
    summary:
      "Tres sub-gráficos sincronizados (syncId='wyckoff-structure') debajo del precio para confirmar absorción volumétrica, giros de momentum y fuerza tendencial vs rango.",
    capabilities: [
      {
        version: "v2.15",
        title: "Trend Strength (ADX 14 +DI/-DI)",
        whatItDoes: "Cuantifica la fuerza real de la tendencia frente a consolidaciones laterales (<20 Rango, 20–25 Transición, ≥25 Tendencia activa).",
        whereToFind: "Gráficos Interactivos → Ciclo de Wyckoff → Botón «Trend Strength (ADX)»",
      },
      {
        version: "v2.11",
        title: "MACD (12, 26, 9) con Cruces Bull/Bear",
        whatItDoes: "Precalienta EMA(12)/EMA(26) hasta con 110 velas previas y señala cruces de momentum alineados con Spring, SOS, BC o UTAD.",
        whereToFind: "Gráficos Interactivos → Ciclo de Wyckoff → Botón «MACD (12,26,9)»",
      },
      {
        version: "v2.10",
        title: "Histograma Volumen, Churn y Clímax",
        whatItDoes: "Resalta velas con volumen climático (≥1.5× media) y churn/absorción institucional correlacionado con los marcadores Wyckoff.",
        whereToFind: "Gráficos Interactivos → Ciclo de Wyckoff → Botón «Volumen Clímax»",
      },
    ],
  },
  {
    id: "wyckoff-perfil-overlay",
    name: "Volume Profile por Fase y Overlay Histórico Wyckoff",
    shortName: "POC/VA & Overlay",
    versionRange: "v2.13 – v2.14",
    nodeId: "analytics-views",
    route: "/interactive-charts",
    routeLabel: "Ir a Gráficos Interactivos",
    color: "poc",
    summary:
      "Herramientas de contexto estructural para ubicar dónde ocurrió la mayor negociación por fase y comparar la madurez actual frente a ciclos pasados del mismo activo.",
    capabilities: [
      {
        version: "v2.14",
        title: "Volume Profile Side-Bar (POC y Value Area 70%)",
        whatItDoes: "Calcula POC, VAL y VAH en 20 niveles por cada fase identificada (Acumulación, Markup, Distribución, Markdown) y los proyecta en el gráfico real.",
        whereToFind: "Gráficos Interactivos → Ciclo de Wyckoff → Botón «Volume Profile» + pestañas por fase",
      },
      {
        version: "v2.13",
        title: "Overlay Historical Cycles",
        whatItDoes: "Permite elegir un ciclo histórico previo y superponerlo tanto en la curva ideal (0–100) como anclado al inicio de la fase actual en el gráfico real.",
        whereToFind: "Gráficos Interactivos → Ciclo de Wyckoff → Botón «Overlay Historical Cycles»",
      },
    ],
  },
  {
    id: "wyckoff-base",
    name: "Motor Wyckoff Base, Fechas, Tooltips y Duración",
    shortName: "Wyckoff Base & Fases",
    versionRange: "v2.8 – v2.12",
    nodeId: "orderflow-engine",
    route: "/interactive-charts",
    routeLabel: "Ir a Gráficos Interactivos",
    color: "vwap",
    summary:
      "Detección en vivo de rango Ice/Creek, marcadores institucionales (PS, SC, AR, Spring, SOS, BC, UTAD, SOW), fechas exactas y estadística de duración histórica.",
    capabilities: [
      {
        version: "v2.12",
        title: "Duración Media por Fase y Madurez (%)",
        whatItDoes: "Analiza hasta 240 velas OKX para calcular horas/días medios de cada macro-fase e indicar si la fase activa es temprana o madura.",
        whereToFind: "Gráficos Interactivos → Ciclo de Wyckoff → Panel «Duración histórica y madurez por fase»",
      },
      {
        version: "v2.9 / v2.11",
        title: "Tooltips Interactivos, Marcadores y Fechas",
        whatItDoes: "Muestra precio, volumen relativo y fecha/hora exacta (DD/MM HH:mm) al pasar el cursor sobre marcadores y en el punto AHORA.",
        whereToFind: "Gráficos Interactivos → Ciclo de Wyckoff → Curva Ideal y Estructura Real",
      },
      {
        version: "v2.8",
        title: "Clasificador Cuantitativo Wyckoff Dual",
        whatItDoes: "Evalúa Ice, Creek, Equilibrio 50%, Order Flow (OBI/Delta) y posición en el stepper de las 4 macro-fases.",
        whereToFind: "Gráficos Interactivos → Bloque «Ciclo de Mercado Wyckoff»",
      },
    ],
  },
  {
    id: "liquidez-trading",
    name: "Liquidez L2, Velas OHLC y Opciones de Trading",
    shortName: "Liquidez & Trading",
    versionRange: "v2.4 – v2.7",
    nodeId: "analytics-views",
    route: "/trading-options",
    routeLabel: "Ir a Opciones de Trading",
    color: "buy",
    summary:
      "Proyección operativa con riesgo ajustable (2–3%), ATR(14) + Bandas de Bollinger y extracción automática de muros de liquidez L2.",
    capabilities: [
      {
        version: "v2.7",
        title: "Velas con Niveles de Liquidez L2",
        whatItDoes: "Dibuja velas OHLC en vivo con muros Bid/Ask ≥3.2× mediana y superpone muros cercanos en las operaciones.",
        whereToFind: "Gráficos Interactivos → «Velas + Liquidez» y Opciones de Trading → Toggle «Liquidez cercana»",
      },
      {
        version: "v2.6",
        title: "Visor Interactivo de Operación (Velas+BB / Tick 1s)",
        whatItDoes: "Abre modal en vivo al pulsar «Proyectado en gráfico» con bandas de beneficio, riesgo, TP1, TP2, Entrada, SL y VWAP.",
        whereToFind: "Opciones de Trading → Tarjetas de Opción Principal / Estructural",
      },
      {
        version: "v2.4",
        title: "Opciones de Trading ATR(14) + Bollinger + Riesgo 2–3%",
        whatItDoes: "Calibra Stop Loss y objetivos dinámicos según volatilidad actual y calcula tamaño de posición en USD.",
        whereToFind: "Pestaña «Opciones de Trading» (/trading-options)",
      },
    ],
  },
  {
    id: "core-okx-temas",
    name: "Footprint Volume Profile S/R, Infraestructura OKX, Screener y Tema Sepia",
    shortName: "Footprint VP & Core",
    versionRange: "v2.1 – v2.17",
    nodeId: "ui-surfaces",
    route: "/",
    routeLabel: "Ir al Terminal",
    color: "warn",
    summary:
      "Visualización horizontal de nodos de volumen para Soporte/Resistencia y vacíos LVN sobre el Footprint Canvas DPR, sesión única OKX, Screener interno y tema Sepia.",
    capabilities: [
      {
        version: "v2.17",
        title: "Volume Profile Horizontal de Soporte y Resistencia (VP S/R)",
        whatItDoes: "Clasifica los nodos horizontales de alto volumen en Soporte (S1/SUP), Resistencia (R1/RES) y Pivote frente al precio vivo, proyectando bandas/líneas y vacíos LVN en el Footprint.",
        whereToFind: "Terminal (/) y Gráficos Interactivos (/interactive-charts) → Botón «VP S/R» o Menú Indicators",
      },
      {
        version: "v2.5",
        title: "Footprint Canvas DPR en Gráficos Interactivos",
        whatItDoes: "Comparte el mismo FootprintChart 60 FPS (Bid×Ask, Delta, Heatmap, HVN, VP S/R) dentro de Gráficos Interactivos.",
        whereToFind: "Terminal (/) y Gráficos Interactivos (/interactive-charts)",
      },
      {
        version: "v2.4",
        title: "Tema Sepia y Sesión Compartida Raíz",
        whatItDoes: "AppProviders conserva velas, libro L2 y OBI al navegar entre pestañas; paleta Sepia aplicada en CSS y Canvas.",
        whereToFind: "Barra superior → Selector de Tema («Sepia»)",
      },
      {
        version: "v2.1 – v2.3",
        title: "VAP HVN, Reagregación TF y Screener Interno OKX",
        whatItDoes: "Nodos HVN toggleables, cambio instantáneo 1m–4H vía OKX REST + WS/SSE relay y escaneo de ~40 swaps perpetuos OKX.",
        whereToFind: "Terminal (/) → Menú Indicators / Screener (/screener)",
      },
    ],
  },
  {
    id: "screener-adx-watchlist",
    name: "Escáner Grid en Tiempo Real ADX(14) y Sparklines 5-Ticks",
    shortName: "Screener ADX Grid",
    versionRange: "v2.18 – v2.19",
    nodeId: "screener-runtime",
    route: "/screener",
    routeLabel: "Ir al Screener ADX",
    color: "buy",
    summary:
      "Cuadrícula y tabla en tiempo real que fusionan velas OKX multi-temporalidad (5m–4H) con los precios SSE del Screener para cuantificar la fuerza tendencial ADX(14), dominancia +DI/-DI y sparklines de aceleración/deceleración en los últimos 5 ticks.",
    capabilities: [
      {
        version: "v2.19",
        title: "Sparkline Codificado por Color (Últimos 5 Ticks ADX)",
        whatItDoes:
          "Registra el histórico móvil de los últimos 5 ticks vivos de ADX y dibuja una mini-gráfica verde (acelerando), roja (perdiendo fuerza) o neutra en tarjetas y filas de la tabla.",
        whereToFind: "Pestaña «Screener» (/screener) → Tarjetas «5-Tick Strength», ordenación «5t Slope» y columna «ADX(14)»",
      },
      {
        version: "v2.18",
        title: "Real-Time ADX Scanner Grid + Watchlist Persistente",
        whatItDoes:
          "Calcula Wilder ADX(14), +DI/-DI, pendiente Δ3v y régimen (Strong Trend ≥40, Trending ≥25, Emerging, Range-Bound <20) en tiempo real para la watchlist o todo el universo OKX.",
        whereToFind: "Pestaña «Screener» (/screener) → Panel superior «Real-Time ADX Trend Strength Scanner Grid» + estrella Watchlist",
      },
      {
        version: "v2.18",
        title: "Columna Ordenable ADX(14) y Filtros de Régimen",
        whatItDoes:
          "Permite alternar entre Split (ADX + Tabla), ADX Grid o Tabla OrderFlow, filtrar activos en tendencia (≥25) y abrir cualquier símbolo en Terminal o Wyckoff.",
        whereToFind: "Pestaña «Screener» (/screener) → Controles «Trending ≥25 / Strong ≥40» y columna «ADX(14)»",
      },
    ],
  },
];

export const ARCH_CHANGELOG: ArchitectureChangeEntry[] = [
  {
    id: "chg-adx-5tick-sparkline-indicator",
    version: "v2.19",
    title: "Indicador Sparkline Codificado por Color sobre los Últimos 5 Ticks de ADX",
    category: "Indicadores",
    nodeId: "ui-surfaces",
    summary:
      "Se añadió un indicador visual mediante sparklines SVG codificados por color tanto en las tarjetas del Escáner Grid como en cada fila de la tabla OrderFlow (/screener) para detectar de inmediato si la fuerza tendencial ADX(14) aumenta o disminuye durante los últimos 5 ticks en vivo.",
    details: [
      "wyckoff.ts añade `recentAdx` a AdxSnapshot y exporta `computeAdxTickTrajectory()`, midiendo variación neta y de último paso en ventanas móviles de 5 ticks («increasing», «decreasing», «flat»).",
      "useAdxWatchlist.ts mantiene un ring-buffer en vivo por temporalidad y símbolo con cada nuevo tick de precio OKX proveniente del stream SSE, sin duplicar precios estáticos.",
      "components/AdxSparkline.tsx dibuja el mini-gráfico SVG con área degradada, puntos de ticks y codificación semántica (--buy verde si sube ADX, --sell rojo si cae ADX), integrado en AdxScannerGrid (con ordenación «5t Slope» y conteo rising/fading) y en la columna ADX(14) de ScreenerView.",
    ],
    files: [
      "lib/engine/wyckoff.ts",
      "hooks/useAdxWatchlist.ts",
      "components/AdxSparkline.tsx",
      "components/AdxScannerGrid.tsx",
      "components/ScreenerView.tsx",
      "__tests__/adxScannerGrid.test.ts",
      "lib/architecture/model.ts",
    ],
  },
  {
    id: "chg-realtime-adx-watchlist-scanner-grid",
    version: "v2.18",
    title: "Escáner Grid en Tiempo Real de Fuerza Tendencial ADX(14) para Watchlist",
    category: "Trading y Análisis",
    nodeId: "screener-runtime",
    summary:
      "Se implementó un escáner en cuadrícula (Grid) en tiempo real dentro de Screener (/screener) que muestra la fuerza tendencial ADX(14) de Wilder, dominancia direccional +DI/-DI y clasificación de régimen para todos los activos fijados en la Watchlist o en el universo activo de perpetuos OKX.",
    details: [
      "wyckoff.ts exporta wilderAdxSeries(), updateBarsWithLivePrice() y computeAdxSnapshot() para recalcular ADX(14), +DI, -DI, pendiente Δ3v y régimen (strong-trend ≥40, trending ≥25, emerging 20–25, range-bound <20) ante cada tick en vivo.",
      "app/api/screener/adx/route.ts consulta en paralelo velas reales de OKX (5m, 15m, 1H, 4H) y hooks/useAdxWatchlist.ts fusiona el precio vivo del stream SSE (/api/stream) para actualizar las tarjetas continuamente.",
      "uiStore añade `watchlistSymbols` persistente (con botón estrella ★ y restablecimiento) y ScreenerView integra AdxScannerGrid + modos Split / ADX Grid / Tabla OrderFlow con columna ordenable ADX(14).",
    ],
    files: [
      "lib/engine/wyckoff.ts",
      "app/api/screener/adx/route.ts",
      "hooks/useAdxWatchlist.ts",
      "lib/store/uiStore.ts",
      "components/AdxScannerGrid.tsx",
      "components/ScreenerView.tsx",
      "__tests__/adxScannerGrid.test.ts",
      "lib/architecture/model.ts",
      "components/ArchitectureView.tsx",
    ],
  },
  {
    id: "chg-footprint-vp-support-resistance",
    version: "v2.17",
    title: "Volume Profile Horizontal de Soporte, Resistencia y LVN en Footprint",
    category: "Indicadores",
    nodeId: "ui-surfaces",
    summary:
      "Se añadió la visualización horizontal de Volume Profile orientada a Soporte y Resistencia en FootprintChart (Terminal y Gráficos Interactivos), clasificando nodos de alto volumen (S1/SUP, R1/RES, PIVOT) y vacíos de bajo volumen (LVN) frente al precio en vivo.",
    details: [
      "orderFlowEngine.ts incorpora analyzeVolumeProfileSR() y classifyVolumeZoneRole(), calculando fuerza estructural (0–100), distancia % al precio vivo, delta por nodo, nearestSupport (S1), nearestResistance (R1) y lvnLevels.",
      "FootprintChart pinta barras horizontales codificadas en el perfil lateral («VP · S/R NODES»), bandas y líneas de trigger horizontales S1/R1/SUP/RES sobre el Footprint, etiquetas en el eje de precio y lectura detallada en tooltips.",
      "uiStore y IndicatorsMenu añaden el indicador `vpSupportResistance` (activado por defecto) junto al botón rápido `VP S/R` en la barra del Footprint.",
    ],
    files: [
      "lib/engine/orderFlowEngine.ts",
      "lib/store/uiStore.ts",
      "components/IndicatorsMenu.tsx",
      "components/FootprintChart.tsx",
      "__tests__/vapHvnIndicator.test.ts",
      "lib/architecture/model.ts",
      "components/ArchitectureView.tsx",
    ],
  },
  {
    id: "chg-architecture-wyckoff-suite-sync",
    version: "v2.16",
    title: "Mapa Interactivo de Funcionalidades y Trazas Actualizadas en Arquitectura",
    category: "Visualización y UX",
    nodeId: "analytics-views",
    summary:
      "Se actualizó la sección Arquitectura (/architecture) con un nuevo gráfico interactivo por bloques funcionales (Suite Wyckoff, Liquidez, Opciones y Core OKX), texto explicativo de «qué hace y dónde está» cada mejora, y trazas/nodos sincronizados hasta Trend Strength ADX y Volume Profile.",
    details: [
      "ArchitectureView incorpora el panel interactivo «Mapa de Funcionalidades Añadidas (Qué hace y dónde está)» con gráfico Recharts por bloque y tarjetas explicativas vinculadas al nodo responsable y la ruta real.",
      "TRACE_STEPS (pasos 3 y 6) y ARCH_NODES reflejan ahora LiquidityLevel[], la suite Wyckoff completa (Clímax/Churn, MACD, ADX 14, duraciones, Overlay Histórico y Volume Profile POC/VA) y LiquidityCandlesChart.",
    ],
    files: ["lib/architecture/model.ts", "components/ArchitectureView.tsx"],
  },
  {
    id: "chg-wyckoff-trend-strength-adx",
    version: "v2.15",
    title: "Indicador Trend Strength (ADX 14) Sincronizado en Ciclo de Wyckoff",
    category: "Indicadores",
    nodeId: "analytics-views",
    summary:
      "Se añadió el indicador 'Trend Strength (ADX)' basado en el Average Directional Index de Wilder (ADX, +DI y -DI) sincronizado con el Ciclo de Wyckoff en Gráficos Interactivos (/interactive-charts) para cuantificar la fuerza tendencial frente a fases laterales de rango.",
    details: [
      "analyzeWyckoffCycle() implementa wilderAdxSeries() sobre las velas con precalentamiento para obtener ADX, +DI y -DI, clasificando el régimen en Rango Lateral (<20), Transición (20–25), Tendencia Activa (25–40) o Tendencia Muy Fuerte (≥40).",
      "WyckoffCycleChart incorpora el botón 'Trend Strength (ADX)', un gráfico sincronizado (syncId='wyckoff-structure') con bandas de régimen (<20 rango vs ≥25 tendencia), umbrales 20/25/40 y marcadores Wyckoff superpuestos.",
      "El tooltip y la tarjeta resumen muestran ADX actual, dominancia +DI/-DI, pendiente Δ3v y diagnóstico tendencial en vivo.",
    ],
    files: ["lib/engine/wyckoff.ts", "components/WyckoffCycleChart.tsx"],
  },
  {
    id: "chg-wyckoff-phase-volume-profile",
    version: "v2.14",
    title: "Volume Profile Side-Bar (POC y Value Area) por Fase Wyckoff",
    category: "Indicadores",
    nodeId: "analytics-views",
    summary:
      "Se añadió una barra lateral de Volume Profile junto al gráfico de Estructura de Precio Real del Ciclo de Wyckoff (/interactive-charts) que calcula y muestra el Point of Control (POC) y el Value Area (70% VAL–VAH) específicos de cada fase Wyckoff identificada.",
    details: [
      "analyzeWyckoffCycle() genera `phaseVolumeProfiles` distribuyendo el volumen real de cada episodio identificado (Acumulación, Markup, Distribución, Markdown) en 20 niveles de precio para extraer POC, VAL, VAH y densidad relativa.",
      "WyckoffCycleChart incluye el botón 'Volume Profile', pestañas por cada fase detectada para inspeccionar su perfil horizontal, tooltip por nivel de precio y comparativa rápida de POC/VA entre fases.",
      "Cuando el POC de la fase seleccionada cae dentro del rango de precio visible, la línea POC y la banda del Value Area se proyectan directamente sobre el gráfico de Estructura Real.",
    ],
    files: ["lib/engine/wyckoff.ts", "components/WyckoffCycleChart.tsx"],
  },
  {
    id: "chg-wyckoff-historical-overlay",
    version: "v2.13",
    title: "Superposición de Ciclos Históricos de Wyckoff (Overlay Historical Cycles)",
    category: "Trading y Análisis",
    nodeId: "analytics-views",
    summary:
      "Se integró el interruptor 'Overlay Historical Cycles' y el selector de episodios pasados en Gráficos Interactivos (/interactive-charts) para proyectar un ciclo histórico previo sobre la curva ideal y sobre el precio real anclado al inicio de la fase activa.",
    details: [
      "analyzeWyckoffCycle() extrae episodios históricos normalizados (retornos base-1 y mapeo a escala ideal 0–100) priorizando ciclos previos de la misma macro-fase.",
      "projectHistoricalCycleOverlay() ancla la trayectoria histórica al cierre inicial de la fase actual (`currentPhaseStartIndex`) y calcula madurez relativa (%), velas restantes estimadas y diferencial de progresión (%).",
      "WyckoffCycleChart añade el botón 'Overlay Historical Cycles', selector desplegable de episodio y trazos discontinuos en ambos gráficos con tooltips comparativos.",
    ],
    files: ["lib/engine/wyckoff.ts", "components/WyckoffCycleChart.tsx"],
  },
  {
    id: "chg-wyckoff-phase-durations",
    version: "v2.12",
    title: "Panel Estadístico de Duración Media por Fase y Madurez Wyckoff",
    category: "Trading y Análisis",
    nodeId: "analytics-views",
    summary:
      "Se añadió un panel estadístico debajo del Ciclo de Wyckoff en Gráficos Interactivos (/interactive-charts) que calcula la duración promedio histórica (horas y días) de Acumulación, Markup, Distribución y Markdown sobre hasta 240 velas OKX para medir la madurez del ciclo actual.",
    details: [
      "analyzeWyckoffCycle() segmenta el historial completo en episodios continuos por macro-fase, suaviza ruido de 1 vela y calcula duración media en horas/días, velas por episodio y porcentaje del historial.",
      "Compara el tiempo transcurrido en la fase activa frente a su media histórica para calcular el porcentaje de madurez (Temprana, En desarrollo, Avanzada o Madura / Probable transición).",
      "InteractiveChartsView amplía useTimeframeKlines(240) para nutrir la estadística histórica de fases sin alterar la ventana operativa del resto de paneles.",
    ],
    files: [
      "lib/engine/wyckoff.ts",
      "components/WyckoffCycleChart.tsx",
      "components/InteractiveChartsView.tsx",
      "__tests__/wyckoff.test.ts",
      "lib/architecture/model.ts",
      "components/ArchitectureView.tsx",
    ],
  },
  {
    id: "chg-wyckoff-macd-dates",
    version: "v2.11",
    title: "Indicador MACD (12,26,9) y Fechas Exactas en el Ciclo de Wyckoff",
    category: "Indicadores",
    nodeId: "analytics-views",
    summary:
      "Se añadió el indicador visual MACD (12, 26, 9) sincronizado debajo del Ciclo de Wyckoff para confirmar cambios de momentum entre fases, junto con fechas y horas explícitas en ejes, cabecera, punto AHORA y tarjetas de fase.",
    details: [
      "analyzeWyckoffCycle() precalienta EMA(12)/EMA(26) hasta con 110 velas previas, calcula MACD, Señal(9), Histograma y cruces alcistas/bajistas (bullish/bearish) con ventana temporal exacta (windowStartTime → windowEndTime).",
      "WyckoffCycleChart añade un panel MACD interactivo toggleable sincronizado mediante `syncId=\"wyckoff-structure\"`, resaltando cruces y líneas verticales sobre las fases Wyckoff (SC, Spring, SOS, BC, UTAD, SOW).",
      "Todos los ejes X, tooltips, tarjetas de marcadores y el punto AHORA ahora muestran fecha y hora (DD/MM HH:mm) para ubicar con precisión el momento actual del ciclo.",
    ],
    files: [
      "lib/engine/wyckoff.ts",
      "components/WyckoffCycleChart.tsx",
      "__tests__/wyckoff.test.ts",
      "lib/architecture/model.ts",
      "components/ArchitectureView.tsx",
    ],
  },
  {
    id: "chg-wyckoff-volume-climax",
    version: "v2.10",
    title: "Histograma Secundario de Volumen, Churn y Clímax en Wyckoff",
    category: "Trading y Análisis",
    nodeId: "analytics-views",
    summary:
      "Se integró un histograma secundario sincronizado debajo del Ciclo de Wyckoff en Gráficos Interactivos (/interactive-charts) que detecta y resalta eventos de alto churn/absorción y picos climáticos correlacionados con los marcadores de fase.",
    details: [
      "analyzeWyckoffCycle() clasifica cada vela OKX según volumen relativo (umbral Clímax ≥1.5× media) y relación cuerpo/amplitud para detectar Churn institucional (alto volumen con absorción).",
      "WyckoffCycleChart renderiza un BarChart inferior acoplado mediante `syncId=\"wyckoff-structure\"`, líneas de referencia Media 1× y Clímax 1.5×, líneas verticales por marcador de fase (SC, Spring, BC, UTAD, etc.) y tooltips sincronizados.",
    ],
    files: [
      "lib/engine/wyckoff.ts",
      "components/WyckoffCycleChart.tsx",
      "__tests__/wyckoff.test.ts",
      "lib/architecture/model.ts",
      "components/ArchitectureView.tsx",
    ],
  },
  {
    id: "chg-wyckoff-tooltips",
    version: "v2.9",
    title: "Tooltips Interactivos y Marcadores de Fase en el Gráfico de Wyckoff",
    category: "Visualización y UX",
    nodeId: "analytics-views",
    summary:
      "Se enriquecieron ambos gráficos del Ciclo de Wyckoff en Gráficos Interactivos (/interactive-charts) con marcadores de fase reales (PS, SC, AR, ST, Spring, SOS, JAC, PSY, BC, UTAD, SOW) y tooltips interactivos que muestran precio, volumen relativo y hora exacta al pasar el cursor.",
    details: [
      "analyzeWyckoffCycle() ahora ancla cada evento Wyckoff a su vela OHLCV real de OKX en series[].marker y enriquece los 24 puntos de curvePoints con precio, volumen, ratio vs media y timestamp.",
      "Tanto la curva ideal de Wyckoff como el gráfico de estructura Ice/Creek dibujan marcadores visibles sobre los nodos detectados y muestran tooltips detallados (Precio, Volumen ×media y Hora) junto a un resumen cronológico inferior.",
    ],
    files: [
      "lib/engine/wyckoff.ts",
      "components/WyckoffCycleChart.tsx",
      "__tests__/wyckoff.test.ts",
      "lib/architecture/model.ts",
      "components/ArchitectureView.tsx",
    ],
  },
  {
    id: "chg-wyckoff-cycle",
    version: "v2.8",
    title: "Gráfico Interactivo del Ciclo de Wyckoff en Gráficos Interactivos",
    category: "Trading y Análisis",
    nodeId: "analytics-views",
    summary:
      "Se añadió el detector cuantitativo y visor dual del Ciclo de Mercado de Wyckoff dentro de Gráficos Interactivos (/interactive-charts) para identificar en tiempo real en qué fase se encuentra el activo.",
    details: [
      "Motor analyzeWyckoffCycle() evalúa el rango estructural (Ice/Creek), movimiento previo, pendiente EMA, esfuerzo vs resultado en volumen, eventos Spring/UTAD y confirmación de Order Flow (OBI/Delta).",
      "Muestra un stepper de las 4 macro-fases (1. Acumulación → 2. Markup → 3. Distribución → 4. Markdown), un mapa del ciclo completo señalando exactamente el punto «AHORA» y la estructura de precio real con niveles Ice, Creek y Equilibrio 50%.",
    ],
    files: [
      "lib/engine/wyckoff.ts",
      "components/WyckoffCycleChart.tsx",
      "components/InteractiveChartsView.tsx",
      "lib/architecture/model.ts",
      "components/ArchitectureView.tsx",
    ],
  },
  {
    id: "chg-liquidity-levels-candles",
    version: "v2.7",
    title: "Niveles de Liquidez en Operaciones y Gráfico de Velas + Liquidez",
    category: "Trading y Análisis",
    nodeId: "analytics-views",
    summary:
      "Se integró el extractor estadístico de muros/niveles de liquidez L2 (extractLiquidityLevels) tanto sobre el mapa visual de la operación en Opciones de Trading como en un nuevo gráfico de velas OHLC con niveles de liquidez en Gráficos Interactivos.",
    details: [
      "Opciones de Trading (/trading-options): TradeOperationChart ahora traza los niveles Bid/Ask de liquidez cercanos al rango de Entrada, Stop Loss, TP1 y TP2 con toggle «Liquidez cercana» y tarjetas resumen por distancia %.",
      "Gráficos Interactivos (/interactive-charts): LiquidityCandlesChart dibuja velas japonesas OHLC en tiempo real del activo con líneas/bandas de muros L2, filtro Top Liquidez vs Solo Muros (≥3.2×), overlay POC/HVN y escalera de profundidad lateral.",
      "Motor lib/engine/liquidityLevels.ts agrupa niveles L2 por tick del activo y detecta automáticamente muros estadísticos respecto a la mediana.",
    ],
    files: [
      "lib/engine/liquidityLevels.ts",
      "components/TradeOperationChart.tsx",
      "components/LiquidityCandlesChart.tsx",
      "components/InteractiveChartsView.tsx",
      "components/TradingOptionsView.tsx",
    ],
  },
  {
    id: "chg-trade-projection-modal",
    version: "v2.6",
    title: "Gráfico en Tiempo Real de la Operación en Opciones de Trading",
    category: "Trading y Análisis",
    nodeId: "analytics-views",
    summary:
      "Al pulsar el botón «Proyectado en gráfico» o «Ver en gráfico» en cualquier tarjeta de Opciones de Trading (/trading-options), se abre un visor gráfico interactivo en tiempo real con Entrada, Stop Loss, TP1, TP2 y el precio vivo.",
    details: [
      "Componente reutilizable TradeOperationChart con doble modo: Velas + Bandas de Bollinger (actualizando la vela en curso con cada tick) y Tick a Tick (1s Vivo).",
      "Dibuja zonas sombreadas de Beneficio (Entrada → TP2) y Riesgo (Entrada → Stop Loss), además de etiquetas horizontales de TP2, TP1, Entrada, SL, VWAP y Precio Vivo.",
      "El modal permite alternar entre Opción Principal y Opción Estructural y ajustar el riesgo 2–3% viendo los niveles recalibrarse al instante.",
    ],
    files: [
      "components/TradeOperationChart.tsx",
      "components/TradingOptionsView.tsx",
      "lib/architecture/model.ts",
      "components/ArchitectureView.tsx",
    ],
  },
  {
    id: "chg-interactive-footprint",
    version: "v2.5",
    title: "Gráfico Footprint en Vivo integrado en Gráficos Interactivos",
    category: "Visualización y UX",
    nodeId: "analytics-views",
    summary:
      "Se incorporó el gráfico Footprint Canvas DPR en tiempo real dentro de la pestaña Gráficos Interactivos (/interactive-charts), compartiendo la misma sesión OKX, temporalidad y tema activo (incl. Sepia).",
    details: [
      "Monta FootprintChart completo (modos Bid × Ask, Delta y Volume, Profile lateral, VAP HVN toggleable, Heatmap y Resting Liquidity) en contenedor dedicado de alta densidad.",
      "Totalmente sincronizado con AppProviders/SessionStore: cambiar activo, temporalidad o tema actualiza al instante tanto el Footprint como los paneles Recharts subyacentes sin perder velas.",
      "Incluye zoom por rueda/modificadores, arrastre libre, crosshair con tooltip detallado (GlobalTooltip) y botón ⟲ Live.",
    ],
    files: [
      "components/InteractiveChartsView.tsx",
      "components/FootprintChart.tsx",
      "lib/architecture/model.ts",
      "components/ArchitectureView.tsx",
    ],
  },
  {
    id: "chg-trading-options",
    version: "v2.4",
    title: "Pestaña Opciones de Trading (ATR + Bollinger + Riesgo 2–3%)",
    category: "Trading y Análisis",
    nodeId: "analytics-views",
    summary:
      "Nueva vista operativa conectada en vivo al activo y temporalidad activos. Calcula Entrada, Take Profit 1 y 2, y Stop Loss dinámico calibrado con Wilder ATR(14) y Bandas de Bollinger (20, 2σ).",
    details: [
      "Stop Loss dinámico ponderando 1.5× ATR(14) + 1.5σ de Bandas de Bollinger para adaptarse a compresiones (squeeze) y expansiones de volatilidad.",
      "Control interactivo de Riesgo inicializado en 2.5% (rango 2–3% con presets y slider 0.5%–10%) y cálculo de tamaño de posición sobre capital de referencia.",
      "Gráfico Recharts integrado proyectando Bandas de Bollinger junto a las líneas horizontales de Entrada, Stop Loss, TP1 y TP2.",
    ],
    files: [
      "lib/engine/tradingOptions.ts",
      "hooks/useTimeframeKlines.ts",
      "components/TradingOptionsView.tsx",
      "app/trading-options/page.tsx",
    ],
  },
  {
    id: "chg-interactive-charts",
    version: "v2.4",
    title: "Pestaña Gráficos Interactivos (Telemetría Terminal en Vivo)",
    category: "Visualización y UX",
    nodeId: "analytics-views",
    summary:
      "Convierte todas las cifras numéricas de la sección Terminal en 5 gráficos Recharts interactivos que reaccionan en tiempo real con el flujo de OKX.",
    details: [
      "Gráfico Precio + Bandas de Bollinger + VWAP + POC, y gráfico de Flujo Agresivo (Compras/Ventas) + CVD acumulado.",
      "Distribución Volume-at-Price (VAP) resaltando POC, Value Area y nodos HVN detectados.",
      "Curva acumulada Bid/Ask Depth vs OBI 30m Rolling, además de Volume Z-Score y Open Interest / Volatilidad Realizada.",
    ],
    files: [
      "components/InteractiveChartsView.tsx",
      "app/interactive-charts/page.tsx",
      "components/MarketSubpageHeader.tsx",
    ],
  },
  {
    id: "chg-sepia-session",
    version: "v2.4",
    title: "Tema Sepia y Sesión Raíz Compartida entre Pestañas",
    category: "Visualización y UX",
    nodeId: "stores-session",
    summary:
      "Se incorporó el tema Sepia (pergamino cálido y tinta espresso) en CSS/Canvas y se elevó el MarketSessionProvider al layout raíz para conservar datos al cambiar de pestaña.",
    details: [
      "Paleta `sepia` en ThemeMenu, pre-paint SSR en app/layout.tsx y detección de modo claro en HTML5 Canvas (useCanvas.ts).",
      "AppProviders evita desconexiones y pérdidas de velas cuando navegas entre Terminal, Opciones de Trading y Gráficos Interactivos.",
    ],
    files: ["lib/theme.ts", "hooks/useCanvas.ts", "components/AppProviders.tsx", "app/layout.tsx"],
  },
  {
    id: "chg-vap-hvn",
    version: "v2.3",
    title: "Indicador Volume-at-Price (VAP) High-Volume Nodes (HVN)",
    category: "Indicadores",
    nodeId: "ui-surfaces",
    summary:
      "Detector toggleable de nodos de alto volumen (HVN) sobre el perfil VAP para identificar zonas institucionales de liquidez y aceptación en el gráfico Footprint.",
    details: [
      "Algoritmo analyzeHighVolumeNodes() agrupa niveles contiguos por encima del umbral configurable (% del POC) y sobre la media de volumen.",
      "Botón rápido `VAP HVN` en FootprintChart y controles de umbral/color en IndicatorsMenu.",
    ],
    files: [
      "lib/engine/orderFlowEngine.ts",
      "lib/store/uiStore.ts",
      "components/IndicatorsMenu.tsx",
      "components/FootprintChart.tsx",
    ],
  },
  {
    id: "chg-timeframe-relay",
    version: "v2.2",
    title: "Reagregación por Temporalidad y Arranque Instantáneo OKX",
    category: "Datos y Relay",
    nodeId: "terminal-adapters",
    summary:
      "El selector de temporalidad (1m–4H) reagrega las velas en vivo sin desconectar el feed, y el relay de servidor siembra trades iniciales desde OKX REST para eliminar pantallas vacías.",
    details: [
      "MarketDataManager preserva el historial de trades en memoria y reconstruye FootprintCandles al instante al cambiar temporalidad.",
      "/api/terminal/klines ahora soporta cualquier `bar` de OKX (1m, 5m, 15m, 30m, 1H, 4H) además de `limit`.",
    ],
    files: [
      "lib/managers/marketDataManager.ts",
      "server/terminalRelay.ts",
      "lib/adapters/relay.ts",
      "app/api/terminal/klines/route.ts",
    ],
  },
  {
    id: "chg-internal-screener",
    version: "v2.1",
    title: "Motor Screener Interno OKX + OBI 30m Rolling (Recharts)",
    category: "Datos y Relay",
    nodeId: "screener-engine",
    summary:
      "Se eliminó toda dependencia externa de GitHub/Binance/Bybit construyendo el motor propio en servidor sobre OKX v5 junto al panel Recharts de OBI promedio móvil 30m.",
    details: [
      "InternalScreenerService + OkxFeed analizan ~40 perpetuos OKX calculando VAP, imbalances ≥3× apilados, Volume Z-Score y forward-test R.",
      "RollingOBIChartPanel grafica en Recharts el promedio móvil de 30 minutos del OBI frente al precio.",
    ],
    files: [
      "server/screenerService.ts",
      "server/okxFeed.ts",
      "lib/screener/vapEngine.ts",
      "components/RollingOBIChartPanel.tsx",
    ],
  },
];
