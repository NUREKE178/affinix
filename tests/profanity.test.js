// The obscenity filter for names: what it must refuse, what it must let through, and that the browser and the database use the same word lists.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isProfane, CYR_SUB, CYR_EXACT, LAT_SUB, LAT_EXACT } from "../src/lib/profanity.js";

export const BAD = ["Хуйло", "хуууй", "xуй", "ПИЗДА", "п и з д а", "5ука", "сука", "Бляяять", "sh1t", "FUCK", "f.u.c.k", "Mother-fucker", "nigga", "n1gger", "faggot", "Dick",
  "Сиктир", "қотақ", "жезөкше", "Ебанат", "xuy_228", "pizda", "siktir", "долбоёб", "Мудак Мудаков", "Aman Fuckov"];
export const GOOD = ["Нұрлан Худайберген", "Амина Сейтова", "nu4lan", "Ardana Nogaibaeva", "Marzhan Rustamova", "Asilay", "Darkhan", "Аблязов", "Scunthorpe",
  "Hancock", "Сучков", "Лохматов", "Assel", "Хуан Карлос", "Мудрый", "Hui Zhang", "Huy Nguyen", "Пушкин", "Тураш_01", "Web Developer, Vibe Coder", "Student", "Head of Research", ""];

test("obscene names are refused, in every disguise", () => {
  for (const s of BAD) assert.equal(isProfane(s), true, `should be refused: ${s}`);
});

test("ordinary names pass (no false alarms on real names)", () => {
  for (const s of GOOD) assert.equal(isProfane(s), false, `should pass: ${s}`);
});

test("the browser and the database filter use the same word lists", () => {
  const sql = fs.readFileSync(new URL("../supabase/migrations/0033_profanity_filter.sql", import.meta.url), "utf8");
  const read = (name) => [...sql.match(new RegExp(`${name} constant text\\[\\] := array\\[(.*?)\\];`))[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(read("v_cyr_sub"), CYR_SUB);
  assert.deepEqual(read("v_cyr_exact"), CYR_EXACT);
  assert.deepEqual(read("v_lat_sub"), LAT_SUB);
  assert.deepEqual(read("v_lat_exact"), LAT_EXACT);
});
