# MARUP Backend API
Backend API for the MARUP financial platform built with Express.js and Drizzle ORM.

## Tech Stack

- **Runtime:** Node.js (ES Modules)
- **Framework:** Express 5
- **Database:** PostgreSQL (Neon Serverless)
- **ORM:** Drizzle ORM
- **Auth:** JWT + bcryptjs
- **Security:** Helmet, CORS, Rate Limiting

## Getting Started

```bash
npm install
npm start
```

Server runs on `http://localhost:8080`

## Environment Variables

Create a `.env` file:

```
DATABASE_URL=your_neon_connection_string
JWT_SECRET=your_secret_key
PORT=8080
```

## API Routes

| Route | Description |
|-------|-------------|
| `/api/auth/*` | Authentication (register, login) |
| `/api/wallet/*` | Wallet operations |
| `/api/invest/*` | Investment plans |
| `/api/history/*` | Transaction history |

## Database Push

```bash
npm run db:push
```
