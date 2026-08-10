require("../config/env");

const pool = require("../db");
const initDatabase = require("../initDb");

async function main() {
  try {
    await initDatabase();
  } catch (error) {
    console.error("Không khởi tạo được cơ sở dữ liệu:", error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
