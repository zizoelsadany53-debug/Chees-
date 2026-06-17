import dotenv from "dotenv";

dotenv.config();

// Returns undefined if the value is an uninterpolated Railway reference variable
// (e.g. "${{ MySQL.MYSQLHOST }}"), so callers can fall back to a safe default.
export function resolveEnv(value) {
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
    host: process.env.MYSQLHOST || "mysql.railway.internal",
    port: Number(process.env.MYSQLPORT || 3306),
    user: process.env.MYSQLUSER || "root",
    password: process.env.MYSQLPASSWORD || "",
    database: process.env.MYSQLDATABASE || "global_chess_arena"
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
