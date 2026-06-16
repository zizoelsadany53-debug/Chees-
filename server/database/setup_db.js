import fs from "fs";
import mysql from "mysql2/promise";
import path from "path";
import { fileURLToPath } from "url";
import { resolveEnv } from "../config/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const schemaPath = path.join(__dirname, "schema.sql");
const schemaSql = fs.readFileSync(schemaPath, "utf8");

async function main() {
  const connection = await mysql.createConnection({
    host: resolveEnv(process.env.MYSQLHOST) || "mysql.railway.internal",
    port: parseInt(resolveEnv(process.env.MYSQLPORT) || "3306", 10),
    user: resolveEnv(process.env.MYSQLUSER) || "root",
    password: resolveEnv(process.env.MYSQLPASSWORD) || "",
    multipleStatements: true
  });

  try {
    console.log("Creating database schema from schema.sql...");
    await connection.query(schemaSql);
    console.log("Database schema created or verified successfully.");
  } catch (error) {
    console.error("Failed to create database schema:", error);
    process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

main();
