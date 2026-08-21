import express from "express";
import helmet from "helmet";
import "dotenv/config";
import authRoutes from "./routes/auth.js";
import { verifyToken } from "./middleware/auth.js";
import walletRoutes from "./routes/wallet.js";
import investmentRouter from "./routes/investments.js";
import historyRouter from "./routes/history.js";
import epinRoutes from "./routes/epins.js";
import genealogyRoutes from "./routes/genealogy.js";
import earningsRoutes from "./routes/earnings.js";

const app = express();
app.set("trust proxy", 1);

// Global Security Middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        // Allows CodeSandbox domains to embed your API preview
        "frame-ancestors": [
          "'self'",
          "*.codesandbox.io",
          "https://codesandbox.io",
        ],
      },
    },
    // Set X-Frame-Options to allow framing from the same origin
    frameguard: { action: "sameorigin" },
  })
);

//app.use(helmet()); // Sets standard, highly secure HTTP response headers

// CORS must come before any routes
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});
app.use(express.json({ limit: "10kb" })); // Mitigates body-parser Denial of Service vulnerabilities

// Routes Declarations
app.use("/api/auth", authRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/investments", investmentRouter);
app.use("/history", historyRouter);
app.use("/api/epins", epinRoutes);
app.use("/api/genealogy", genealogyRoutes);
app.use("/api/earnings", earningsRoutes);
// Base Root Endpoint
app.get("/", (req, res) => {
  return res.status(200).send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Marup API Gateway</title>
        <style>
          * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
          }
          body {
            /* Apple system font stack used across macOS, iOS, and apple.com */
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: #000000; /* Pure Apple OLED pitch black */
            color: #ffffff;            /* Pure white contrast text */
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            text-align: center;
            letter-spacing: -0.015em;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
          }
          .container {
            max-width: 600px;
            padding: 2rem;
          }
          h1 {
            font-size: 2.75rem;
            font-weight: 600;          /* Apple styling prefers semi-bold headers over thick weights */
            letter-spacing: -0.03em;
            margin-bottom: 0.75rem;
            line-height: 1.1;
          }
          p {
            font-size: 1.15rem;
            color: #86868b;            /* Exact gray shade used for sub-copy on apple.com */
            font-weight: 400;
            line-height: 1.5;
            margin-bottom: 2rem;
          }
          .status-badge {
            display: inline-flex;
            align-items: center;
            background-color: #1c1c1e; /* Elevated Apple system dark tray background */
            border: 1px solid #2c2c2e; /* Subdued interior borders */
            padding: 0.5rem 1.25rem;
            border-radius: 999px;      /* Capsule pill design */
            font-size: 0.85rem;
            font-weight: 500;
            color: #f5f5f7;            /* Off-white typography token */
          }
          .pulse-dot {
            height: 7px;
            width: 7px;
            background-color: #ffffff; /* Monochromatic functional indicator status */
            border-radius: 50%;
            margin-right: 8px;
            box-shadow: 0 0 8px rgba(255, 255, 255, 0.6);
            animation: pulse 2s infinite ease-in-out;
          }
          @keyframes pulse {
            0% { opacity: 0.4; }
            50% { opacity: 1; }
            100% { opacity: 0.4; }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Marup Auth Gateway</h1>
          <p>The authentication infrastructure is optimized, verified, and running securely.</p>
          <div class="status-badge">
            <span class="pulse-dot"></span> Status: Healthy &nbsp;&middot;&nbsp; v1.0.0
          </div>
        </div>
      </body>
    </html>
  `);
});
// 404 Fallback Handlers
app.use((req, res) =>
  res.status(404).json({ error: "Resource endpoint not found" })
);
const PORT = process.env.PORT;
app.listen(PORT, () =>
  console.log(`Production server running securely on port ${PORT}`)
);
