import fs from "fs";
import mysql from "mysql2/promise";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "../config/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const schemaPath = path.join(__dirname, "schema.sql");
const schemaSql = fs.readFileSync(schemaPath, "utf8");

// Expected tables defined in schema.sql — update this list if the schema changes.
const EXPECTED_TABLES = [
  "users",
  "matches",
  "moves",
  "reports",
  "notifications",
  "tournaments",
  "tournament_participants",
];

async function main() {
  // Derive connection config from the same source the app uses so we are
  // guaranteed to hit the correct database instance.
  const dbConfig = env.db;

  console.log("=== setup_db.js starting ===");
  console.log("Connection details:");
  console.log(`  host     : ${dbConfig.host}`);
  console.log(`  port     : ${dbConfig.port}`);
  console.log(`  user     : ${dbConfig.user}`);
  console.log(`  database : ${dbConfig.database}`);
  console.log(`  password : ${dbConfig.password ? "[set]" : "[empty]"}`);
  console.log("");

  // Connect without a database first so we can run CREATE DATABASE IF NOT EXISTS.
  console.log("Step 1/4 — Opening connection (no database selected)...");
  let connection;
  try {
    connection = await mysql.createConnection({
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      password: dbConfig.password,
      multipleStatements: true,
    });
    console.log("  ✓ Connection established.");
  } catch (error) {
    console.error("  ✗ Failed to connect to MySQL:");
    console.error(`    Code   : ${error.code}`);
    console.error(`    Message: ${error.message}`);
    process.exit(1);
  }

  try {
    // ------------------------------------------------------------------ //
    // Step 2 — Ensure the target database exists                          //
    // ------------------------------------------------------------------ //
    console.log(`\nStep 2/4 — Ensuring database '${dbConfig.database}' exists...`);
    try {
      await connection.query(
        `CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\`
         CHARACTER SET utf8mb4
         COLLATE utf8mb4_unicode_ci;`
      );
      console.log(`  ✓ Database '${dbConfig.database}' exists (or was just created).`);
    } catch (error) {
      console.error(`  ✗ Failed to create/verify database '${dbConfig.database}':`);
      console.error(`    Code   : ${error.code}`);
      console.error(`    Message: ${error.message}`);
      throw error;
    }

    // Switch into the target database.
    await connection.query(`USE \`${dbConfig.database}\`;`);
    console.log(`  ✓ Switched to database '${dbConfig.database}'.`);

    // ------------------------------------------------------------------ //
    // Step 3 — Run the full schema SQL                                    //
    // ------------------------------------------------------------------ //
    console.log("\nStep 3/4 — Applying schema.sql...");
    try {
      await connection.query(schemaSql);
      console.log("  ✓ schema.sql executed without errors.");
    } catch (error) {
      console.error("  ✗ Failed to execute schema.sql:");
      console.error(`    Code   : ${error.code}`);
      console.error(`    Message: ${error.message}`);
      if (error.sql) {
        console.error(`    SQL    : ${error.sql.slice(0, 200)}`);
      }
      throw error;
    }

    // ------------------------------------------------------------------ //
    // Step 4 — Verify tables exist in the target database                 //
    // ------------------------------------------------------------------ //
    console.log(`\nStep 4/4 — Verifying tables in '${dbConfig.database}'...`);
    let existingTables;
    try {
      const [rows] = await connection.query(
        `SELECT TABLE_NAME
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ?
         ORDER BY TABLE_NAME;`,
        [dbConfig.database]
      );
      existingTables = rows.map((r) => r.TABLE_NAME);
    } catch (error) {
      console.error("  ✗ Failed to query information_schema.TABLES:");
      console.error(`    Code   : ${error.code}`);
      console.error(`    Message: ${error.message}`);
      throw error;
    }

    console.log(`  Tables found in '${dbConfig.database}' (${existingTables.length}):`);
    if (existingTables.length === 0) {
      console.log("    (none)");
    } else {
      existingTables.forEach((t) => console.log(`    - ${t}`));
    }

    const missingTables = EXPECTED_TABLES.filter((t) => !existingTables.includes(t));
    if (missingTables.length > 0) {
      console.error(`\n  ✗ Missing expected tables (${missingTables.length}):`);
      missingTables.forEach((t) => console.error(`    - ${t}`));
      console.error(
        "\n  The schema ran without throwing but some tables are absent." +
          " Check that the MySQL user has CREATE TABLE privileges on this database."
      );
      process.exitCode = 1;
    } else {
      console.log(`\n  ✓ All ${EXPECTED_TABLES.length} expected tables are present.`);
    }

    console.log("\n=== setup_db.js finished successfully ===");
  } catch (error) {
    console.error("\n=== setup_db.js FAILED ===");
    console.error("Unhandled error:", error.message);
    process.exitCode = 1;
  } finally {
    await connection.end();
    console.log("Connection closed.");
  }
}

main();
