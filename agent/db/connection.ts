import { Database } from "bun:sqlite";
import { basename, dirname, join } from "node:path";

const databasePath =
  basename(process.execPath) === "bun" ? "cody_db.sqlite" : join(dirname(process.execPath), "..", "cody_db.sqlite");

export const db = new Database(databasePath);
