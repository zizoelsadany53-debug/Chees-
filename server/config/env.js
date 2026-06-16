import dotenv from "dotenv";

dotenv.config();

// Returns undefined if the value is an uninterpolated Railway reference variable
// (e.g. "${{ MySQL.MYSQLHOST }}"), so callers can fall back to a safe default.
function resolveEnv(value) {
  if (!value || value.includes("${{")) return undefined;
  return value;
}

function railwayDbConfig() {
  const databaseUrl = resolveEnv(process.env.DATABASE_URL) || resolveEnv(process.env.MYSQL_URL);
  if (databaseUrl) {
    const url = new URL(databaseUrl);
    return {
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, "")
    };
  }

  return {
    host: resolveEnv(process.env.MYSQLHOST) || resolveEnv(process.env.DB_HOST) || "mysql.railway.internal",
    port: Number(resolveEnv(process.env.MYSQLPORT) || resolveEnv(process.env.DB_PORT) || 3306),
    user: resolveEnv(process.env.MYSQLUSER) || resolveEnv(process.env.DB_USER) || "root",
    password: resolveEnv(process.env.MYSQLPASSWORD) || resolveEnv(process.env.DB_PASSWORD) || "",
    database: resolveEnv(process.env.MYSQLDATABASE) || resolveEnv(process.env.DB_NAME) || "global_chess_arena"
  };
}

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 5000),
  clientUrl: process.env.CLIENT_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "http://localhost:5173"),
  jwtSecret: process.env.JWT_SECRET || "dev-only-secret-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  db: railwayDbConfig()
};
