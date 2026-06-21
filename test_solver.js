const assert = require('assert');

function parseOrder(altText) {
  if (!altText) return 999;
  const text = altText.toLowerCase();
  if (text.includes('أولى') || text.includes('اولى') || text.includes('أول') || text.includes('اول') || text.includes('first') || text.includes('1st') || text.includes('1')) return 1;
  if (text.includes('ثانية') || text.includes('ثانيه') || text.includes('ثاني') || text.includes('second') || text.includes('2nd') || text.includes('2')) return 2;
  if (text.includes('ثالثة') || text.includes('ثالثه') || text.includes('ثالث') || text.includes('third') || text.includes('3rd') || text.includes('3')) return 3;
  if (text.includes('رابعة') || text.includes('رابعه') || text.includes('رابع') || text.includes('fourth') || text.includes('4th') || text.includes('4')) return 4;
  if (text.includes('خامسة') || text.includes('خامسه') || text.includes('خامس') || text.includes('fifth') || text.includes('5th') || text.includes('5')) return 5;
  if (text.includes('سادسة') || text.includes('سادسه') || text.includes('سادس') || text.includes('sixth') || text.includes('6th') || text.includes('6')) return 6;
  if (text.includes('سابعة') || text.includes('سابعه') || text.includes('سابع') || text.includes('seventh') || text.includes('7th') || text.includes('7')) return 7;
  return 999;
}

// Test cases
try {
  assert.strictEqual(parseOrder("الخطوة الأولى."), 1);
  assert.strictEqual(parseOrder("الخطوة الثانية."), 2);
  assert.strictEqual(parseOrder("الثالثة"), 3);
  assert.strictEqual(parseOrder("الخامسة"), 5);
  assert.strictEqual(parseOrder("First step"), 1);
  assert.strictEqual(parseOrder("3rd step"), 3);
  assert.strictEqual(parseOrder(null), 999);
  console.log("All tests passed!");
} catch (e) {
  console.error("Test failed:", e);
  process.exit(1);
}
